import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, createProject, createBook, createChapter, children } from '../server/store.js';
import { makePacket, acceptCandidate } from '../server/generation.js';
import { messages } from '../server/provider.js';
import { sourceOffset } from '../src/state/manuscriptRange.ts';
function setup(t,content='Начало.\r\nПовтор.\r\nМежду.\r\nПовтор.\r\nКонец.🙂'){
 const store=new Store(fs.mkdtempSync(path.resolve('test-data/fragment-')));t.after(()=>store.close());const p=createProject(store,'Тест'),book=createBook(store,p.id,'Книга',1),docs=children(store,book.id),plan=docs.find(x=>x.type==='plan'),chapter=createChapter(store,plan.id,1,'Начало');
 store.save({...chapter,content:'План событий главы.'},chapter.rev);const plot=docs.find(x=>x.type==='plot');store.save({...plot,content:'## Глава 1. Начало\nСобытия главы.'},plot.rev);
 const m=children(store,chapter.id,'manuscript')[0],target=store.save({...m,content},m.rev),connection=store.save({type:'connection',title:'Mock',kind:'api',model:'mock',context:262144,maxOutput:1000});
 const request={connection:connection.id,task:'Подготовь фрагмент',expectedRev:target.rev};const ready=(operation,range,text)=>{const packet=makePacket(store,target.id,{...request,operation,range});return store.save({type:'candidate',title:'Фрагмент',packet,status:'ready',valid:true,content:text});};return {store,target,request,ready};
}
test('Replacement uses exact offsets even for repeated text and preserves everything outside',t=>{
 const {store,target,ready}=setup(t),start=target.content.lastIndexOf('Повтор.'),range={start,end:start+7,text:'Повтор.'};const c=ready('revise',range,'Новая редакция.');assert.equal(store.get(target.id).content,target.content);
 const user=JSON.parse(messages(c.packet)[1].content);assert.deepEqual(user.range,range);assert.ok(user.instructions.includes('только'));
 const saved=acceptCandidate(store,c.id,target.rev);assert.equal(saved.content,target.content.slice(0,start)+'Новая редакция.'+target.content.slice(start+7));assert.ok(saved.content.includes('\r\nПовтор.\r\n'));assert.equal(store.versions(target.id).find(x=>x.rev===target.rev).content,target.content);
});
test('Insertion preserves exact text at beginning, middle and end, including an empty manuscript',t=>{
 for(const content of ['А\r\nБ🙂',''])for(const at of [...new Set([0,Math.floor(content.length/2),content.length])]){const {store,target,ready}=setup(t,content),c=ready('insert',{start:at,end:at,text:''},'Новый');assert.equal(acceptCandidate(store,c.id,target.rev).content,content.slice(0,at)+'Новый'+content.slice(at));}
});
test('Invalid or stale ranges fail before generation and stale candidates never overwrite changes',t=>{
 const {store,target,request,ready}=setup(t);
 for(const range of [{start:-1,end:0,text:''},{start:1.5,end:1.5,text:''},{start:0,end:1000,text:''},{start:0,end:1,text:'Чужой'}])assert.throws(()=>makePacket(store,target.id,{...request,operation:'revise',range}),/границы/);
 assert.throws(()=>makePacket(store,target.id,{...request,operation:'insert'}),/место вставки/);
 assert.throws(()=>makePacket(store,target.id,{...request,operation:'revise',range:{start:0,end:0,text:''}}),/Выделите/);
 assert.throws(()=>makePacket(store,target.id,{...request,expectedRev:999,operation:'insert',range:{start:0,end:0,text:''}}),/изменилась/);
 const c=ready('insert',{start:0,end:0,text:''},'Новый');const edited=store.save({...target,content:'Авторская правка'},target.rev);assert.throws(()=>acceptCandidate(store,c.id,edited.rev),/Исходник изменился/);assert.equal(store.get(target.id).content,'Авторская правка');
});
test('Textarea positions map to CRLF source without shifting Unicode or end positions',()=>{
 const source='А🙂\r\nБ\r\nВ',display=source.replace(/\r\n/g,'\n');for(let i=0;i<=display.length;i++)assert.equal(source.slice(0,sourceOffset(source,i)).replace(/\r\n/g,'\n'),display.slice(0,i));
});
