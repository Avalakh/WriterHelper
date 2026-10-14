import { hash, fail, children, ancestry } from './store.js';

const formatProject='writerhelper-project';
const formatBook='writerhelper-book';
const version=1;
const plain=x=>x && typeof x==='object' && !Array.isArray(x);
const required=(ok,message)=>{if(!ok)fail(`Формат JSON: ${message}`);};
const record=e=>({id:e.id,title:e.title,content:e.content || '',fields:e.fields || {},...(e.number!==undefined?{number:e.number}:{}),...(e.order!==undefined?{order:e.order}:{}),...(e.provenance?{provenance:{relative:e.provenance.relative,sha256:e.provenance.sha256,locator:e.provenance.locator}}:{})});

export function createJsonBundle(store, projectId){
  const project=store.get(projectId);required(project?.type==='project','проект не найден');
  const canon=children(store,project.id,'canon')[0],characters=children(store,project.id,'characters')[0];
  required(canon&&characters,'у проекта нет лора или раздела персонажей');
  const books=children(store,project.id,'book');
  const files={};
  const references=books.map(book=>({file:`book-${book.number}.json`,id:book.id,number:book.number,title:book.title}));
  files['project.json']={format:formatProject,version,project:{...record(project),canon:{...record(canon),sources:children(store,canon.id,'source').filter(e=>!e.book).map(record)},characters:{...record(characters),items:children(store,characters.id,'character').map(c=>({...record(c),aspects:children(store,c.id,'aspect').map(record)}))},books:references}};
  for(const book of books){
    const docs=Object.fromEntries(children(store,book.id).filter(e=>['style','world','plot','plan','preview'].includes(e.type)).map(e=>[e.type,record(e)]));
    if(docs.world)docs.world.rules=children(store,docs.world.id,'rule').map(record);
    required(['style','world','plot','plan','preview'].every(k=>docs[k]),`книга ${book.number}: нет раздела`);
    const chapters=children(store,docs.plan.id,'chapter').map(chapter=>({
      ...record(chapter),
      scenes:children(store,children(store,chapter.id,'scenes')[0]?.id,'scene').map(record),
      manuscript:record(children(store,chapter.id,'manuscript')[0]),
    }));
    files[`book-${book.number}.json`]={format:formatBook,version,projectId:project.id,book:{...record(book),...docs,chapters,sources:children(store,canon.id,'source').filter(e=>e.book===book.id).map(record)}};
  }
  return files;
}

