import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../server/store.js';
import { makeServer } from '../server/index.js';
import { messages } from '../server/provider.js';

test('Text questions use the selected snapshot and never create candidates or edit materials',async t=>{
 const store=new Store(fs.mkdtempSync(path.resolve('test-data/text-query-')));
 const connection=store.save({type:'connection',title:'Тест',kind:'api',model:'mock',context:32000,maxOutput:1000});
 const calls=[];const server=makeServer(store,{mockProvider:async(c,packet)=>{calls.push({c,packet});if(packet.task==='Ошибка')throw Error('ИИ недоступен');return packet.task==='Пустой ответ'?'':'Ответ на вопрос';}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const before=store.all();const send=async body=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/text/query`,{method:'POST',headers:{'Content-Type':'application/json','X-Writer-Client':'1'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 const request={connection:connection.id,text:'Текст\r\nс повтором 🙂',contextMode:'compact',task:' Что это значит? ',title:'Рукопись'};
 const response=await send(request);assert.equal(response.status,200);assert.equal(response.answer,'Ответ на вопрос');assert.equal(response.context.limit,16000);
 assert.equal(calls[0].c.id,connection.id);const packet=calls[0].packet;
 assert.equal(packet.selection,request.text);assert.equal(packet.task,request.task.trim());assert.equal(packet.operation,'query');
 const prompt=messages(packet);const sent=JSON.parse(prompt[1].content);assert.equal(sent.task,'Что это значит?');assert.equal(sent.text,request.text);assert.equal(sent.context.limit,16000);assert.ok(!prompt[0].content.includes('только целевой текст'));
 for(const body of [{...request,text:''},{...request,task:' '},{...request,connection:'missing'},{...request,text:2},{...request,text:'А'.repeat(100000)}])assert.equal((await send(body)).status,400);
 assert.equal(calls.length,1);
 assert.match((await send({...request,task:'Ошибка'})).error,/недоступен/);
 assert.match((await send({...request,task:'Пустой ответ'})).error,/пустой ответ/);
 assert.deepEqual(store.all(),before);
});
