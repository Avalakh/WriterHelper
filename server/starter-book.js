import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A bundled book initializes a fresh installation only. Updates never replace
// an existing database, even when that database currently contains no books.
export function initializeStarterBook(directory,bundleDirectory){
 const destination=path.resolve(directory),bundle=path.resolve(bundleDirectory);
 if(fs.existsSync(path.join(destination,'writer.sqlite'))||!fs.existsSync(path.join(bundle,'data','writer.sqlite')))return false;
 fs.mkdirSync(destination,{recursive:true});
 const temporary=path.join(destination,'starter-book.sqlite.tmp');
 if(fs.existsSync(temporary))throw Error('Остался незавершённый перенос стартовой книги');
 const reader=new DatabaseSync(path.join(bundle,'data','writer.sqlite'),{readOnly:true});
 try{reader.prepare('VACUUM INTO ?').run(temporary);}finally{reader.close();}
 const db=new DatabaseSync(temporary);
 try{
  const rows=db.prepare('SELECT json FROM entities').all().map(r=>JSON.parse(r.json));
  const book=rows.filter(e=>e.type==='book').sort((a,b)=>a.number-b.number)[0];
  const plan=rows.find(e=>e.type==='plan'&&e.parent===book?.id);
  const chapters=rows.filter(e=>e.type==='chapter'&&e.parent===plan?.id).sort((a,b)=>a.number-b.number);
  const manuscript=chapters.map(c=>rows.find(e=>e.type==='manuscript'&&e.parent===c.id)).find(m=>m?.content.trim());
  const selection=manuscript?.id||book?.id;
  if(selection)db.prepare("INSERT OR REPLACE INTO meta VALUES('starterSelection',?)").run(selection);
  db.exec('PRAGMA journal_mode=DELETE;');
 }finally{db.close();}
 if(fs.existsSync(path.join(bundle,'data','sources')))fs.cpSync(path.join(bundle,'data','sources'),path.join(destination,'sources'),{recursive:true,force:false});
 // Install the database last: interrupted initialization cannot look complete.
 fs.renameSync(temporary,path.join(destination,'writer.sqlite'));
 return true;
}
