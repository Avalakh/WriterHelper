import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createJsonBundle, parseJsonBundle } from '../server/json-importer.js';

const bookTypes=new Set(['project','canon','characters','book','style','world','rule','plot','plan','preview','chapter','scenes','scene','manuscript','character','aspect','source']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const credentials=/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/;
function cleanMetadata(value){
 const next={...value};
 delete next.historicalImportRoot;delete next.importRoot;
 if(next.provenance){next.provenance={...next.provenance};for(const key of ['path','file','historicalPath','historicalFile'])delete next.provenance[key];}
 return next;
}

// One-way publication only. The author's database is opened read-only.
export function publishBook(sourceDirectory,outputDirectory,projectId){
 const source=fs.realpathSync(sourceDirectory),output=path.resolve(outputDirectory);
 const relation=path.relative(source,output);
 if(!relation||path.join(output,'data')===source||(!relation.startsWith('..'+path.sep)&&!path.isAbsolute(relation)))throw Error('Публикация должна находиться вне рабочей папки data и не заменять её');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const staging=fs.mkdtempSync(path.join(path.dirname(output),'.book-publication-'));
 const stagedData=path.join(staging,'data');fs.mkdirSync(stagedData);
 const stagedDb=path.join(stagedData,'writer.sqlite');
 let reader,db;
 try{
  reader=new DatabaseSync(path.join(source,'writer.sqlite'),{readOnly:true});
  reader.prepare('VACUUM INTO ?').run(stagedDb);reader.close();reader=null;
  db=new DatabaseSync(stagedDb);
  const entities=db.prepare('SELECT id,json FROM entities').all().map(r=>JSON.parse(r.json));
  const projects=entities.filter(e=>e.type==='project');
  const project=projectId?projects.find(p=>p.id===projectId):projects.length===1?projects[0]:null;
  if(!project)throw Error('Укажите ID проекта для публикации');
  const selected=new Set([project.id]);
  let added=true;while(added){added=false;for(const e of entities){if(bookTypes.has(e.type)&&!selected.has(e.id)&&(selected.has(e.parent)||e.project===project.id)){selected.add(e.id);added=true;}}}
  // Author prompts and project schemes are useful; runtime connections, packets,
  // candidates, import reports and browser profiles are never published.
  for(const e of entities)if(e.type==='prompt'||(e.type==='scheme'&&(selected.has(e.targetId)||e.scope===project.id)))selected.add(e.id);
  db.exec('BEGIN');
  for(const table of ['entities','history']){
   for(const row of db.prepare(`SELECT rowid,json FROM ${table}`).all()){
    const e=JSON.parse(row.json);
    if(!selected.has(e.id)||(!bookTypes.has(e.type)&&!['prompt','scheme'].includes(e.type)))db.prepare(`DELETE FROM ${table} WHERE rowid=?`).run(row.rowid);
    else db.prepare(`UPDATE ${table} SET json=? WHERE rowid=?`).run(JSON.stringify(cleanMetadata(e)),row.rowid);
   }
  }
  db.exec('COMMIT; PRAGMA journal_mode=DELETE; VACUUM;');
  const store={get:id=>{const row=db.prepare('SELECT json FROM entities WHERE id=?').get(id);return row?JSON.parse(row.json):null;},all:type=>(type?db.prepare('SELECT json FROM entities WHERE type=?').all(type):db.prepare('SELECT json FROM entities').all()).map(r=>JSON.parse(r.json))};
  const bundle=createJsonBundle(store,project.id);
  const files=Object.entries(bundle).map(([name,value])=>({name,content:JSON.stringify(value,null,2)+'\n'}));
  const parsed=parseJsonBundle(files);
  for(const file of files)fs.writeFileSync(path.join(staging,file.name),file.content);
  const snapshots=new Set();
  for(const table of ['entities','history'])for(const row of db.prepare(`SELECT json FROM ${table}`).all()){
   const provenance=JSON.parse(row.json).provenance;
   for(const key of ['snapshot','packageSnapshot'])if(/^[a-f0-9]{64}$/.test(provenance?.[key]||''))snapshots.add(provenance[key]);
  }
  fs.mkdirSync(path.join(stagedData,'sources'));
  for(const sha of [...snapshots].sort()){
   const file=path.join(source,'sources',sha);
   if(!fs.existsSync(file))throw Error(`Нет исходного снимка ${sha}`);
   const bytes=fs.readFileSync(file);
   if(digest(bytes)!==sha)throw Error(`Нарушена целостность снимка ${sha}`);
   if(credentials.test(bytes.toString('utf8')))throw Error('В снимках обнаружена строка ключа; публикация остановлена');
   fs.writeFileSync(path.join(stagedData,'sources',sha),bytes);
  }
  for(const row of db.prepare('SELECT json FROM entities UNION ALL SELECT json FROM history').all())if(credentials.test(row.json))throw Error('В материалах обнаружена строка ключа; публикация остановлена');
  const summary={project:project.id,title:project.title,books:parsed.books.length,chapters:parsed.values.filter(e=>e.type==='chapter').length,scenes:parsed.values.filter(e=>e.type==='scene').length,written:parsed.values.filter(e=>e.type==='manuscript'&&e.content.trim()).length,sources:snapshots.size};
  db.close();db=null;
  fs.mkdirSync(output,{recursive:true});
  for(const file of files)fs.copyFileSync(path.join(staging,file.name),path.join(output,file.name));
  fs.mkdirSync(path.join(output,'data','sources'),{recursive:true});
  fs.copyFileSync(stagedDb,path.join(output,'data','writer.sqlite'));
  for(const sha of snapshots)fs.copyFileSync(path.join(stagedData,'sources',sha),path.join(output,'data','sources',sha));
  // Remove obsolete source snapshots only in this managed publication directory.
  for(const name of fs.readdirSync(path.join(output,'data','sources')))if(/^[a-f0-9]{64}$/.test(name)&&!snapshots.has(name))fs.unlinkSync(path.join(output,'data','sources',name));
  return summary;
 }finally{
  reader?.close();db?.close();
  const relative=path.relative(path.dirname(output),staging);
  if(relative.startsWith('.book-publication-')&&!relative.includes(path.sep))fs.rmSync(staging,{recursive:true,force:true});
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [source=process.env.WRITER_DATA||'data',output='books/iron-mind',project]=process.argv.slice(2);
 console.log(JSON.stringify(publishBook(source,output,project),null,2));
}
