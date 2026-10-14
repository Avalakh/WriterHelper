import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, createProject, createBook, createChapter, children } from '../server/store.js';
import { makePacket } from '../server/generation.js';
import { makeTextPacket } from '../server/text-packet.js';
import { fragmentMessages } from '../server/fragment-context.js';

test('All three manuscript actions share context, retain source settings and expose bounded compact snapshots',t=>{
 const store=new Store(fs.mkdtempSync(path.resolve('test-data/shared-fragment-')));t.after(()=>store.close());
 const project=createProject(store,'Тест'),book=createBook(store,project.id,'Книга',1),docs=children(store,book.id),plan=docs.find(e=>e.type==='plan'),chapter=createChapter(store,plan.id,1,'Ремонт');
 store.save({...chapter,content:'Ремонтируем силовую сеть в невесомости.'},chapter.rev);const plot=docs.find(e=>e.type==='plot');store.save({...plot,content:'## Глава 1. Ремонт\nРемонтируем силовую сеть.'},plot.rev);
 const group=children(store,chapter.id,'scenes')[0];store.save({type:'scene',parent:group.id,title:'Ремонт',number:1,fields:{номер:1,атмосфера:'Невесомость.',сюжет:'Ремонтируем силовую сеть. Меняем перемычку.',персонажи:['Перун','Незнайка'],дополнительные_детали:[]}});store.save({type:'scene',parent:group.id,title:'Отлёт',number:2,fields:{номер:2,атмосфера:'Корабль перед вылетом.',сюжет:'Команда корабля готовится к отлёту.',персонажи:['Перун','Незнайка'],дополнительные_детали:[]}});
 const empty=children(store,chapter.id,'manuscript')[0],target=store.save({...empty,content:'Меняем силовую перемычку.\n— Линия отключена.\nЧиним сеть.\n'+'Поздний эпизод. '.repeat(2000)},empty.rev),connection=store.save({type:'connection',title:'Mock',kind:'api',model:'mock',context:262144,maxOutput:1000});
 const start=target.content.indexOf('— Линия'),end=target.content.indexOf('\nЧиним'),range={start,end,text:target.content.slice(start,end)},task='Уточни смысл.';
 for(const mode of ['compact','full']){
  const request={connection:connection.id,operation:'revise',range,task,contextMode:mode};const packet=makePacket(store,target.id,request);
  const query=makeTextPacket(store,{target:target.id,field:'Текст главы',text:range.text,before:target.content.slice(0,start),after:target.content.slice(end),task,contextMode:mode},connection);
  assert.deepEqual(query.context,packet.context);assert.equal(packet.context.field,'Текст главы');
  if(mode==='compact'){assert.ok(packet.context.characters<=16000);assert.equal(packet.context.sources.find(s=>s.role==='current-scene').title,'Ремонт');assert.ok(!packet.context.sources.some(s=>s.role==='editing'));}
  else assert.ok(packet.context.sources.some(s=>s.role==='editing'&&s.text===target.content));
  for(const action of ['query','revise','insert']){const message=JSON.parse(fragmentMessages({...packet,operation:action,fragmentOperation:action})[1].content);assert.deepEqual(message.context,packet.context);assert.equal(message.operation,action);assert.equal(message.text,range.text);}
  const insertion=fragmentMessages({...packet,operation:'insert',fragmentOperation:'insert'}),payload=JSON.parse(insertion[1].content);
  assert.equal(payload.insertion.before,target.content.slice(0,start));assert.equal(payload.insertion.after,target.content.slice(end,end+1600));
  assert.ok(payload.insertion.contract.includes('сохраняются дословно'));assert.ok(payload.insertion.instructions.includes('даже синонимами'));assert.ok(payload.insertion.instructions.includes('before + результат + after'));assert.ok(!insertion[0].content.includes('Напиши главу'));
  assert.ok(payload.insertion.timeBoundary.includes('зарезервированное продолжение'));assert.ok(payload.insertion.timeBoundary.includes('ни его результат'));assert.ok(payload.insertion.timeBoundary.includes('в руках другого участника'));
 }
 const unsaved=makeTextPacket(store,{target:target.id,field:'Текст главы',text:range.text,before:'Новая несохранённая правка. ',after:' Новый конец.',task,contextMode:'full'},connection);
 const editing=unsaved.context.sources.find(s=>s.role==='editing');assert.equal(editing.text,'Новая несохранённая правка. '+range.text+' Новый конец.');assert.equal(editing.localDraft,true);assert.equal(store.get(target.id).content,target.content);
});