export function parseJsonBundle(files){
  required(Array.isArray(files)&&files.length>=2,'выберите project.json и хотя бы один файл книги');
  const docs=new Map();
  for(const file of files){
    required(typeof file?.name==='string'&&/^[a-zA-Z0-9._-]+\.json$/u.test(file.name),'недопустимое имя файла');
    required(!docs.has(file.name),`повтор файла ${file.name}`);
    required(typeof file.content==='string','файл должен содержать текст JSON');
    try{docs.set(file.name,JSON.parse(file.content.replace(/^\uFEFF/, '')));}catch{fail(`Формат JSON: не удалось разобрать ${file.name}`);}
  }
  const root=docs.get('project.json');
  required(root?.format===formatProject&&root.version===version,'project.json: нужна версия writerhelper-project/1');
  const p=root.project;required(plain(p)&&typeof p.id==='string'&&p.id&&typeof p.title==='string'&&p.title,'проект: id и title обязательны');
  required(plain(p.canon)&&plain(p.characters)&&Array.isArray(p.canon.sources)&&Array.isArray(p.characters.items),'проект: нужны canon.sources и characters.items');
  required(Array.isArray(p.books)&&p.books.length>0,'проект: перечислите книги');
  required(docs.size===p.books.length+1,'набор файлов не совпадает со списком books');
  const values=[];const add=(value,type,parent,file)=>{
    required(plain(value)&&typeof value.id==='string'&&value.id&&typeof value.title==='string'&&plain(value.fields||{}),`${file}: неверный ${type}`);
    required(value.content===undefined||typeof value.content==='string',`${file}: content должен быть строкой`);
    values.push({id:value.id,type,parent,project:p.id,title:value.title,content:value.content||'',fields:value.fields||{},...(value.number!==undefined?{number:value.number}:{}),...(value.order!==undefined?{order:value.order}:{}),packageFile:file,sourceProvenance:value.provenance||null});
  };
  add(p,'project',undefined,'project.json');
  add({order:0,...p.canon},'canon',p.id,'project.json');
  add({order:1,...p.characters},'characters',p.id,'project.json');
  for(const source of p.canon.sources)add(source,'source',p.canon.id,'project.json');
  for(const c of p.characters.items){add(c,'character',p.characters.id,'project.json');required(Array.isArray(c.aspects),'персонаж: aspects должен быть массивом');for(const a of c.aspects)add(a,'aspect',c.id,'project.json');}
  const bookNumbers=new Set(),bookFiles=new Set();
  for(const ref of p.books){
    required(plain(ref)&&typeof ref.file==='string'&&/^book-[1-9]\d*\.json$/u.test(ref.file)&&Number.isInteger(ref.number)&&ref.number>0,'книга: нужны file и положительный number');
    required(!bookNumbers.has(ref.number)&&!bookFiles.has(ref.file),'повтор номера или файла книги');bookNumbers.add(ref.number);bookFiles.add(ref.file);
    const doc=docs.get(ref.file);required(doc?.format===formatBook&&doc.version===version&&doc.projectId===p.id,`${ref.file}: формат, версия или projectId не совпадают`);
    const b=doc.book;required(plain(b)&&b.id===ref.id&&b.number===ref.number,`${ref.file}: книга не совпадает с project.json`);
    add(b,'book',p.id,ref.file);
    for(const type of ['style','world','plot','plan','preview']) add(b[type],type,b.id,ref.file);
    if(b.world.rules!==undefined){required(Array.isArray(b.world.rules),`${ref.file}: world.rules должен быть массивом`);for(const rule of b.world.rules)add(rule,'rule',b.world.id,ref.file);}
    required(Array.isArray(b.sources)&&Array.isArray(b.chapters),`${ref.file}: нужны sources и chapters`);
    for(const source of b.sources){add(source,'source',p.canon.id,ref.file);values.at(-1).book=b.id;}
    const numbers=new Set();
    for(const chapter of b.chapters){
      required(Number.isInteger(chapter.number)&&chapter.number>0&&!numbers.has(chapter.number),`${ref.file}: номера глав должны быть уникальными и положительными`);numbers.add(chapter.number);
      add(chapter,'chapter',b.plan.id,ref.file);
      values.push({id:`${chapter.id}-scenes`,type:'scenes',parent:chapter.id,title:'Сцены',content:'',fields:{},order:0,packageFile:ref.file});
      required(Array.isArray(chapter.scenes)&&plain(chapter.manuscript),`${ref.file}: главе нужны scenes и manuscript`);
      const sceneNumbers=new Set();
      for(const scene of chapter.scenes){
        required(Number.isInteger(scene.number)&&scene.number>0&&!sceneNumbers.has(scene.number)&&plain(scene.fields)&&scene.fields.номер===scene.number&&typeof scene.fields.атмосфера==='string'&&typeof scene.fields.сюжет==='string'&&Array.isArray(scene.fields.персонажи)&&scene.fields.персонажи.every(x=>typeof x==='string')&&Array.isArray(scene.fields.дополнительные_детали)&&scene.fields.дополнительные_детали.every(x=>typeof x==='string'),`${ref.file}: сцена должна содержать уникальный номер, атмосферу, сюжет, персонажей и детали`);
        sceneNumbers.add(scene.number);
        add(scene,'scene',`${chapter.id}-scenes`,ref.file);
      }
      add(chapter.manuscript,'manuscript',chapter.id,ref.file);
    }
  }
  const seen=new Set();for(const v of values){required(!seen.has(v.id),`повтор id ${v.id}`);seen.add(v.id);}
  for(const v of values)required(!v.parent||seen.has(v.parent),`нет родителя для ${v.id}`);
  return {projectId:p.id,title:p.title,books:p.books.map(x=>({id:x.id,number:x.number,title:x.title})),values,files:[...docs.keys()]};
}

