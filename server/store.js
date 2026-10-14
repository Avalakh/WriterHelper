import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { independentMetadata, migrateImportHistory } from './import-history.js';

export const id = () => randomUUID();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
export class Store {
  constructor(directory) {
    this.directory = path.resolve(directory); fs.mkdirSync(this.directory, { recursive: true });
    this.file = path.join(this.directory, 'writer.sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, type TEXT NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history(id TEXT, rev INTEGER, json TEXT NOT NULL, PRIMARY KEY(id,rev)); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);');
    this.migrate(1, db => db.exec('CREATE INDEX IF NOT EXISTS entity_type ON entities(type);'));
    this.migrate(2, migrateImportHistory);
  }
  migrate(version, run) {
    const current = Number(this.db.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value || 0);
    if (version <= current) return;
    // VACUUM INTO captures a consistent database even when another connection has a WAL.
    const backup = `${this.file}.before-${version}`;
    if (!fs.existsSync(backup)) this.db.prepare('VACUUM INTO ?').run(backup);
    this.transaction(() => { run(this.db); this.db.prepare("INSERT OR REPLACE INTO meta VALUES('schema',?)").run(String(version)); });
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  get(key) { const r = this.db.prepare('SELECT json FROM entities WHERE id=?').get(key); return r ? JSON.parse(r.json) : null; }
  all(type) { return (type ? this.db.prepare('SELECT json FROM entities WHERE type=?').all(type) : this.db.prepare('SELECT json FROM entities').all()).map(r => JSON.parse(r.json)); }
  save(value, expected) {
    if (!value.type) fail('Не указан тип материала');
    if ('key' in value || 'apiKey' in value) fail('Секрет нельзя сохранять в проект');
    const key = value.id || id(), old = this.get(key);
    if (old && expected !== old.rev) fail('Материал изменился. Перечитайте новую версию перед сохранением.', 409);
    const next = { ...independentMetadata(value), id: key, rev: (old?.rev || 0) + 1, updated: new Date().toISOString() };
    if (old) this.db.prepare('INSERT OR IGNORE INTO history VALUES(?,?,?)').run(key, old.rev, JSON.stringify(old));
    this.db.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run(key, next.type, JSON.stringify(next));
    return next;
  }
  saveCandidateProgress(key, progress, contextPlan) {
    const old=this.get(key);
    if(!old||old.type!=='candidate'||old.status!=='running')fail('Задача больше не выполняется',409);
    // Progress is transient: do not copy a whole book snapshot into history for every chunk.
    const next={...old,progress,contextPlan,rev:old.rev+1,updated:new Date().toISOString()};
    this.db.prepare('UPDATE entities SET json=? WHERE id=?').run(JSON.stringify(next),key);
    return next;
  }
  remove(key, rev) { const old = this.get(key); if (!old || old.rev !== rev) fail('Конфликт удаления', 409); if (this.all().some(e => e.parent === key)) fail('Сначала удалите дочерние материалы'); this.db.prepare('INSERT OR IGNORE INTO history VALUES(?,?,?)').run(key, old.rev, JSON.stringify(old)); this.db.prepare('DELETE FROM entities WHERE id=?').run(key); }
  versions(key) { return this.db.prepare('SELECT json FROM history WHERE id=? ORDER BY rev DESC').all(key).map(x => JSON.parse(x.json)); }
  restore(key, rev, expected) { const old = this.versions(key).find(x => x.rev === rev); if (!old) fail('Версия не найдена'); return this.save(old, expected); }
  snapshot(bytes) { const sha = hash(bytes), dir = path.join(this.directory, 'sources'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, sha); if (!fs.existsSync(file)) fs.writeFileSync(file, bytes); return sha; }
  close() { this.db.close(); }
}
export function children(store, parent, type) { return store.all().filter(x => x.parent === parent && (!type || x.type === type)).sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id)); }
export function ancestry(store, node) { const list = []; const seen = new Set(); while (node) { if (seen.has(node.id)) fail('Цикл структуры'); seen.add(node.id); list.unshift(node); node = node.parent ? store.get(node.parent) : null; } return list; }
export function createProject(store, title) {
  return store.transaction(() => { const p = store.save({ type: 'project', title, content: '' }); store.save({ type: 'canon', parent: p.id, title: 'Канон (Лор)', content: '', order: 0 }); store.save({ type: 'characters', parent: p.id, title: 'Персонажи', content: '', order: 1 }); return p; });
}
export function createBook(store, parent, title, number) {
  const b = store.save({ type: 'book', parent, title, number, order: number + 1, content: '' });
  ['style', 'world', 'plot', 'plan', 'preview'].forEach((type, order) => store.save({ type, parent: b.id, title: { style: 'Стиль', world: 'Описание мира', plot: 'Сюжет', plan: 'Поглавный план', preview: 'Предпросмотр' }[type], order, content: '', fields: type === 'preview' ? { font: 'Georgia', size: 17, width: 794, height: 1123, fitWidth: false, margin: 60, heading: 26 } : {} })); return b;
}
export function createChapter(store, plan, number, title) {
  const c = store.save({ type: 'chapter', parent: plan, title, number, order: number, content: '' });
  store.save({ type: 'scenes', parent: c.id, title: 'Сцены', order: 0, content: '' }); store.save({ type: 'manuscript', parent: c.id, title: 'Рукопись', order: 1, content: '' }); return c;
}
