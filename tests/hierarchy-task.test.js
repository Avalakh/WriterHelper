import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store,createProject,createBook,createChapter,children } from '../server/store.js';
import { makePacket,validateResult,acceptCandidate } from '../server/generation.js';
import { messages } from '../server/provider.js';
import { runHierarchy,estimateHierarchyCall } from '../server/hierarchy-run.js';
function setup(t) {
 fs.mkdirSync('test-data',{recursive:true});const store=new Store(fs.mkdtempSync(path.resolve('test-data/hierarchy-')));t.after(()=>store.close());
 const project=createProject(store,'Проект'),book=createBook(store,project.id,'Книга',1),plan=children(store,book.id,'plan')[0],chapter=createChapter(store,plan.id,1,'Встреча');
 const manuscript=children(store,chapter.id,'manuscript')[0];const m=store.save({...manuscript,content:'Незнайка грустит.'},manuscript.rev);
 const plot=children(store,book.id,'plot')[0];store.save({...plot,content:'Незнайка ищет друга.'},plot.rev);
 const connection=store.save({type:'connection',title:'ИИ',model:'mock',kind:'api',context:262144,maxOutput:1000});
 const request={connection:connection.id,task:'Кто такой Незнайка?',scopeDown:true};
 return {store,project,book,plan,chapter,m,connection,request};
}
const ready=(x,p,data)=>x.store.save({type:'candidate',title:p.target.title,packet:p,status:'ready',valid:true,content:JSON.stringify(data)});
const data=(changes=[])=>({summary:'Предложения',findings:[],changes});
test('search includes entire subtree, exact locations, project references, excludes other books and service entities',t=>{
 const x=setup(t),other=createBook(x.store,x.project.id,'Другая',2);x.store.save({type:'candidate',parent:x.chapter.id,title:'Служебный',content:'Скрыто'});
 const p=makePacket(x.store,x.book.id,{...x.request,scopeDown:false,operation:'search'});
 assert.ok(p.scope.some(s=>s.id===x.m.id));assert.ok(p.scope.some(s=>s.id===x.plan.id));assert.ok(p.scope.every(s=>!['candidate','packet'].includes(s.type)));assert.ok(p.references.some(s=>s.id===other.id));
 assert.match(p.scope.find(s=>s.id===x.m.id).path,/Книга.*Встреча.*Рукопись/);assert.match(messages(p)[0].content,/Поиск/);
 assert.throws(()=>validateResult(p.contract,JSON.stringify(data([{id:x.m.id,reason:'Правка',content:'Новый'}])),p),/не изменяют/);
 validateResult(p.contract,JSON.stringify({summary:'Нашёл',findings:[{id:x.m.id,quote:'Незнайка грустит.',message:'Глава 1'}],changes:[]}),p);
 assert.throws(()=>validateResult(p.contract,JSON.stringify({summary:'Нашёл',findings:[{id:x.m.id,quote:'Вымышленное',message:'Глава 1'}],changes:[]}),p),/цитату/);
});
test('selected changes apply atomically, preserve unselected text and unknown fields, store history',t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'revise'}),c=ready(x,p,data([{id:x.m.id,reason:'Эмоции',content:'Незнайка смахнул слезу.'},{id:x.chapter.id,reason:'План',content:'Новый план'}]));
 assert.equal(x.store.get(x.m.id).content,'Незнайка грустит.');
 acceptCandidate(x.store,c.id,p.target.rev,[0]);assert.equal(x.store.get(x.m.id).content,'Незнайка смахнул слезу.');assert.equal(x.store.get(x.chapter.id).content,'');assert.equal(x.store.versions(x.m.id)[0].content,'Незнайка грустит.');
 assert.throws(()=>acceptCandidate(x.store,c.id,p.target.rev,[1]),/не готов/);
});
test('stale descendants or newly added nodes block all writes',t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'suggest'}),c=ready(x,p,data([{id:x.m.id,reason:'Эмоции',content:'Новый текст'}]));
 x.store.save({...x.chapter,content:'Авторская правка'},x.chapter.rev);
 assert.throws(()=>acceptCandidate(x.store,c.id,p.target.rev,[0]),/Иерархия изменилась/);assert.equal(x.store.get(x.m.id).content,'Незнайка грустит.');
 const p2=makePacket(x.store,x.book.id,{...x.request,operation:'suggest'}),c2=ready(x,p2,data([{id:x.m.id,reason:'Эмоции',content:'Новый текст'}]));createChapter(x.store,x.plan.id,2,'Позже');
 assert.throws(()=>acceptCandidate(x.store,c2.id,p2.target.rev,[0]),/Иерархия изменилась/);
});
test('character completion creates reviewed cards and aspects only inside target',t=>{
 const x=setup(t),group=children(x.store,x.project.id,'characters')[0],p=makePacket(x.store,group.id,{...x.request,operation:'append'});
 assert.ok(p.references.some(s=>s.type==='plot'));
 const d=data([{parent:group.id,type:'character',title:'Незнайка',content:'Ищет друга.',reason:'Из сюжета',fields:{aliases:['Н.']}}]);validateResult(p.contract,JSON.stringify(d),p);
 const c=ready(x,p,d),[person]=acceptCandidate(x.store,c.id,p.target.rev,[0]);assert.equal(person.title,'Незнайка');
 const p2=makePacket(x.store,person.id,{...x.request,operation:'suggest'}),c2=ready(x,p2,data([{parent:person.id,type:'aspect',title:'Эмоции',content:'Скрывает грусть.',reason:'Предложение автора'}]));
 assert.equal(acceptCandidate(x.store,c2.id,p2.target.rev,[0])[0].parent,person.id);
 assert.throws(()=>validateResult(p.contract,JSON.stringify(data([{id:x.m.id,content:'Чужое',reason:'Выход'}])),p),/за выбранную/);
});
test('oversized snapshots prepare without requiring a smaller target',t=>{
 const x=setup(t);x.store.save({...x.connection,context:10000},x.connection.rev);x.store.save({...x.m,content:'Глава. '.repeat(10000)},x.m.rev);const p=makePacket(x.store,x.book.id,{...x.request,operation:'check'});assert.equal(p.contextMode,'model-planned');assert.ok(p.scope.find(s=>s.id===x.m.id).content.length>50000);
});
test('model chooses plot grounds; character descriptions never reach planning or fill calls by default',async t=>{
 const x=setup(t),group=children(x.store,x.project.id,'characters')[0],person=x.store.save({type:'character',parent:group.id,title:'Незнайка',content:'SECRET_EXISTING_PROFILE',fields:{role:''}}),p=makePacket(x.store,group.id,{...x.request,operation:'append'}),calls=[];
 const result=await runHierarchy(x.connection,p,null,new AbortController().signal,async(_c,part)=>{
   calls.push(part);assert.ok(!JSON.stringify(part).includes('SECRET_EXISTING_PROFILE'));assert.ok(!JSON.stringify(messages(part)).includes('SECRET_EXISTING_PROFILE'));
   if(part.hierarchyStage==='plan')return JSON.stringify({sourceIds:part.catalog.filter(e=>e.type==='plot').map(e=>e.id),inspectTargetIds:[],reason:'Основание — сюжет; карточки кратко'});
   if(part.hierarchyStage==='summary')return JSON.stringify({summary:'Дополнено по сюжету'});
   assert.ok(part.reads.some(r=>r.text.includes('Незнайка ищет друга.')));
   return JSON.stringify(data([{id:person.id,contentAppend:'Ищет друга.',fields:{role:'Искатель'},reason:'Из сюжета'}]));
 });
 assert.ok(calls.some(c=>c.hierarchyStage==='plan'));assert.ok(result.contextPlan.sourceIds.some(id=>p.references.find(s=>s.id===id)?.type==='plot'));const c=ready(x,p,JSON.parse(result.text));acceptCandidate(x.store,c.id,p.target.rev,[0]);assert.equal(x.store.get(person.id).content,'SECRET_EXISTING_PROFILE\n\nИщет друга.');
});
test('large source is fully chunked within call budgets and findings from every part survive reduction',async t=>{
 const x=setup(t),connection={...x.connection,context:10000,maxOutput:1000};const text=Array.from({length:1200},(_,i)=>`Строка ${i}: Незнайка ищет друга.\n`).join('');x.store.save({...x.m,content:text},x.m.rev);const p=makePacket(x.store,x.book.id,{...x.request,operation:'search'}),calls=[];
 const result=await runHierarchy(connection,p,null,new AbortController().signal,async(_c,part)=>{
   calls.push(part);assert.ok(estimateHierarchyCall(part)+connection.maxOutput<=connection.context);
   if(part.hierarchyStage==='plan')return JSON.stringify({sourceIds:[],inspectTargetIds:[],reason:'Поиск во всех материалах цели'});
   if(part.hierarchyStage==='summary')return JSON.stringify({summary:'Общий итог поиска'});
   return JSON.stringify({summary:'Часть проверена',findings:part.reads.filter(r=>r.id===x.m.id).map(r=>({id:r.id,quote:r.text.slice(0,20),message:`Фрагмент ${r.start}`})),changes:[]});
 });
 const ranges=result.contextPlan.covered.filter(r=>r.id===x.m.id&&r.field==='content').sort((a,b)=>a.start-b.start);assert.ok(ranges.length>1);let covered=0;for(const r of ranges){assert.ok(r.start<=covered);covered=Math.max(covered,r.end);}assert.equal(covered,text.length);assert.ok(JSON.parse(result.text).findings.length>1);assert.ok(calls.some(c=>c.hierarchyStage==='summary'));assert.ok(!calls.some(c=>c.hierarchyStage==='ground'));assert.ok(calls.filter(c=>c.hierarchyStage==='work').every(c=>c.inventory.some(n=>n.id===x.m.id)));
});
test('model-routed JSON branch applies only with its parents selected; exact text patches preserve neighbours',t=>{
 const x=setup(t),p=makePacket(x.store,x.project.id,{...x.request,operation:'suggest'}),d=data([{key:'chapter-new',parent:x.plan.id,type:'chapter',title:'Продолжение',number:2,reason:'Продолжение сюжета'},{key:'text-new',parent:'chapter-new',type:'manuscript',title:'Рукопись',content:'Новая глава',reason:'Текст новой главы'},{id:x.m.id,reason:'Эмоции',textEdits:[{start:0,end:8,before:'Незнайка',text:'Грустный Незнайка'}]}]);
 validateResult(p.contract,JSON.stringify(d),p);const c=ready(x,p,d);assert.throws(()=>acceptCandidate(x.store,c.id,p.target.rev,[1]),/родительские/);assert.equal(children(x.store,x.plan.id,'chapter').length,1);const added=acceptCandidate(x.store,c.id,p.target.rev,[0,1,2]);assert.equal(added.find(e=>e.type==='manuscript').parent,added.find(e=>e.type==='chapter').id);assert.equal(x.store.get(x.m.id).content,'Грустный Незнайка грустит.');
});
test('unknown context requests, cancellation and unread full replacement fail without writes',async t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'revise'});
 await assert.rejects(runHierarchy(x.connection,p,null,new AbortController().signal,async()=>JSON.stringify({sourceIds:['missing'],inspectTargetIds:[],reason:'Ошибка'})),/неизвестный/);
 const controller=new AbortController();controller.abort();await assert.rejects(runHierarchy(x.connection,p,null,controller.signal,async()=>{throw Error('Must not run');}));
 await assert.rejects(runHierarchy(x.connection,p,null,new AbortController().signal,async(_c,part)=>part.hierarchyStage==='plan'?JSON.stringify({sourceIds:[],inspectTargetIds:[],reason:'Без чтения'}):JSON.stringify(data([{id:x.m.id,content:'Перезапись',reason:'Нельзя'}]))),/непрочитанный|вне текущей/);assert.equal(x.store.get(x.m.id).content,'Незнайка грустит.');
});
test('new scene JSON preserves required structured data and adjacent exact edits compose',t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'suggest'}),group=children(x.store,x.chapter.id,'scenes')[0];
 const d=data([{key:'new-scene',type:'scene',parent:group.id,title:'Сцена 1',reason:'Развернуть события',fields:{номер:1,атмосфера:'Тихо',сюжет:'Ищет друга',персонажи:['Незнайка'],дополнительные_детали:[]}},{id:x.m.id,reason:'Первая правка',textEdits:[{start:0,end:8,before:'Незнайка',text:'Грустный Незнайка'}]},{id:x.m.id,reason:'Вторая правка',textEdits:[{start:8,end:17,before:' грустит.',text:' ищет друга.'}]}]);
 validateResult(p.contract,JSON.stringify(d),p);const c=ready(x,p,d),applied=acceptCandidate(x.store,c.id,p.target.rev,[0,1,2]);assert.equal(applied.find(e=>e.type==='scene').content,'Ищет друга');assert.equal(applied.find(e=>e.type==='scene').number,1);assert.equal(x.store.get(x.m.id).content,'Грустный Незнайка ищет друга.');
});
test('conflicting fields and overlapping text proposals cannot partially apply',t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'suggest'}),c=ready(x,p,data([{id:x.m.id,reason:'Первый вариант',fields:{mood:'грусть'}},{id:x.m.id,reason:'Второй вариант',fields:{mood:'радость'}},{id:x.chapter.id,reason:'План',content:'Изменён'}]));
 assert.throws(()=>acceptCandidate(x.store,c.id,p.target.rev,[0,1,2]),/разные варианты поля/);assert.equal(x.store.get(x.chapter.id).content,'');assert.equal(x.store.get(x.m.id).fields?.mood,undefined);
});
test('chunk progress persists without duplicating whole snapshots into history',t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'check'}),c=x.store.save({type:'candidate',status:'running',packet:p,content:''});
 for(let i=0;i<10;i++)x.store.saveCandidateProgress(c.id,{phase:'work',done:i,total:10},{completedParts:i});
 assert.equal(x.store.get(c.id).progress.done,9);assert.equal(x.store.versions(c.id).length,0);const current=x.store.get(c.id);x.store.save({...current,status:'ready'},current.rev);assert.throws(()=>x.store.saveCandidateProgress(c.id,{},{}),/больше не выполняется/);assert.equal(x.store.get(x.m.id).content,'Незнайка грустит.');
});
test('readonly inventories are complete; grounds are read once and identical calls reuse validated cache',async t=>{
 const x=setup(t),group=children(x.store,x.project.id,'characters')[0];for(let i=0;i<45;i++)x.store.save({type:'character',parent:group.id,title:'Персонаж '+i,content:'PROFILE_'+i});
 const p=makePacket(x.store,group.id,{...x.request,operation:'check'});let count=0;
 const provider=async(_c,part)=>{count++;assert.ok(estimateHierarchyCall(part)<=32768);if(['plan','narrow'].includes(part.hierarchyStage))return JSON.stringify({sourceIds:part.catalog.filter(s=>s.type==='plot').map(s=>s.id),inspectTargetIds:[],reason:'Сверка наличия по сюжетам и полному списку'});assert.equal(part.inventory.filter(s=>s.type==='character').length,45);assert.equal(part.workScope.filter(s=>s.type==='character').length,45);assert.ok(!JSON.stringify(part).includes('PROFILE_'));return JSON.stringify({summary:'Все карточки учитывались',findings:[],changes:[]});};
 const first=await runHierarchy(x.connection,p,null,new AbortController().signal,provider);assert.equal(first.contextPlan.workParts,1);const before=count,second=await runHierarchy(x.connection,p,null,new AbortController().signal,provider);assert.equal(count,before);assert.equal(second.contextPlan.estimatedInputTokens,0);assert.ok(second.contextPlan.calls.every(c=>c.cached));
});
test('short reference IDs and whitespace-only quote differences resolve to original evidence',async t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'search'}),result=await runHierarchy(x.connection,p,null,new AbortController().signal,async(_c,part)=>{
   if(part.hierarchyStage==='plan')return JSON.stringify({sourceIds:[],inspectTargetIds:[],reason:'Все тексты цели'});
   const read=part.reads.find(r=>r.id===x.m.id);return JSON.stringify({summary:'Найдена цитата',findings:read?[{id:part.idRefs[x.m.id],quote:'Незнайка\nгрустит.',message:'Нашёл'}]:[],changes:[]});
 });
 assert.equal(JSON.parse(result.text).findings[0].id,x.m.id);assert.equal(JSON.parse(result.text).findings[0].quote,'Незнайка грустит.');
});
test('one bounded repair preserves verified results; unresolved evidence is displayed separately',async t=>{
 const x=setup(t),p=makePacket(x.store,x.book.id,{...x.request,operation:'check'});let repairs=0;
 const result=await runHierarchy(x.connection,p,null,new AbortController().signal,async(_c,part)=>{
   if(part.hierarchyStage==='plan')return JSON.stringify({sourceIds:part.catalog.filter(s=>s.id===x.m.id).map(s=>s.id),inspectTargetIds:[],reason:'Рукопись'});
   if(part.hierarchyStage==='repair'){repairs++;return JSON.stringify({summary:'Исправить не удалось',findings:[{id:x.m.id,quote:'Несуществующая цитата',message:'Непроверенный вывод'}],changes:[]});}
   return JSON.stringify({summary:'Итог',findings:[{id:x.m.id,quote:'Незнайка грустит.',message:'Подтверждено'},{id:x.m.id,quote:'Несуществующая цитата',message:'Непроверенный вывод'}],changes:[]});
 });
 const data=JSON.parse(result.text);assert.equal(repairs,1);assert.equal(data.findings.length,1);assert.equal(data.findings[0].message,'Подтверждено');assert.equal(data.unverifiedFindings.length,1);assert.match(data.summary,/не подтверждена/);assert.ok(result.contextPlan.lastAttempt.answer);
});
test('writing reuses addressed evidence instead of rereading large grounds for each card group',async t=>{
 const x=setup(t),group=children(x.store,x.project.id,'characters')[0];for(let i=0;i<24;i++)x.store.save({type:'character',parent:group.id,title:'Участник '+i,content:''});const plot=children(x.store,x.book.id,'plot')[0];x.store.save({...plot,content:'Незнайка ищет друга.\n'+('Подробность сюжета.\n'.repeat(400))},plot.rev);const p=makePacket(x.store,group.id,{...x.request,operation:'append'}),calls=[];
 const result=await runHierarchy(x.connection,p,null,new AbortController().signal,async(_c,part)=>{calls.push(part);if(['plan','narrow'].includes(part.hierarchyStage))return JSON.stringify({sourceIds:part.catalog.filter(s=>s.type==='plot').map(s=>s.id),inspectTargetIds:[],reason:'По сюжету'});if(part.hierarchyStage==='ground')return JSON.stringify({summary:'Незнайка ищет друга',evidence:part.reads.filter(r=>r.text.includes('Незнайка ищет друга.')).map(r=>({id:r.id,field:r.field,quote:'Незнайка ищет друга.',fact:'Мотив'}))});if(part.hierarchyStage==='summary')return JSON.stringify({summary:'Общий итог'});assert.ok(!JSON.stringify(part.reads).includes('Подробность сюжета.'));return JSON.stringify({summary:'Прочитаны выбранные выдержки',findings:[],changes:[]});});
 assert.equal(calls.filter(c=>c.hierarchyStage==='ground').length,1);assert.ok(result.contextPlan.workParts>1);assert.ok(result.contextPlan.groundFacts.length);assert.ok(result.contextPlan.calls.every(c=>c.inputTokens<=32768));
});
