import fs from 'node:fs';
import path from 'node:path';
import { fail, hash } from './store.js';
import { parseJsonBundle } from './json-importer.js';

// A directory is only a transport for the same native JSON bundle as file import.
export function readJsonDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) fail('Укажите каталог JSON-пакета WriterHelper');
  let root;
  try { root = fs.realpathSync(directory); } catch { fail('Каталог JSON-пакета не найден'); }
  const read = name => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]+\.json$/.test(name)) fail('Ссылка на файл выходит за каталог пакета');
    let file;
    try { file = fs.realpathSync(path.join(root, name)); } catch { fail(`В пакете отсутствует ${name}`); }
    const relative = path.relative(root, file);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('Ссылка на файл выходит за каталог пакета');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 15 * 1024 * 1024) fail(`Недопустимый файл пакета: ${name}`);
    return { name, content: fs.readFileSync(file, 'utf8') };
  };
  if (!fs.existsSync(path.join(root, 'project.json'))) fail('В каталоге нет project.json собственного формата WriterHelper. Подготовьте JSON-пакет.');
  const project = read('project.json');
  let document;
  try { document = JSON.parse(project.content.replace(/^\uFEFF/, '')); } catch { fail('Формат JSON: не удалось разобрать project.json'); }
  if (document.format !== 'writerhelper-project' || document.version !== 1 || !Array.isArray(document.project?.books)) fail('project.json: нужен собственный формат writerhelper-project/1');
  const files = [project, ...document.project.books.map(ref => read(ref.file))];
  if (files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) > 15 * 1024 * 1024) fail('JSON-пакет слишком большой', 413);
  parseJsonBundle(files);
  return { root, files, fingerprint: hash(JSON.stringify(files)) };
}
