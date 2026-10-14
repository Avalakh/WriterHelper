import { fail,hash } from './store.js';
import { hierarchyMessages, materialHeader, parseHierarchy } from './hierarchy-task.js';

const json=text=>{try{return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{fail('ИИ вернул некорректный ответ при подготовке контекста');}};
const callCache=new Map();
function decodeWork(answer,actualIds,reads) {
  const data=json(answer);
  for(const f of data.findings||[]) {
    f.id=actualIds[f.id]||f.id;
    if(f.quote&&!reads.some(r=>r.id===f.id&&r.text.includes(f.quote))) {
      const words=f.quote.trim().split(/\s+/).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
      if(words.length>1) {const pattern=new RegExp(words.join('\\s+'),'u');for(const r of reads.filter(r=>r.id===f.id)){const found=r.text.match(pattern);if(found){f.quote=found[0];break;}}}
    }
  }
  for(const c of data.changes||[]) {if(c.id)c.id=actualIds[c.id]||c.id;if(c.parent)c.parent=actualIds[c.parent]||c.parent;}
  return data;
}
export const estimateHierarchyCall=packet=>Math.ceil(Buffer.byteLength(JSON.stringify(hierarchyMessages(packet)),'utf8')/2);
export function hierarchyReadFields(source) {
  const fields=[],seen=new Set();
  const add=(field,text)=>{if(!text||text==='[]'||text==='{}'||seen.has(text))return;seen.add(text);fields.push({field,text});};
  add('content',source.content||'');
  for(const [key,value] of Object.entries(source.fields||{}))if(value!==undefined&&value!==null)add('fields.'+key,typeof value==='string'?value:JSON.stringify(value));
  return fields;
}
function pack(items,make,fits) {
  const batches=[];let current=[];
  for(const item of items) {
    if(!fits(make([...current,item]))) {if(current.length)batches.push(current);current=[];if(!fits(make([item])))fail('Настройки контекста модели не вмещают даже один служебный запрос. Увеличьте контекст или уменьшите лимит ответа.');}
    current.push(item);
  }
  if(current.length)batches.push(current);
  return batches;
}
function splitRead(source,field,text,make,fits) {
  const parts=[];let start=0;
  do {
    const build=end=>({id:source.id,path:source.path,type:source.type,field,start,end,totalLength:text.length,text:text.slice(start,end)});
    let low=start,high=text.length;
    while(low<high) {const middle=Math.ceil((low+high)/2);if(fits(make([build(middle)])))low=middle;else high=middle-1;}
    if(low===start&&start<text.length)fail('Контекст модели не вмещает фрагмент источника. Проверьте лимиты подключения.');
    if(low<text.length&&low>start) {
      // Preserve Unicode and prefer paragraph/line boundaries without dropping a character.
      if(/[\uD800-\uDBFF]/.test(text[low-1]))low--;
      const line=text.lastIndexOf('\n',low-1);if(line>start+(low-start)*0.7)low=line+1;
    }
    if(low===start&&start<text.length)fail('Контекст модели слишком мал для символа источника.');
    parts.push(build(low));start=low;
  }while(start<text.length);
  return parts;
}
function validateWorkChanges(data,packet,scope,reads) {
  const scoped=new Set(scope.map(s=>s.id)),delivered=new Set([...scoped,...reads.map(r=>r.id)]);
  for(const f of data.findings) {
    if(!delivered.has(f.id))fail('Замечание относится к материалу вне текущей части');
    if(f.quote&&!reads.some(r=>r.id===f.id&&r.text.includes(f.quote)))fail('Цитата отсутствует в переданном фрагменте');
  }
  for(const c of data.changes) {
    if(!scoped.has(c.id||c.parent)&&!(!c.id&&data.changes.some(n=>!n.id&&n.key===c.parent)))fail('Правка относится к цели вне текущей части');
    if(!c.id)continue;
    const original=packet.scope.find(s=>s.id===c.id);
    const entire=field=>reads.some(r=>r.id===c.id&&r.field===field&&r.start===0&&r.end===r.totalLength);
    if(c.content!==undefined&&original.content&&!entire('content'))fail('Нельзя заменить непрочитанный текст целиком; используйте дополнение или точную правку');
    for(const key of Object.keys(c.fields||{})) {
      const old=original.fields?.[key];
      if(old!==undefined&&old!==null&&old!==''&&!(Array.isArray(old)&&!old.length)&&!entire('fields.'+key))fail('Для изменения заполненного поля нужно запросить его текущее значение');
    }
    for(const e of c.textEdits||[])if(!reads.some(r=>r.id===c.id&&r.field==='content'&&e.start>=r.start&&e.end<=r.end))fail('Правка выходит за прочитанный фрагмент');
  }
}

// All snapshots remain local. The provider receives only headers or the explicitly selected reads.
export async function runHierarchy(connection,packet,secrets,signal,provider,progress=async()=>{}) {
  const persistProgress=progress;let currentProgress;
  progress=async(state,trace)=>{currentProgress=state;await persistProgress(state,trace);};
  const limit=connection.context||128000,response=connection.maxOutput||8000;
  const fits=p=>estimateHierarchyCall(p)+response<=limit;
  const readOnly=['search','check'].includes(packet.operation),inputLimit=Math.min(32768,limit-response),economical=p=>fits(p)&&estimateHierarchyCall(p)<=inputLimit;
  const all=[...packet.scope,...packet.references],idRefs=Object.fromEntries(all.map((s,i)=>[s.id,`n${i+1}`])),actualIds=Object.fromEntries(Object.entries(idRefs).map(([id,ref])=>[ref,id]));
  const inventory=packet.scope.map(s=>({id:s.id,parent:s.parent,type:s.type,title:s.title,aliases:s.fields?.aliases||[]}));
  const base={contract:'json-hierarchy',task:packet.task,operation:packet.operation,model:packet.model,connection:packet.connection,prompts:readOnly?[]:packet.prompts,idRefs};
  const catalog=[...packet.scope,...packet.references].map(s=>({...materialHeader(s),editable:packet.scope.some(e=>e.id===s.id)}));
  const planning=list=>({...base,hierarchyStage:'plan',target:materialHeader(packet.target),inventory,catalog:list,page:{number:999999,total:999999}});
  const pages=pack(catalog,planning,economical),sourceIds=new Set(),inspectTargetIds=new Set(),reasons=[];
  const trace={sourceIds:[],inspectTargetIds:[],reasons,planningPages:pages.length,workParts:0,completedParts:0,covered:[],results:[],calls:[],estimatedInputTokens:0,estimatedOutputTokens:0,tokenEstimateMethod:'UTF-8/2; оценка, не фактический биллинг',warnings:[]};
  const ask=async(p)=>{
    signal?.throwIfAborted();if(!fits(p))fail('Внутренний запрос превышает контекст модели');
    const inputTokens=estimateHierarchyCall(p),started=Date.now(),call={stage:p.hierarchyStage,inputTokens,outputTokens:0,durationMs:0,status:'running',cached:false};trace.calls.push(call);
    const key=hash(JSON.stringify({connection:connection.id,model:connection.model,messages:hierarchyMessages(p)})),cached=callCache.get(key);
    call.cacheKey=key;
    if(currentProgress)await persistProgress(currentProgress,trace);
    try {
      const answer=cached&&Date.now()-cached.at<15*60000?(call.cached=true,cached.answer):await provider(connection,p,secrets,signal);
      call.outputTokens=Math.ceil(Buffer.byteLength(answer,'utf8')/2);if(!call.cached){trace.estimatedInputTokens+=inputTokens;trace.estimatedOutputTokens+=call.outputTokens;}
      call.status='done';signal?.throwIfAborted();
      if(!call.cached){try{const data=json(answer),valid=['plan','narrow'].includes(p.hierarchyStage)?Array.isArray(data.sourceIds)&&Array.isArray(data.inspectTargetIds)&&typeof data.reason==='string':['work','repair'].includes(p.hierarchyStage)?typeof data.summary==='string'&&Array.isArray(data.findings)&&Array.isArray(data.changes):typeof data.summary==='string'&&data.summary.trim()&&(p.hierarchyStage!=='ground'||Array.isArray(data.evidence));if(valid){callCache.set(key,{answer,at:Date.now()});if(callCache.size>96)callCache.delete(callCache.keys().next().value);}}catch{}}
      return answer;
    }catch(e){call.status='error';throw e;}finally{call.durationMs=Date.now()-started;}
  };
  const applyChoice=(choice,available,replace=false)=>{
    try {
    if(!Array.isArray(choice?.sourceIds)||!Array.isArray(choice.inspectTargetIds)||typeof choice.reason!=='string')fail('План контекста должен содержать sourceIds, inspectTargetIds и reason');
    if(replace){sourceIds.clear();inspectTargetIds.clear();}
    for(const key of ['sourceIds','inspectTargetIds'])for(const ref of choice[key]){
      const selected=actualIds[ref]||ref;
      if(typeof selected!=='string'||!available.has(selected))fail('Модель запросила неизвестный материал контекста');
      if(key==='inspectTargetIds'&&!packet.scope.some(s=>s.id===selected))fail('Запрошена карточка вне области редактирования');
      (key==='sourceIds'?sourceIds:inspectTargetIds).add(selected);
    }reasons.push(choice.reason);
    }catch(error){callCache.delete(trace.calls.at(-1)?.cacheKey);throw error;}
  };
  for(let i=0;i<pages.length;i++) {
    await progress({phase:'plan',done:i,total:pages.length},trace);
    const choice=json(await ask({...planning(pages[i]),page:{number:i+1,total:pages.length}}));
    const available=new Set(pages[i].map(s=>s.id));
    applyChoice(choice,available);
  }
  if(packet.operation!=='search'&&(pages.length>1||sourceIds.size+inspectTargetIds.size>12)) {
    const chosen=catalog.filter(s=>sourceIds.has(s.id)||inspectTargetIds.has(s.id)),narrow={...planning(chosen),hierarchyStage:'narrow'};
    if(economical(narrow)){await progress({phase:'plan',done:pages.length,total:pages.length},trace);applyChoice(json(await ask(narrow)),new Set(chosen.map(s=>s.id)),true);}
  }
  // Search promises every occurrence in the subtree; selection of additional grounds remains model-owned.
  if(packet.operation==='search')for(const s of packet.scope)if(s.content||Object.keys(s.fields||{}).length)sourceIds.add(s.id);
  trace.sourceIds=[...sourceIds];trace.inspectTargetIds=[...inspectTargetIds];
  const selected=[...new Set([...sourceIds,...inspectTargetIds])].map(id=>[...packet.scope,...packet.references].find(s=>s.id===id));
  let contextSummary='';
  let groundFacts=null;
  const working=(scope,reads)=>({...base,hierarchyStage:'work',scope:[],references:[],inventory,workScope:scope,reads,contextSummary,part:{number:999999,total:999999}});
  if(!readOnly&&selected.length&&(packet.scope.length>Math.max(8,Math.floor(response/400))||selected.reduce((n,s)=>n+Buffer.byteLength(JSON.stringify({content:s.content,fields:s.fields}),'utf8')/2,0)>inputLimit/2)) {
    // Shared overview connects long grounds across passes; the full raw sources still pass below.
    const grounding=reads=>({...base,prompts:[],hierarchyStage:'ground',reads}),units=[];
    for(const s of selected) {
      if(inspectTargetIds.has(s.id)&&!sourceIds.has(s.id))continue;
      for(const {field,text} of hierarchyReadFields(s))units.push(...splitRead(s,field,text,grounding,economical));
    }
    const groundParts=pack(units,grounding,economical);trace.groundSummaries=[];groundFacts=[];
    for(let i=0;i<groundParts.length;i++) {
      await progress({phase:'ground',done:i,total:groundParts.length},trace);
      const result=json(await ask(grounding(groundParts[i])));if(typeof result?.summary!=='string'||!result.summary.trim())fail('Не получена выжимка оснований');trace.groundSummaries.push(result.summary);
      if(!Array.isArray(result.evidence)){groundFacts=null;trace.warnings.push('Модель не предоставила адресованные выдержки; используются исходные основания');continue;}
      if(groundFacts)for(const item of result.evidence){const sourceId=actualIds[item.id]||item.id,read=groundParts[i].find(r=>r.id===sourceId&&r.field===item.field&&typeof item.quote==='string'&&item.quote&&r.text.includes(item.quote));if(!read){groundFacts=null;trace.warnings.push('Некорректная выдержка основания; исходный текст сохранён');break;}const start=read.start+read.text.indexOf(item.quote);groundFacts.push({...read,start,end:start+item.quote.length,text:item.quote,fact:item.fact});}
    }
    let summaries=trace.groundSummaries;
    const reducing=list=>({...base,prompts:[],hierarchyStage:'summary',task:'Подготовь общую выжимку оснований для следующей работы: '+packet.task,summaries:list});
    while(summaries.length>1) {
      const groups=pack(summaries,reducing,economical),next=[];
      for(const group of groups){const result=json(await ask(reducing(group)));if(typeof result?.summary!=='string'||!result.summary.trim())fail('Не получена общая выжимка оснований');next.push(result.summary);}
      if(next.length>=summaries.length&&next.some((s,i)=>s.length>=summaries[i].length))fail('Модель не сократила выжимки оснований для объединения');
      summaries=next;
    }
    contextSummary=summaries[0]||'';trace.overview=contextSummary;
    trace.groundFacts=groundFacts;
  }
  // Headers, not card bodies, form the list of things to fill/check.
  const withParents=scope=>{const result=[...scope];for(const entry of scope){let current=packet.scope.find(s=>s.id===entry.parent);while(current){if(!result.some(e=>e.id===current.id))result.push(materialHeader(current));current=packet.scope.find(s=>s.id===current.parent);}}return result;};
  const targetBatches=pack(packet.scope.map(materialHeader),scope=>working(withParents(scope),[]),p=>(readOnly||p.workScope.length<=Math.max(8,Math.floor(response/400)))&&economical(p)&&estimateHierarchyCall(p)+response+Math.min(2048,Math.floor(limit/4))<=limit).map(withParents);
  const jobs=[];
  for(const scope of targetBatches) {
    const units=[];
    for(const s of selected) {
      // Requested target inspections stay with the batch owning that target.
      if(inspectTargetIds.has(s.id)&&!sourceIds.has(s.id)&&!scope.some(t=>t.id===s.id))continue;
      if(groundFacts!==null&&sourceIds.has(s.id)&&!inspectTargetIds.has(s.id)) {units.push(...groundFacts.filter(r=>r.id===s.id));continue;}
      for(const {field,text} of hierarchyReadFields(s))units.push(...splitRead(s,field,text,reads=>working(scope,reads),economical));
    }
    const groups=units.length?pack(units,reads=>working(scope,reads),economical):[[]];
    for(const reads of groups)jobs.push({scope,reads});
  }
  trace.workParts=jobs.length;
  const summaries=[],findings=[],changes=[],seenFindings=new Set(),seenChanges=new Set(),createdByValue=new Map();
  for(let i=0;i<jobs.length;i++) {
    await progress({phase:'work',done:i,total:jobs.length},trace);
    const {scope,reads}=jobs[i],workPacket={...working(scope,reads),part:{number:i+1,total:jobs.length}};
    let raw=await ask(workPacket),result;
    const validate=answer=>{const data=decodeWork(answer,actualIds,reads);parseHierarchy(JSON.stringify(data),packet);validateWorkChanges(data,packet,scope,reads);return data;};
    try{result=validate(raw);}catch(error) {
      callCache.delete(trace.calls.at(-1)?.cacheKey);
      const originalAnswer=raw;
      trace.lastAttempt={part:i+1,error:error.message,answer:raw};await progress({phase:'repair',done:i,total:jobs.length},trace);
      const parsed=(()=>{try{return json(raw);}catch{return null;}})(),quoted=(parsed?.findings||[]).filter(f=>f.quote);
      const repairReads=reads.map(r=>{const f=quoted.find(f=>(actualIds[f.id]||f.id)===r.id),anchor=f?.quote?.trim().split(/\s+/).slice(0,3).join(' '),at=anchor?r.text.indexOf(anchor):-1,start=Math.max(0,at-200);return {...r,start:r.start+start,end:r.start+Math.min(r.text.length,start+2000),text:r.text.slice(start,start+2000)};});
      const repair={...workPacket,hierarchyStage:'repair',answer:raw,validationError:error.message,reads:repairReads};
      try{if(!economical(repair))throw error;raw=await ask(repair);result=validate(raw);trace.warnings.push(`Часть ${i+1}: JSON или цитаты исправлены без повторного чтения оснований`);delete trace.lastAttempt;}catch(repairError) {
        callCache.delete(trace.calls.at(-1)?.cacheKey);
        if(!readOnly)throw repairError;
        const drafts=[originalAnswer,raw].map(answer=>{try{return decodeWork(answer,actualIds,reads);}catch{return {summary:'Ответ части не удалось разобрать',findings:[],changes:[]};}}),draft=drafts[0],verified=[],examined=new Set();
        trace.unverifiedFindings=trace.unverifiedFindings||[];
        for(const f of drafts.flatMap(d=>d.findings||[])){const key=JSON.stringify(f);if(examined.has(key))continue;examined.add(key);try{validate(JSON.stringify({summary:'Проверка ссылки',findings:[f],changes:[]}));verified.push(f);}catch(e){trace.unverifiedFindings.push({part:i+1,finding:f,error:e.message});}}
        trace.incompleteParts=trace.incompleteParts||[];trace.incompleteParts.push({part:i+1,error:repairError.message});
        trace.warnings.push(`Часть ${i+1}: некоторые выводы не подтверждены; они сохранены отдельно для проверки`);
        result={summary:draft.summary||'Часть обработана с замечаниями к ответу',findings:verified,changes:[]};
      }
    }
    const keyMap=new Map(result.changes.filter(c=>!c.id&&c.key).map(c=>[c.key,`part-${i+1}:${c.key}`]));
    for(const c of result.changes){if(c.key)c.key=keyMap.get(c.key)||c.key;if(keyMap.has(c.parent))c.parent=keyMap.get(c.parent);}
    const localCreates=new Map(result.changes.filter(c=>!c.id&&c.key).map(c=>[c.key,c])),canonical=new Map();
    const normalize=c=>{
      const localKey=c.key;if(canonical.has(localKey))return canonical.get(localKey);
      if(localCreates.has(c.parent))c.parent=normalize(localCreates.get(c.parent));
      const {reason,key,...value}=c,signature=JSON.stringify(value),existing=createdByValue.get(signature);
      if(existing)c.key=existing;else createdByValue.set(signature,c.key);
      canonical.set(localKey,c.key);return c.key;
    };
    for(const c of localCreates.values())normalize(c);
    for(const c of result.changes)if(canonical.has(c.parent))c.parent=canonical.get(c.parent);
    summaries.push(result.summary);
    for(const f of result.findings) {const key=JSON.stringify(f);if(!seenFindings.has(key)){seenFindings.add(key);findings.push(f);}}
    for(const c of result.changes) {const {reason,...value}=c,key=JSON.stringify(value);if(!seenChanges.has(key)){seenChanges.add(key);changes.push(c);}}
    trace.completedParts=i+1;
    trace.results.push(result);
    trace.covered.push(...reads.map(({id,field,start,end,totalLength})=>({id,field,start,end,totalLength})));
    await progress({phase:'work',done:i+1,total:jobs.length},trace);
  }
  // Tree-reduce only the prose summary. Every finding and proposed change is retained locally.
  const summarizing=list=>({...base,prompts:[],hierarchyStage:'summary',summaries:list});
  let level=summaries;
  if(level.some(s=>!economical(summarizing([s])))) {
    const next=[];
    for(const summary of level) {
      const pieces=splitRead({id:'summary',path:'Итог части'},'summary',summary,reads=>summarizing(reads.map(r=>r.text)),economical);
      for(const piece of pieces) {const reduced=json(await ask(summarizing([piece.text])));if(typeof reduced?.summary!=='string')fail('Не получен итог части');next.push(reduced.summary);}
    }
    level=next;
  }
  while(level.length>1) {
    const groups=pack(level,summarizing,economical),next=[];
    await progress({phase:'summary',done:0,total:groups.length},trace);
    for(let i=0;i<groups.length;i++) {
      const result=json(await ask(summarizing(groups[i])));if(typeof result?.summary!=='string'||!result.summary.trim())fail('Не получен общий итог частей');next.push(result.summary);
      await progress({phase:'summary',done:i+1,total:groups.length},trace);
    }
    if(next.length>=level.length) {
      if(next.some((s,i)=>s.length>=level[i].length))fail('Модель не сократила промежуточные итоги для объединения. Все результаты частей сохранены в ходе задачи; повторите запрос.');
      level=next;
    }else level=next;
  }
  const result={summary:level[0]||'Задача обработана.',findings,changes,warnings:trace.warnings,unverifiedFindings:trace.unverifiedFindings||[],complete:!trace.incompleteParts?.length};
  if(!result.complete)result.summary+='\nПолнота проверки не подтверждена: есть непроверенные выводы или ответы отдельных частей, приведённые отдельно.';
  parseHierarchy(JSON.stringify(result),packet);
  await progress({phase:'done',done:jobs.length,total:jobs.length},trace);
  return {text:JSON.stringify(result),contextPlan:trace};
}
