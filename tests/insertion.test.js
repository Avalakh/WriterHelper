import test from 'node:test';
import assert from 'node:assert/strict';
import { generateInsertion } from '../server/insertion.js';
import { messages } from '../server/provider.js';
const packet=mode=>({operation:'insert',fragmentOperation:'insert',context:{mode,sources:[{role:'local-before',text:'— Сейчас помогу.'},{role:'local-after',text:'Перехватываю крышку свободной рукой и закрепляю её.'}]},task:'Добавь подготовку.',prompts:[{stage:'generation',text:'Напиши главу со всеми сценами.'}],range:{start:17,end:17,text:''}});
const bad='Перехватываю крышку свободной рукой.';
const finding={candidate:bad,boundary:'after',evidence:'Перехватываю крышку свободной рукой',reason:'Повторено действие следующего предложения.'};
test('Both context modes check semantic repetition and repair once, without changing neighbours',async()=>{
 for(const mode of ['full','compact']){const calls=[];const provider=async(c,p,secrets,signal,review)=>{calls.push({p,review});if(p.operation==='insert-check')return JSON.stringify(p.candidate===bad?{verdict:'REVISE',findings:[finding]}:{verdict:'PASS',findings:[]});return p.insertionFeedback?'Подбираюсь ближе по поручню.':bad;};const p=packet(mode),before=structuredClone(p);const result=await generateInsertion({model:'mock'},p,null,null,provider);assert.equal(result.text,'Подбираюсь ближе по поручню.');assert.equal(calls.length,4);assert.equal(result.checks[0].verdict,'REVISE');assert.equal(result.checks[1].verdict,'PASS');assert.equal(calls[1].review,true);assert.deepEqual(p,before);assert.ok(JSON.parse(messages(calls[2].p)[1].content).correction.findings[0].reason.includes('Повтор'));assert.ok(!messages(calls[0].p)[0].content.includes('Напиши главу'));}
});
test('Persistent repeats and ungrounded checks are never returned as successful insertion',async()=>{
 let calls=0;await assert.rejects(generateInsertion({},packet('compact'),null,null,async(c,p)=>{calls++;return p.operation==='insert-check'?JSON.stringify({verdict:'REVISE',findings:[finding]}):bad;}),/после исправления/);assert.equal(calls,4);
 for(const check of ['not JSON',JSON.stringify({verdict:'PASS',findings:[finding]}),JSON.stringify({verdict:'REVISE',findings:[{...finding,evidence:'不存在'}]})])await assert.rejects(generateInsertion({},packet('full'),null,null,async(c,p)=>p.operation==='insert-check'?check:bad),/Проверка вставки не завершена/);
});
