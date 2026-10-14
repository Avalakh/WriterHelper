import path from 'node:path';
import { Store } from '../server/store.js';
import { seedPrompts } from '../server/prompts.js';
import { readJsonDirectory } from '../server/directory-importer.js';
import { importJsonBundle } from '../server/json-importer.js';

if (!process.argv[2]) throw Error('Использование: npm run import:json -- КАТАЛОГ_JSON_ПАКЕТА');
const bundle = readJsonDirectory(process.argv[2]);
const store = new Store(path.resolve(process.env.WRITER_DATA || 'data'));
try {
  seedPrompts(store);
  console.log(JSON.stringify(importJsonBundle(store, bundle.files), null, 2));
} finally { store.close(); }
