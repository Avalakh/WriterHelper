import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const digest = x => createHash('sha256').update(x).digest('hex');
export function receipt(directory) {
 const db = new DatabaseSync(path.join(directory, 'writer.sqlite'), { readOnly:true });
 const entities=db.prepare('SELECT id,type,json FROM entities ORDER BY id').all();
 const history=db.prepare('SELECT id,rev,json FROM history ORDER BY id,rev').all();
 const sources=fs.existsSync(path.join(directory,'sources'))?fs.readdirSync(path.join(directory,'sources')).sort().map(name=>({name,sha:digest(fs.readFileSync(path.join(directory,'sources',name)))})):[];
 db.close(); return {entities:entities.length,history:history.length,sources:sources.length,entityHash:digest(JSON.stringify(entities)),historyHash:digest(JSON.stringify(history)),sourceHash:digest(JSON.stringify(sources))};
}
if(process.argv[2]==='capture') {
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'), target=path.resolve('test-data',`studio-baseline-${stamp}`);
 fs.mkdirSync(target,{recursive:true});fs.mkdirSync('reports',{recursive:true});
 const db=new DatabaseSync(path.resolve('data/writer.sqlite'),{readOnly:true});db.prepare('VACUUM INTO ?').run(path.join(target,'writer.sqlite'));db.close();
 fs.cpSync('data/sources',path.join(target,'sources'),{recursive:true});
 fs.cpSync('src',path.join(target,'frontend-before'),{recursive:true});
 const r={at:new Date().toISOString(),copy:target,live:receipt('data'),backup:receipt(target)};
 fs.writeFileSync('reports/studio-baseline.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r));
}
