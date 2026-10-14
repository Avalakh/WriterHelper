import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexClient, OpenAIProvider } from '../server/openai.js';
import { Store } from '../server/store.js';
import { makeServer } from '../server/index.js';
import { Secrets, callProvider, listModels, messages } from '../server/provider.js';

const connection = { id: 'openai-test', kind: 'openai', model: 'chosen-model', reviewModel: 'review-model', timeout: 2000 };
const packet = { target: { title: 'Глава' }, task: 'Продолжи текст', sources: [{ text: 'Точный источник' }], prompts: [], contract: 'text' };
class FakeClient extends EventEmitter {
  constructor() { super(); this.calls = []; this.account = null; this.closed = false; this.mode = 'completed'; }
  async rpc(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: this.account };
    if (method === 'account/login/start') return { type: 'chatgptDeviceCode', loginId: 'login-1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' };
    if (method === 'account/logout') this.account = null;
    if (method === 'model/list') return params.cursor ? { data: [{ model: 'review-model' }], nextCursor: null } : { data: [{ model: 'chosen-model' }], nextCursor: 'second' };
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') {
      if (this.mode !== 'wait') queueMicrotask(() => {
        this.emit('notification', { method: 'item/completed', params: { threadId: 'other-thread', item: { type: 'agentMessage', text: 'Чужой ответ' } } });
        this.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: 'Итоговый текст', phase: 'final_answer' } } });
        this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'turn-1', status: this.mode } } });
      });
      return { turn: { id: 'turn-1' } };
    }
    return {};
  }
  complete(success = true) {
    if (success) this.account = { type: 'chatgpt', email: 'writer@example.test', planType: 'plus', accessToken: 'never-expose' };
    this.emit('notification', { method: 'account/login/completed', params: { loginId: 'login-1', success, error: 'secret-server-error' } });
  }
  close() { this.closed = true; this.emit('closed'); }
}
function setup(t) {
  fs.mkdirSync('test-data', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('test-data/openai-test-')), clients = [];
  const provider = new OpenAIProvider(directory, () => { const client = new FakeClient(); clients.push(client); return client; });
  t.after(() => provider.close());
  return { directory, provider, clients };
}
test('OpenAI device-code lifecycle, concurrent login, safe account state and isolated sessions', async t => {
  const { provider, clients } = setup(t);
  assert.equal((await provider.status(connection)).signedIn, false);
  const [a, b] = await Promise.all([provider.login(connection), provider.login(connection)]);
  assert.equal(a.userCode, 'ABCD-1234'); assert.deepEqual(a, b);
  assert.equal(clients[0].calls.filter(c => c.method === 'account/login/start').length, 1);
  clients[0].complete(); const state = await provider.status(connection);
  assert.equal(state.signedIn, true); assert.equal(state.login.state, 'completed');
  assert.ok(!JSON.stringify(state).includes('ABCD')); assert.ok(!JSON.stringify(state).includes('never-expose'));
  assert.equal((await provider.status({ ...connection, id: 'other' })).signedIn, false);
  await provider.logout(connection); assert.equal((await provider.status(connection)).signedIn, false);
  await provider.login(connection); clients[0].complete(false);
  const failed = await provider.status(connection); assert.equal(failed.login.state, 'failed'); assert.ok(!JSON.stringify(failed).includes('secret-server-error'));
  await provider.login(connection); await provider.cancel(connection); assert.equal((await provider.status(connection)).login, null);
  assert.ok(clients[0].calls.some(c => c.method === 'account/login/cancel'));
  assert.throws(() => provider.session({ ...connection, id: '../../outside' }), /сохранённое/);
});
test('OpenAI generation and review receive exact packet messages; failed and aborted turns reject partial output', async t => {
  const { provider, clients, directory } = setup(t); const secrets = new Secrets(directory); secrets.openai = provider;
  await assert.rejects(callProvider(connection, packet, secrets), /войдите/);
  await provider.login(connection); clients[0].complete();
  assert.deepEqual(await listModels(connection, secrets), ['chosen-model', 'review-model']);
  assert.equal(await callProvider(connection, packet, secrets, undefined, true), 'Итоговый текст');
  const thread = clients[0].calls.find(c => c.method === 'thread/start').params;
  assert.equal(thread.model, 'review-model'); assert.equal(thread.sandbox, 'read-only'); assert.equal(thread.ephemeral, true);
  assert.ok(thread.baseInstructions.startsWith(messages(packet, true)[0].content));
  assert.equal(clients[0].calls.find(c => c.method === 'turn/start').params.input[0].text, messages(packet, true)[1].content);
  clients[0].mode = 'failed'; await assert.rejects(callProvider(connection, packet, secrets), /не завершена/);
  clients[0].mode = 'wait'; const controller = new AbortController();
  const pending = callProvider(connection, packet, secrets, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 20)); controller.abort(); await assert.rejects(pending, /отменён/);
  assert.ok(clients[0].calls.some(c => c.method === 'turn/interrupt'));
  assert.equal(clients[0].listenerCount('notification'), 1);
  // Keep a handle alive because AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(callProvider({ ...connection, timeout: 20 }, packet, secrets), /тайм-аут/); } finally { clearInterval(keepAlive); }
});
test('JSON-RPC transport initializes, isolates environment, rejects server tool requests and tears down pending calls', async t => {
  const { directory } = setup(t); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  let spawnArgs; const sent = []; child.stdin.on('data', bytes => {
    const request = JSON.parse(bytes.toString()); sent.push(request);
    if (request.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n'));
  });
  const client = new CodexClient(directory, 'codex-test.exe', (...args) => { spawnArgs = args; return child; }); t.after(() => client.close());
  await client.ready; assert.ok(sent.some(message => message.method === 'initialized'));
  assert.equal(spawnArgs[2].env.CODEX_HOME, directory); assert.equal(spawnArgs[2].shell, false); assert.equal(spawnArgs[2].windowsHide, true);
  assert.ok(!('OPENAI_API_KEY' in spawnArgs[2].env));
  const result = client.rpc('model/list', {}); await new Promise(resolve => setImmediate(resolve));
  const request = sent.at(-1), response = JSON.stringify({ id: request.id, result: { data: [] } }) + '\n';
  child.stdout.write(response.slice(0, 8)); child.stdout.write(response.slice(8)); assert.deepEqual(await result, { data: [] });
  child.stdout.write(JSON.stringify({ id: 100, method: 'item/commandExecution/requestApproval', params: {} }) + '\n'); assert.equal(sent.at(-1).error.code, -32601);
  const pending = client.rpc('account/read', {}); await new Promise(resolve => setImmediate(resolve)); client.close(); await assert.rejects(pending, /завершён/);
});
test('Cancellation during account read or thread creation returns promptly and releases late threads', async t => {
  const { provider, clients } = setup(t);
  await provider.status(connection); clients[0].account = { type: 'chatgpt' };
  const original = clients[0].rpc.bind(clients[0]);
  for (const stage of ['account/read', 'thread/start']) {
    let release;
    clients[0].rpc = async (method, params) => method === stage ? new Promise(resolve => { release = resolve; }) : original(method, params);
    const controller = new AbortController(), pending = provider.generate(connection, messages(packet), controller.signal);
    await new Promise(resolve => setImmediate(resolve)); controller.abort(); await assert.rejects(pending, /отменён/);
    release(stage === 'account/read' ? { account: { type: 'chatgpt' } } : { thread: { id: 'late-thread' } });
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(clients[0].calls.some(call => call.method === 'thread/unsubscribe' && call.params.threadId === 'late-thread'));
});
test('HTTP OpenAI routes require saved connections, preserve model-less onboarding and never store auth codes', async t => {
  const { provider, directory } = setup(t); const store = new Store(directory), server = makeServer(store, { openai: provider });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const post = async (route, value, headers = {}) => { const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-writer-client': '1', ...headers }, body: JSON.stringify(value) }); return { status: response.status, data: await response.json() }; };
  const saved = await post('connection', { title: 'OpenAI', kind: 'openai', model: '', key: '' }); assert.equal(saved.status, 200);
  const login = await post('openai/login', { id: saved.data.id }); assert.equal(login.data.userCode, 'ABCD-1234');
  const state = await fetch(base + 'state').then(r => r.json()); assert.ok(!JSON.stringify(state).includes('ABCD-1234')); assert.ok(!JSON.stringify(store.all()).includes('verificationUrl'));
  assert.equal((await post('openai/login', { id: 'missing' })).status, 400);
  assert.equal((await post('openai/login', { id: saved.data.id }, { Origin: 'https://foreign.test' })).status, 403);
  await post('openai/cancel', { id: saved.data.id });
  assert.deepEqual((await post('models', { id: saved.data.id })).data, ['chosen-model', 'review-model']);
});