const materialHash=value=>hash(JSON.stringify([value.type,value.parent||null,value.title,value.content||'',value.fields||{},value.number??null,value.order??0,value.book||null]));
function actionFor(old,value){
  if(!old)return 'create';
  const incoming=materialHash(value),current=materialHash(old);
  if(old.importedState===incoming||current===incoming)return 'unchanged';
  if(old.importedState)return current===old.importedState?'update':'conflict';
  // Old imports have only a content/fields baseline. Preserve edits when the incoming text is unchanged.
  const incomingText=hash(JSON.stringify([value.content,value.fields])),currentText=hash(JSON.stringify([old.content||'',old.fields||{}]));
  if(old.importedHash===incomingText&&currentText!==incomingText&&old.title===value.title&&old.parent===value.parent)return 'unchanged';
  // Without a complete baseline it is unsafe to overwrite titles, order or manually created records.
  return 'conflict';
}
export function inspectJsonBundle(store,files){
  const bundle=parseJsonBundle(files),conflicts=[];let create=0,update=0,unchanged=0;
  for(const value of bundle.values){
    const old=store.get(value.id);
    if(!old){create++;continue;}
    required(old.type===value.type,`id ${value.id} уже занят другим типом`);
    required(ancestry(store,old).find(n=>n.type==='project')?.id===bundle.projectId||old.project===bundle.projectId,`id ${value.id} принадлежит другому проекту`);
    const action=actionFor(old,value);
    if(action==='unchanged'){unchanged++;continue;}
    if(action==='conflict')conflicts.push({id:value.id,title:value.title,type:value.type,current:JSON.stringify({title:old.title,content:old.content,fields:old.fields,order:old.order,parent:old.parent},null,2),incoming:JSON.stringify({title:value.title,content:value.content,fields:value.fields,order:value.order,parent:value.parent},null,2)});
    else update++;
  }
  return {...bundle,summary:{files:bundle.files.length,books:bundle.books.length,characters:bundle.values.filter(v=>v.type==='character').length,chapters:bundle.values.filter(v=>v.type==='chapter').length,scenes:bundle.values.filter(v=>v.type==='scene').length,manuscripts:bundle.values.filter(v=>v.type==='manuscript'&&v.content.trim()).length,create,update,unchanged},conflicts};
}

export function importJsonBundle(store,files,decisions={}){
  const inspection=inspectJsonBundle(store,files);
  for(const c of inspection.conflicts)required(['keep','replace'].includes(decisions[c.id]),`решите конфликт ${c.title}`);
  let created=0,updated=0,kept=0;
  store.transaction(()=>{
    const packageSnapshots=new Map(files.map(f=>[f.name,store.snapshot(Buffer.from(f.content,'utf8'))]));
    for(const value of inspection.values){
      const old=store.get(value.id),decision=decisions[value.id];
      if(decision==='keep'){kept++;continue;}
      const importedHash=hash(JSON.stringify([value.content,value.fields]));
      if(actionFor(old,value)==='unchanged')continue;
      const {packageFile,sourceProvenance,...entity}=value;
      const snapshot=store.snapshot(Buffer.from(value.content,'utf8'));
      store.save({...old,...entity,importedHash,importedState:materialHash(entity),provenance:{packageFile,packageSnapshot:packageSnapshots.get(packageFile),...(sourceProvenance?{original:{relative:sourceProvenance.relative,sha256:sourceProvenance.sha256,locator:sourceProvenance.locator}}:{}),locator:sourceProvenance?.locator||value.id,snapshot,sha256:snapshot}},old?.rev);
      if(old)updated++;else created++;
    }
  });
  return {projectId:inspection.projectId,title:inspection.title,summary:inspection.summary,created,updated,kept,conflicts:inspection.conflicts.map(c=>({id:c.id,title:c.title,decision:decisions[c.id]}))};
}
