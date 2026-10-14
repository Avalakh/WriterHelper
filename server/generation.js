import { ancestry, children, fail, hash, id } from './store.js';
import { applicablePrompts } from './prompts.js';

export const roles = ['constraint', 'events', 'style', 'participants', 'boundary', 'editing'];
const edge = (source, role, required = false) => ({ id: `default-${source}`, source, to: 'generation', role, required, enabled: true });
export function defaultEdges(type) {
  const basic = ['plot', 'chapter', 'scene', 'manuscript', 'character', 'world'].includes(type) ? [edge('canon', 'constraint'), edge('world', 'constraint'), edge('characters', 'participants')] : [];
  if (['plot', 'chapter', 'scene', 'manuscript'].includes(type)) basic.push(edge('style', 'style'));
  if (['chapter', 'scene', 'manuscript'].includes(type)) basic.push(edge('scenarioRange', 'events', true), edge('plot', 'constraint', true), edge('previous', 'boundary'), edge('next', 'boundary'));
  if (type === 'manuscript' || type === 'scene') basic.push(edge('chapterPlan', 'events', true));
  if (type === 'preview') basic.push(edge('current', 'editing', true), edge('manuscripts', 'constraint'));
  return basic;
}
export function effectiveScheme(store, target) {
  const chain = ancestry(store, target).map(x => x.id); const edges = new Map(defaultEdges(target.type).map(e => [e.id, { ...e, inherited: 'По умолчанию' }]));
  applicablePrompts(store, target).forEach(p => edges.set(`prompt-${p.id}`, { id: `prompt-${p.id}`, source: p.id, to: 'generation', role: 'prompt', order: p.order, enabled: true, inherited: p.scope }));
  const schemes = store.all('scheme').filter(s => s.targetType === target.type && (s.scope === 'application' || chain.includes(s.scope))).sort((a, b) => (a.scope === 'application' ? -1 : chain.indexOf(a.scope)) - (b.scope === 'application' ? -1 : chain.indexOf(b.scope)));
  const conflicts = [];
  for (const s of schemes) {
    for (const e of s.edges || []) { if (e.baseHash && e.baseHash !== edgeHash(edges.get(e.id))) conflicts.push(`Связь ${e.id}: изменилась основа; пересмотрите локальное отличие в конструкторе`); edges.set(e.id, { ...edges.get(e.id), ...e, inherited: s.scope, version: s.rev }); }
  }
  const result = [...edges.values()]; validateGraph(result); return { edges: result, conflicts, schemes };
}
export function edgeHash(e) { if (!e) return ''; const { inherited, version, baseHash, ...value } = e; return hash(JSON.stringify(value)); }
export function prepareScheme(store, value) {
  const target = store.get(value.targetId); if (!target) fail('Укажите цель схемы');
  const chain = ancestry(store, target).map(x => x.id);
  if (value.scope !== 'application' && !chain.includes(value.scope)) fail('Область схемы не относится к цели');
  // Only differences are stored; upstream changes remain visible.
  const parentTarget = { ...target };
  const upper = store.all('scheme').filter(s => s.targetType === target.type && s.scope !== value.scope && (s.scope === 'application' || chain.indexOf(s.scope) < chain.indexOf(value.scope)));
  const base = new Map(defaultEdges(target.type).map(e => [e.id, e]));
  applicablePrompts(store, target).forEach(p => base.set(`prompt-${p.id}`, { id: `prompt-${p.id}`, source: p.id, to: 'generation', role: 'prompt', order: p.order, enabled: true, inherited: p.scope }));
  for (const s of upper.sort((a,b) => chain.indexOf(a.scope) - chain.indexOf(b.scope))) for (const e of s.edges || []) base.set(e.id, { ...base.get(e.id), ...e });
  const clean = e => { const { inherited, version, baseHash, ...v } = e; return v; };
  const differences = (value.edges || []).filter(e => JSON.stringify(clean(e)) !== JSON.stringify(clean(base.get(e.id) || {}))).map(e => ({ ...clean(e), baseHash: edgeHash(base.get(e.id)) }));
  validateGraph(value.edges || []); return { ...value, edges: differences, targetType: parentTarget.type };
}
export function validateGraph(edges) {
  const ids = new Set(); const next = new Map();
  for (const e of edges) {
    if (ids.has(e.id)) fail(`Повтор связи ${e.id}`); ids.add(e.id);
    if (!e.enabled) continue;
    if (!e.source || !e.to) fail(`Неполная связь ${e.id}`);
    if (e.role !== 'prompt' && !roles.includes(e.role)) fail(`Неизвестная роль ${e.id}`);
    if (e.source === 'current' && e.role === 'editing') continue;
    next.set(e.source, [...(next.get(e.source) || []), e.to]);
  }
  const visiting = new Set(), done = new Set();
  function visit(n) { if (visiting.has(n)) fail(`Цикл зависимостей у узла ${n}`); if (done.has(n)) return; visiting.add(n); for (const c of next.get(n) || []) visit(c); visiting.delete(n); done.add(n); }
  for (const n of next.keys()) visit(n);
}
export function chapterPlan(store, chapter) {
  const scenes = children(store, children(store, chapter.id, 'scenes')[0]?.id, 'scene');
  return { номер: chapter.number, название: chapter.title, ...(chapter.content ? { подробный_план: chapter.content } : {}), сцены: scenes.map(s => ({ ...s.fields, номер: s.number, атмосфера: s.fields?.атмосфера || '', сюжет: s.fields?.сюжет || s.content || '', персонажи: s.fields?.персонажи || [], дополнительные_детали: s.fields?.дополнительные_детали || [] })) };
}
function sourceValue(node, text, role, locator) { return { id: node.id, rev: node.rev, title: node.title, text: text ?? node.content ?? '', role, locator: locator || node.provenance?.locator || node.id, sha256: hash(text ?? node.content ?? '') }; }
function rangeForChapter(plot, number) {
  const starts = [...plot.matchAll(/^#{2,3}\s+Глава\s+(\d+)[.\s:—-]+[^\r\n]*/gmu)];
  const m = starts.find(x => Number(x[1]) === number);
  if (m) { const at = starts.indexOf(m); return plot.slice(m.index, starts[at + 1]?.index || plot.length); }
  const row = plot.split('\n').find(l => new RegExp(`^\\|\\s*${number}\\s*\\|`).test(l)); return row || '';
}
export function makePacket(store, targetId, request) {
  const target = store.get(targetId); if (!target) fail('Цель не найдена');
  if(request.expectedRev!==undefined&&request.expectedRev!==target.rev)fail('Рукопись изменилась. Выделите фрагмент или место вставки заново.',409);
  let range;
  if(request.range!==undefined){
    const r=request.range;
    if(target.type!=='manuscript'||!r||!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<r.start||r.end>target.content.length||typeof r.text!=='string'||target.content.slice(r.start,r.end)!==r.text)fail('Неверные границы фрагмента рукописи');
    if(!['revise','insert'].includes(request.operation)||(request.operation==='revise'&&r.start===r.end)||(request.operation==='insert'&&r.start!==r.end))fail('Выделите текст для переработки или поставьте курсор для вставки');
    range={start:r.start,end:r.end,text:r.text};
  }
  if(request.operation==='insert'&&!range)fail('Укажите место вставки в рукописи');
  if (['project', 'book', 'plan', 'scenes', 'characters', 'canon'].includes(target.type)) fail('Выберите конкретный материал для генерации');
  const connection = store.get(request.connection); if (!connection || connection.type !== 'connection') fail('Выберите подключение ИИ');
  const ancestors = ancestry(store, target), book = ancestors.find(x => x.type === 'book'), project = ancestors.find(x => x.type === 'project'), chapter = ancestors.find(x => x.type === 'chapter');
  const bookDocs = book ? children(store, book.id) : [];
  const { edges, conflicts } = effectiveScheme(store, target); if (conflicts.length) fail(conflicts.join('\n'));
  if (edges.some(e => e.enabled !== false && e.source === target.id && e.role !== 'editing')) fail(`Цикл генерации: ${target.title} зависит от собственного результата`);
  const sources = [], prompts = [], errors = [];
  const allChapters = chapter ? children(store, chapter.parent, 'chapter') : [];
  const chapterIndex = allChapters.findIndex(c => c.id === chapter?.id);
  const location = request.location || target.fields?.location || chapter?.fields?.location;
  const scopeIds = ancestors.map(x => x.id);
  const variables = { title: target.title, book: book?.title || '', chapter: chapter?.title || '', pov: request.pov || bookDocs.find(d => d.type === 'style')?.fields?.pov || '', ...request.variables };
  function temporalText(n) {
    const f = n.fields || {};
    if (f.conflict) { errors.push(`${n.title}: ${f.conflict}`); return null; }
    if (f.location && f.location !== location) return null;
    if (f.book && f.book !== book?.id) return null;
    if (chapter && ((f.from && f.from > chapter.number) || (f.until && f.until < chapter.number))) return null;
    if (f.knowledge === 'pov' && f.pov && f.pov !== variables.pov) return null;
    if (f.unresolved) { errors.push(`${n.title}: требуется уточнить состояние`); return null; }
    return n.content;
  }
  for (const e of edges.filter(e => e.enabled !== false && e.to === 'generation')) {
    const direct = store.get(e.source);
    if (e.role === 'prompt') {
      if (!direct || direct.type !== 'prompt') { errors.push(`Промпт ${e.source} не найден`); continue; }
      if (direct.enabled === false) continue;
      let content = direct.content;
      for (const name of direct.variables || []) if (!variables[name]) errors.push(`Промпт ${direct.title}: заполните ${name}`);
      content = content.replace(/\{\{(\w+)\}\}/g, (_, name) => { if (!variables[name]) errors.push(`Не задана переменная ${name}`); return variables[name] || ''; });
      prompts.push({ id: direct.id, rev: direct.rev, title: direct.title, text: content, order: e.order ?? direct.order, stage: direct.stage, scope: direct.scope }); continue;
    }
    let selected = [];
    if (e.source === 'chapterPlan' && chapter) { const plan=chapterPlan(store,chapter); selected = [sourceValue(chapter, plan.сцены.length || chapter.content ? JSON.stringify(plan, null, 2) : '', e.role)]; }
    else if (e.source === 'scenarioRange' && chapter) { const plot = bookDocs.find(d => d.type === 'plot'); if (chapter.fields?.scenarioRange) selected=[sourceValue(chapter,chapter.fields.scenarioRange,e.role,'назначенный автором диапазон')]; else if (plot) { const range=rangeForChapter(plot.content, chapter.number); if (range) selected=[sourceValue(plot,range,e.role,`глава/${chapter.number}`)]; else if (chapter.content) selected=[sourceValue(chapter,chapter.content,e.role,'подробный план главы; явный fallback для Markdown без сценарного диапазона')]; } }
    else if (e.source === 'current') selected = [sourceValue(target, target.type === 'preview' ? JSON.stringify(target.fields) : target.content, e.role)];
    else if (e.source === 'manuscripts' && book) { const plan=bookDocs.find(d=>d.type==='plan'); for(const c of children(store,plan?.id,'chapter')){const m=children(store,c.id,'manuscript')[0];if(m?.content.trim())selected.push(sourceValue(m,m.content,e.role,`глава/${c.number}/рукопись`));} }
    else if (e.source === 'previous' || e.source === 'next') { const c = allChapters[chapterIndex + (e.source === 'previous' ? -1 : 1)]; if (c) selected = [sourceValue(c, JSON.stringify({ номер: c.number, название: c.title, назначение: 'Только граница; события соседней главы нельзя переносить в целевой текст' }), 'boundary')]; }
    else if (e.source === 'canon') selected = store.all('source').filter(s => s.project === project?.id && (!s.book || s.book === book?.id)).map(s => { const text = temporalText(s); return text === null ? null : sourceValue(s, text, e.role); }).filter(Boolean);
    else if (e.source === 'characters') {
      const names = target.type === 'scene' ? target.fields?.персонажи || [] : chapter ? chapterPlan(store, chapter).сцены.flatMap(s => s.персонажи || []) : null;
      const fallbackText = chapter && !names?.length ? `${chapter.content || ''}\n${chapter.fields?.scenarioRange || ''}` : '';
      const people = store.all('character').filter(c => c.project === project?.id && (!c.fields?.firstBook || c.fields.firstBook <= (book?.number || 0)) && (names?.length ? names.includes(c.title) || (c.fields?.aliases || []).some(n => names.includes(n)) : fallbackText ? [c.title,...(c.fields?.aliases || [])].some(n => fallbackText.includes(n)) : !chapter));
      selected = people.flatMap(c => {
        const aspects = store.all('aspect').filter(a => a.parent === c.id && (!a.fields?.book || a.fields.book === book?.id));
        const hiddenIdentity = !!names?.length && !names.includes(c.title) && names.some(n => (c.fields?.concealedLabels || []).includes(n));
        const sceneLabel = hiddenIdentity ? names.find(n => (c.fields?.concealedLabels || []).includes(n)) : null;
        return [sourceValue(hiddenIdentity ? { ...c, title: sceneLabel, provenance: null } : c, hiddenIdentity ? `В выбранном материале участник обозначен как «${sceneLabel}». Его имя для POV пока не установлено; используйте только сведения из назначенного сюжета.` : temporalText(c), e.role), ...(!hiddenIdentity ? aspects.map(a => { const text = temporalText(a); return text === null ? null : sourceValue(a, text, e.role); }).filter(Boolean) : [])];
      });
    }
    else if (['style', 'world', 'plot'].includes(e.source)) {
      const n = bookDocs.find(d => d.type === e.source);
      if (n) { selected = [sourceValue(n, n.content, e.role)]; if (e.source === 'world') selected.push(...children(store, n.id, 'rule').map(r => { const text = temporalText(r); return text === null ? null : sourceValue(r, text, e.role); }).filter(Boolean)); }
    } else if (direct && ['source', 'style', 'world', 'plot', 'chapter', 'scene', 'manuscript', 'character', 'aspect', 'rule'].includes(direct.type)) {
      if (!ancestry(store, direct).some(a => a.id === project?.id) && direct.project !== project?.id && !scopeIds.includes(direct.parent)) errors.push(`Источник ${direct.title} относится к другому проекту`);
      const text = temporalText(direct); if (text !== null) selected = [sourceValue(direct, direct.type === 'scene' ? JSON.stringify(direct.fields) : text, e.role)];
    } else errors.push(`Источник ${e.source} не найден`);
    for (const s of selected) {
      if (s.text === null) continue;
      if (e.fragment) { if (!s.text.includes(e.fragment)) { errors.push(`Фрагмент источника ${s.title} изменился`); continue; } s.text = e.fragment; s.sha256 = hash(s.text); s.locator = `${s.locator}:фрагмент`; }
      if (store.get(s.id)?.fields?.url && !s.text.trim()) errors.push(`${s.title}: ссылка не подготовлена; добавьте точный текст источника`);
      if (s.text.trim()) sources.push(s);
    }
    if (e.required && !selected.some(s => s?.text?.trim())) errors.push(`Обязательный источник ${e.source} пуст`);
  }
  if (request.operation && request.operation !== 'create' && target.type !== 'preview' && !sources.some(s => s.id === target.id && s.role === 'editing')) sources.push(sourceValue(target, target.content, 'editing'));
  prompts.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (request.selection && (!target.content.includes(request.selection) || request.operation !== 'revise')) errors.push('Выделенный диапазон изменился или операция не является переработкой');
  const packet = { id: id(), target: { id: target.id, rev: target.rev, type: target.type, title: target.title, number: target.number }, operation: request.operation || 'create', selection: request.selection || '', task: request.task || target.task || '', variables, model: connection.model, connection: connection.id, sources, prompts, contract: target.type === 'chapter' ? 'json-chapter' : target.type === 'scene' ? 'json-scene' : target.type === 'preview' ? 'json-preview' : 'text', created: new Date().toISOString() };
  if(range)packet.range=range;
  if (!packet.task.trim()) errors.push('Задайте задачу для ИИ');
  const serialized = JSON.stringify(packet); const estimated = Math.ceil(Buffer.byteLength(serialized, 'utf8') / 2);
  packet.budget = { estimatedTokens: estimated, mode: 'Консервативная оценка UTF-8, не токенизатор модели', limit: connection.context || 128000, response: connection.maxOutput || 8000 };
  if (estimated + packet.budget.response > packet.budget.limit) errors.push(`Контекст ${estimated} + ответ ${packet.budget.response} превышают ${packet.budget.limit}. Выберите модель или явно измените фрагменты.`);
  if (errors.length) fail(errors.join('\n'));
  packet.fingerprint = hash(JSON.stringify(packet)); return packet;
}
export function validateResult(contract, text) {
  if (typeof text !== 'string' || !text.trim()) fail('Пустой ответ ИИ');
  if (contract === 'text') return text;
  let data; try { data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { fail('Ответ не соответствует JSON-контракту'); }
  const scene = s => Number.isInteger(s.номер) && typeof s.атмосфера === 'string' && typeof s.сюжет === 'string' && Array.isArray(s.персонажи) && s.персонажи.every(x => typeof x === 'string') && Array.isArray(s.дополнительные_детали) && s.дополнительные_детали.every(x => typeof x === 'string');
  if (contract === 'json-scene' && !scene(data)) fail('Отсутствуют обязательные поля сцены');
  if (contract === 'json-chapter' && !(Number.isInteger(data.номер) && typeof data.название === 'string' && Array.isArray(data.сцены) && data.сцены.length && data.сцены.every(scene))) fail('Неверные поля главы/сцен');
  if (contract === 'json-preview' && !(typeof data.font === 'string' && data.font.length < 100 && Number.isFinite(data.size) && data.size >= 10 && data.size <= 40 && Number.isFinite(data.width) && data.width >= 300 && data.width <= 4000 && Number.isFinite(data.height) && data.height >= 400 && data.height <= 6000 && Number.isFinite(data.margin) && data.margin >= 10 && data.margin < Math.min(data.width, data.height) / 3 && Number.isFinite(data.heading) && data.heading >= 12 && data.heading <= 60)) fail('Неверные настройки оформления');
  return data;
}
export function acceptCandidate(store, candidateId, expected) {
  return store.transaction(() => {
    const c = store.get(candidateId); if (!c || c.status !== 'ready' || !c.valid) fail('Кандидат не готов к принятию');
    const target = store.get(c.packet.target.id); if (target.rev !== c.packet.target.rev || expected !== target.rev) fail('Исходник изменился. Выполните новое сравнение и повторную генерацию.', 409);
    const value = validateResult(c.packet.contract, c.content); let next = { ...target };
    if (target.type === 'preview' || target.type === 'scene') { next.fields = value; if (target.type === 'scene') { next.content = value.сюжет; next.number = value.номер; } }
    else if (target.type === 'chapter') {
      if (value.номер !== target.number || value.название !== target.title) fail('Кандидат изменяет авторские границы главы');
      const group = children(store, target.id, 'scenes')[0];
      const old = children(store, group.id, 'scene');
      for (const s of value.сцены) { const existing = old.find(x => x.number === s.номер); store.save({ ...(existing || {}), type: 'scene', parent: group.id, title: existing?.title || `Сцена ${s.номер}`, number: s.номер, order: s.номер, fields: s, content: s.сюжет }, existing?.rev); }
      for (const o of old.filter(x => !value.сцены.some(s => s.номер === x.number))) store.remove(o.id, o.rev);
    } else if(c.packet.range){
      const r=c.packet.range;
      if(!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<r.start||r.end>target.content.length||target.content.slice(r.start,r.end)!==r.text)fail('Границы фрагмента изменились',409);
      next.content=target.content.slice(0,r.start)+value+target.content.slice(r.end);
    } else next.content = c.packet.selection ? target.content.replace(c.packet.selection, value) : c.packet.operation === 'append' ? `${target.content}\n\n${value}` : value;
    next = store.save(next, target.rev); store.save({ ...c, status: 'accepted' }, c.rev); return next;
  });
}
