import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Запрос отменён или истёк тайм-аут'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function codexExecutable(explicit) {
  if (explicit) return explicit;
  const names = process.platform === 'win32' ? ['codex.exe'] : ['codex'];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) { const file = path.join(directory, name); if (fs.existsSync(file)) return file; }
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const directory = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(directory)) {
      const files = fs.readdirSync(directory).map(name => path.join(directory, name, 'codex.exe')).filter(file => fs.existsSync(file));
      files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (files[0]) return files[0];
    }
  }
  throw new Error('Codex CLI не найден. Установите Codex или укажите путь к codex.exe в подключении OpenAI.');
}

// Newline-delimited JSON-RPC over stdio; credentials never cross the HTTP API.
export class CodexClient extends EventEmitter {
  constructor(home, executable, spawnProcess = spawn) {
    super(); this.pending = new Map(); this.sequence = 0; this.closed = false;
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const env = { ...process.env, CODEX_HOME: home };
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_IDENTITY_TOKEN_PROVIDER']) delete env[key];
    this.child = spawnProcess(codexExecutable(executable), ['app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', `cli_auth_credentials_store="${process.platform === 'win32' ? 'keyring' : 'file'}"`, '-c', 'forced_login_method="chatgpt"', '-c', 'web_search="disabled"', '-c', 'features.shell_tool=false', '-c', 'features.code_mode=false', '-c', 'features.multi_agent=false'], { env, cwd: home, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) return this.close();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch { this.close(); }
      }
    });
    // Drain diagnostics without exposing OAuth credentials or source text in logs.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.close());
    this.child.on('error', () => this.close());
    this.child.on('exit', () => this.close());
    this.ready = this.request('initialize', { clientInfo: { name: 'writer_helper', title: 'WriterHelper', version: '0.1.8' }, capabilities: { experimentalApi: false } }).then(() => this.send({ method: 'initialized' }));
    this.ready.catch(() => {});
  }
  send(value) { if (this.closed) throw new Error('OpenAI: процесс Codex недоступен'); this.child.stdin.write(JSON.stringify(value) + '\n'); }
  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      // Do not forward arbitrary upstream error data (which can contain secrets).
      message.error ? pending.reject(new Error(`OpenAI: операция ${pending.method} не выполнена. Проверьте вход, модель и версию Codex.`)) : pending.resolve(message.result);
    } else if (message.method && message.id !== undefined) {
      this.send({ id: message.id, error: { code: -32601, message: 'WriterHelper supports text generation only' } });
    } else if (message.method) this.emit('notification', message);
  }
  request(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('OpenAI: процесс Codex недоступен'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`OpenAI: истёк тайм-аут ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async rpc(method, params) { await this.ready; return this.request(method, params); }
  close() {
    if (this.closed) return; this.closed = true; this.child.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('OpenAI: процесс Codex завершён')); }
    this.pending.clear(); this.emit('closed');
  }
}

export class OpenAIProvider {
  constructor(directory, createClient = (home, executable) => new CodexClient(home, executable)) {
    this.directory = path.join(directory, 'openai'); this.createClient = createClient; this.sessions = new Map();
  }
  session(connection) {
    if (!connection || connection.kind !== 'openai' || !/^[a-zA-Z0-9-]{1,100}$/.test(connection.id)) throw new Error('Выберите сохранённое подключение OpenAI');
    let session = this.sessions.get(connection.id);
    if (session && session.executable !== connection.path) { session.client.close(); this.sessions.delete(connection.id); session = null; }
    if (!session || session.client.closed) {
      const home = path.join(this.directory, connection.id);
      const client = this.createClient(home, connection.path);
      session = { client, home, executable: connection.path, login: null };
      client.on('notification', ({ method, params }) => {
        if (method === 'account/login/completed' && session.login?.loginId === params.loginId) {
          session.login = { state: params.success ? 'completed' : 'failed', loginId: params.loginId, ...(params.success ? {} : { error: 'Вход не завершён. Проверьте разрешение входа по коду устройства в настройках ChatGPT и запросите новый код.' }) };
        }
      });
      this.sessions.set(connection.id, session);
    }
    return session;
  }
  async status(connection) {
    const session = this.session(connection), result = await session.client.rpc('account/read', { refreshToken: false });
    const account = result.account?.type === 'chatgpt' ? { email: result.account.email, planType: result.account.planType } : null;
    return { signedIn: !!account, account, login: session.login };
  }
  async login(connection) {
    const session = this.session(connection);
    if (session.login?.state === 'pending') return session.login;
    if (session.starting) return session.starting;
    session.starting = (async () => {
      const result = await session.client.rpc('account/login/start', { type: 'chatgptDeviceCode' });
      const url = new URL(result.verificationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || !result.userCode || !result.loginId) throw new Error('OpenAI: некорректный ответ входа по коду устройства');
      session.login = { state: 'pending', loginId: result.loginId, verificationUrl: url.href, userCode: result.userCode };
      return session.login;
    })();
    try { return await session.starting; } finally { session.starting = null; }
  }
  async cancel(connection) {
    const session = this.session(connection);
    if (session.starting) await session.starting;
    if (session.login?.state === 'pending') await session.client.rpc('account/login/cancel', { loginId: session.login.loginId });
    session.login = null; return { cancelled: true };
  }
  async logout(connection) {
    await this.cancel(connection); await this.session(connection).client.rpc('account/logout'); return { signedIn: false };
  }
  async models(connection) {
    const { client } = this.session(connection); const models = []; let cursor;
    do {
      const result = await client.rpc('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      models.push(...result.data.map(model => model.model)); cursor = result.nextCursor;
    } while (cursor && models.length < 1000);
    return [...new Set(models)];
  }
  async generate(connection, inputMessages, signal, review) {
    if (!(review ? connection.reviewModel || connection.model : connection.model)) throw new Error('Выберите модель OpenAI и сохраните подключение');
    signal.throwIfAborted();
    if (!(await abortable(this.status(connection), signal)).signedIn) throw new Error('Сначала войдите в OpenAI по коду устройства');
    signal.throwIfAborted();
    const { client, home } = this.session(connection);
    const work = path.join(home, 'text-workspace'); fs.mkdirSync(work, { recursive: true });
    const start = client.rpc('thread/start', { model: review ? connection.reviewModel || connection.model : connection.model, modelProvider: 'openai', cwd: work, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, baseInstructions: inputMessages[0].content + '\nРаботай только с переданным текстом. Верни итоговый ответ без инструментов, команд и обращения к файлам.', config: { web_search: 'disabled', 'features.shell_tool': false, 'features.code_mode': false, 'features.multi_agent': false, project_doc_max_bytes: 0 } });
    void start.then(result => { if (signal.aborted) return client.rpc('thread/unsubscribe', { threadId: result.thread.id }); }).catch(() => {});
    const started = await abortable(start, signal);
    const threadId = started.thread.id;
    return new Promise((resolve, reject) => {
      let settled = false, output = '', turnId;
      const interrupt = () => { if (turnId) void client.rpc('turn/interrupt', { threadId, turnId }).catch(() => {}); };
      const finish = (error, text) => {
        if (settled) return; settled = true;
        client.off('notification', notification); client.off('closed', closed); signal.removeEventListener('abort', abort);
        void client.rpc('thread/unsubscribe', { threadId }).catch(() => {});
        error ? reject(error) : resolve(text);
      };
      const abort = () => { interrupt(); finish(new Error('Запрос отменён или истёк тайм-аут')); };
      const closed = () => finish(new Error('OpenAI: процесс Codex завершён'));
      const notification = ({ method, params }) => {
        if (params?.threadId !== threadId) return;
        if (method === 'turn/started') { turnId = params.turn.id; if (signal.aborted) interrupt(); }
        if (method === 'item/completed' && params.item.type === 'agentMessage' && (!params.item.phase || params.item.phase === 'final_answer')) output = params.item.text;
        if (method === 'turn/completed') {
          if (params.turn.status !== 'completed') return finish(new Error('OpenAI: генерация не завершена. Проверьте модель, вход и лимиты аккаунта.'));
          if (!output.trim()) return finish(new Error('Нет полного текстового ответа OpenAI'));
          finish(null, output);
        }
      };
      client.on('notification', notification); client.on('closed', closed); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      client.rpc('turn/start', { threadId, input: [{ type: 'text', text: inputMessages[1].content, text_elements: [] }] }).then(result => { turnId = result.turn.id; if (signal.aborted) interrupt(); }).catch(error => finish(error));
    });
  }
  close() { for (const session of this.sessions.values()) session.client.close(); this.sessions.clear(); }
}
