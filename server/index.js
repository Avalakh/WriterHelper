import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, id, hash, fail, ancestry, children, createProject, createBook, createChapter } from './store.js';
import { seedPrompts } from './prompts.js';
import { initializeStarterBook } from './starter-book.js';
import { effectiveScheme, prepareScheme, makePacket, validateGraph, validateResult, acceptCandidate } from './generation.js';
import { Secrets, callProvider, listModels } from './provider.js';
import { inspectJsonBundle, importJsonBundle } from './json-importer.js';
import { readJsonDirectory } from './directory-importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function makeServer(store, { dev = false, mockProvider, middleware } = {}) {
  const secrets = new Secrets(store.directory), pending = new Map();
  seedPrompts(store);
  const reply = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || ''; if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) fail('Недопустимый Host', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) fail('Запрос из другого приложения запрещён', 403);
      const url = new URL(req.url, `http://${host}`); const route = url.pathname;
      if(route==='/api/desktop/info'&&req.method==='GET')return reply(res,200,{product:'WriterHelper',root,data:path.resolve(store.directory)});
      if (!route.startsWith('/api/')) {
        if (middleware) return middleware(req, res, () => reply(res, 404, { error: 'Не найдено' }));
        const file = path.resolve(root, 'dist', route === '/' ? 'index.html' : `.${route}`);
        if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) fail('Файл не найден. Выполните npm run build.', 404);
        const ext = path.extname(file); res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(file).pipe(res); return;
      }
      let body = {};
      if (req.method !== 'GET') {
        if (req.headers['x-writer-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) fail('Требуется запрос приложения JSON', 403);
        const chunks = []; let bytes = 0; for await (const chunk of req) { chunks.push(chunk); bytes += chunk.length; if (bytes > 15 * 1024 * 1024) fail('Запрос слишком большой', 413); } const raw = Buffer.concat(chunks).toString('utf8'); body = raw ? JSON.parse(raw) : {};
      }
      if (route === '/api/state' && req.method === 'GET') return reply(res, 200, { entities: store.all().map(x => x.type === 'connection' ? { ...x, hasKey: secrets.has(x.id) } : x), dev, initialSelection:store.db.prepare("SELECT value FROM meta WHERE key='starterSelection'").get()?.value||'' });
      if (route === '/api/import/json/format' && req.method === 'GET') { res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(root,'docs','json-import-format.md'))); }
      if (route === '/api/entity' && req.method === 'POST') {
        const { entity, expected } = body;
        const allowed = ['project', 'book', 'chapter', 'scene', 'manuscript', 'source', 'character', 'aspect', 'rule', 'style', 'world', 'plot', 'plan', 'preview', 'prompt', 'scheme', 'scenes', 'characters', 'canon'];
        if (!entity || !allowed.includes(entity.type)) fail('Недопустимый материал');
        if (entity.parent && !store.get(entity.parent)) fail('Родитель не найден');
        if (entity.id === entity.parent) fail('Материал не может быть собственным родителем');
        if (entity.parent && ancestry(store, store.get(entity.parent)).some(x => x.id === entity.id)) fail('Цикл структуры');
        if (entity.type === 'preview') validateResult('json-preview', JSON.stringify(entity.fields));
        if (entity.type === 'scheme') Object.assign(entity, prepareScheme(store, entity));
        if (entity.type === 'scene') { entity.number = entity.fields?.номер; entity.content = entity.fields?.сюжет || ''; validateResult('json-scene', JSON.stringify(entity.fields)); }
        const saved = store.transaction(() => {
          const e = store.save(entity, expected);
          if (['style', 'world', 'plot', 'source', 'character', 'aspect', 'rule', 'scene'].includes(e.type)) {
            const ancestors = ancestry(store, e), book = ancestors.find(x => x.type === 'book'), project = ancestors.find(x => x.type === 'project')?.id || e.project;
            for (const n of store.all().filter(x => ['chapter', 'manuscript'].includes(x.type) && x.id !== e.id)) {
              const chain = ancestry(store, n); if ((book && chain.some(a => a.id === book.id)) || (!book && chain.some(a => a.id === project))) store.save({ ...n, needsReview: true }, n.rev);
            }
          } return e;
        }); return reply(res, 200, saved);
      }
      if (route === '/api/create' && req.method === 'POST') {
        if (!['project', 'book', 'chapter'].includes(body.type)) fail('Недопустимый тип контейнера');
        if (body.type !== 'project' && store.get(body.parent)?.type !== (body.type === 'book' ? 'project' : 'plan')) fail('Неверный родитель контейнера');
        const value = body.type === 'project' ? createProject(store, body.title || 'Новый проект') : store.transaction(() => body.type === 'book' ? createBook(store, body.parent, body.title, body.number) : createChapter(store, body.parent, body.number, body.title)); return reply(res, 200, value);
      }
      if (route === '/api/delete' && req.method === 'POST') { store.transaction(() => store.remove(body.id, body.rev)); return reply(res, 200, { ok: true }); }
      if (route === '/api/versions') return reply(res, 200, store.versions(url.searchParams.get('id')));
      if (route === '/api/restore' && req.method === 'POST') return reply(res, 200, store.restore(body.id, body.rev, body.expected));
      if (route === '/api/import/scan' && req.method === 'POST') {
        const bundle = readJsonDirectory(body.root), result = inspectJsonBundle(store, bundle.files);
        return reply(res, 200, { root: bundle.root, fingerprint: bundle.fingerprint, projectId: result.projectId, title: result.title, books: result.books, summary: result.summary, conflicts: result.conflicts, files: result.files });
      }
      if (route === '/api/import/apply' && req.method === 'POST') {
        const bundle = readJsonDirectory(body.root);
        if (!body.fingerprint || bundle.fingerprint !== body.fingerprint) fail('Пакет изменился после просмотра. Проверьте состав заново.', 409);
        return reply(res, 200, importJsonBundle(store, bundle.files, body.decisions));
      }
      if (route === '/api/import/json/inspect' && req.method === 'POST') { const result=inspectJsonBundle(store,body.files); return reply(res,200,{projectId:result.projectId,title:result.title,books:result.books,summary:result.summary,conflicts:result.conflicts}); }
      if (route === '/api/import/json/apply' && req.method === 'POST') return reply(res,200,importJsonBundle(store,body.files,body.decisions));
      if (route === '/api/snapshot') {
        const sha = url.searchParams.get('hash'); if (!/^[a-f0-9]{64}$/.test(sha)) fail('Неверный адрес снимка'); const f = path.join(store.directory, 'sources', sha); if (!fs.existsSync(f)) fail('Снимок не найден', 404); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(fs.readFileSync(f));
      }
      if (route === '/api/scheme' && req.method === 'GET') { const target = store.get(url.searchParams.get('id')); if (!target) fail('Цель не найдена'); return reply(res, 200, effectiveScheme(store, target)); }
      if (route === '/api/scheme/prompt' && req.method === 'POST') {
        const result = store.transaction(() => {
          if (!body.prompt?.title || !body.prompt?.content) fail('Заполните название и текст');
          const p = store.save({ ...body.prompt, type: 'prompt' }); const old = store.get(body.scheme.id);
          const s = store.save(prepareScheme(store, { ...body.scheme, type: 'scheme', edges: [...(body.scheme.edges || []), { id: `prompt-${p.id}`, source: p.id, to: 'generation', role: 'prompt', enabled: true, order: p.order }] }), body.scheme.rev ?? old?.rev); validateGraph(s.edges); return { prompt: p, scheme: s };
        }); return reply(res, 200, result);
      }
      if (route === '/api/connection' && req.method === 'POST') {
        const { key, ...value } = body; if (!value.model || !['api', 'executor'].includes(value.kind)) fail('Заполните подключение и модель');
        if (value.kind === 'api' && !/^https?:\/\//.test(value.url)) fail('Нужен HTTP(S) адрес API');
        const old = value.id && store.get(value.id); const saved = store.save({ ...value, type: 'connection', reviewModel: value.reviewModel || value.model }, old?.rev); if (key !== undefined) secrets.set(saved.id, key); return reply(res, 200, { ...saved, hasKey: secrets.has(saved.id) });
      }
      if (route === '/api/models' && req.method === 'POST') return reply(res, 200, await listModels(store.get(body.id), secrets));
      if (route === '/api/connection/test' && req.method === 'POST') {
        const connection = store.get(body.id); if (!connection) fail('Подключение не найдено');
        const packet = { target: { title: 'Проверка подключения' }, task: 'Ответь одним словом: Готово', sources: [], prompts: [], contract: 'text', model: connection.model };
        await (mockProvider || callProvider)({ ...connection, maxOutput: connection.maxOutput || 8192 }, packet, secrets); return reply(res, 200, { status: 'Готово' });
      }
      if (route === '/api/packet' && req.method === 'POST') { const packet = makePacket(store, body.target, body); store.save({ id: packet.id, type: 'packet', title: 'Пакет генерации', packet, content: '' }); return reply(res, 200, packet); }
      if (route === '/api/generate' && req.method === 'POST') {
        const packet = store.get(body.packet)?.packet; if (!packet) fail('Подготовьте пакет');
        const target = store.get(packet.target.id); if (target.rev !== packet.target.rev) fail('Материал изменился. Пересоберите пакет.', 409);
        for (const s of packet.sources) { const n = store.get(s.id); if (n && n.rev !== s.rev) fail(`Источник ${s.title} изменился. Пересоберите пакет.`, 409); }
        for (const p of packet.prompts) if (store.get(p.id)?.rev !== p.rev) fail('Промпт изменился. Пересоберите пакет.', 409);
        const candidate = store.save({ type: 'candidate', title: target.title, status: 'running', valid: false, packet, content: '', reviews: [], project: ancestry(store, target).find(x => x.type === 'project')?.id });
        const controller = new AbortController(); pending.set(candidate.id, controller);
        (async () => { try {
          const content = await (mockProvider || callProvider)(store.get(packet.connection), packet, secrets, controller.signal);
          const current = store.get(candidate.id); if (controller.signal.aborted || current.status === 'cancelled') return;
          let valid = true, formatError = ''; try { validateResult(packet.contract, content); } catch (e) { valid = false; formatError = e.message; }
          store.save({ ...current, status: 'ready', content, valid, formatError }, current.rev);
        } catch (e) { const c = store.get(candidate.id); if (c.status !== 'cancelled') store.save({ ...c, status: controller.signal.aborted ? 'cancelled' : 'error', error: e.message.includes('HTTP') || e.status ? e.message : 'Запрос не завершён. Проверьте сервер, протокол и тайм-аут.' }, c.rev); } finally { pending.delete(candidate.id); } })();
        return reply(res, 200, candidate);
      }
      if (route === '/api/candidate/cancel' && req.method === 'POST') { pending.get(body.id)?.abort(); const c = store.get(body.id); return reply(res, 200, store.save({ ...c, status: 'cancelled' }, c.rev)); }
      if (route === '/api/candidate/edit' && req.method === 'POST') { const c = store.get(body.id); let valid = true, formatError = ''; try { validateResult(c.packet.contract, body.content); } catch (e) { valid = false; formatError = e.message; } return reply(res, 200, store.save({ ...c, content: body.content, valid, formatError, reviews: [] }, c.rev)); }
      if (route === '/api/candidate/accept' && req.method === 'POST') return reply(res, 200, acceptCandidate(store, body.id, body.expected));
      if (route === '/api/candidate/review' && req.method === 'POST') {
        const c = store.get(body.id); if (!c || c.status !== 'ready' || !c.valid) fail('Нужен валидный кандидат');
        const connection = store.get(c.packet.connection); const packet = { ...c.packet, candidate: c.content, prompts: c.packet.prompts.filter(p => p.stage === 'review' && (!body.prompts || body.prompts.includes(p.id))) };
        if (!packet.prompts.length) fail('Проверочные промпты отключены');
        const reviewId = id(), controller = new AbortController(); pending.set(c.id, controller);
        const started = { id: reviewId, status: 'Выполняется', findings: [], model: connection.reviewModel || connection.model, hash: hash(c.content), prompts: packet.prompts.map(p => ({ id: p.id, rev: p.rev })) };
        store.save({ ...c, reviews: [...(c.reviews || []), started] }, c.rev);
        let review; try { const text = await (mockProvider || callProvider)(connection, packet, secrets, controller.signal, true); const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); if (!['PASS', 'REVISE', 'BLOCKED'].includes(parsed.verdict) || !Array.isArray(parsed.findings) || parsed.findings.some(f => !['locator','evidence','source','suggestion'].every(k => typeof f[k] === 'string'))) throw new Error(); review = { ...started, status: parsed.verdict, findings: parsed.findings }; } catch { review = { ...started, status: 'Не завершена', findings: [] }; } finally { pending.delete(c.id); }
        const current = store.get(c.id); if (current.content !== c.content) fail('Кандидат изменился во время проверки', 409); return reply(res, 200, store.save({ ...current, reviews: (current.reviews || []).map(r => r.id === reviewId ? review : r) }, current.rev));
      }
      fail('Неизвестная операция', 404);
    } catch (e) { reply(res, e.status || 400, { error: e instanceof SyntaxError ? 'Неверный JSON' : e.message }); }
  });
  server.on('close', () => { for (const c of pending.values()) c.abort(); }); return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev'); let middleware;
  if (dev) { const vite = await import('vite'); middleware = (await vite.createServer({ root, server: { middlewareMode: true }, appType: 'spa' })).middlewares; }
  const directory=process.env.WRITER_DATA || path.join(root,'data');
  initializeStarterBook(directory,path.join(root,'books','iron-mind'));
  const store = new Store(directory);
  for (const c of store.all('candidate').filter(c => c.status === 'running')) store.save({ ...c, status: 'error', error: 'Приложение перезапущено до завершения запроса' }, c.rev);
  const server = makeServer(store, { dev, middleware }); server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log(`WriterHelper: http://127.0.0.1:${server.address().port}`));
}
