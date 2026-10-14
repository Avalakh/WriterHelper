import { makePacket } from './generation.js';
import { buildFragmentContext } from './fragment-context.js';
export function makeTextPacket(store,request,connection){
 const target=request.target?store.get(request.target):null;
 // Reuse the configured source graph and its temporal/POV filters for manuscript actions.
 const base=target?.type==='manuscript'?makePacket(store,target.id,{connection:connection.id,operation:'revise',task:request.task||'Предпросмотр контекста'}):null;
 const context=buildFragmentContext(store,{...request,contextMode:request.contextMode},connection,base?.sources);
 return {target:{id:target?.id,title:target?.title||request.title||'Выделенный текст'},operation:request.mode||'query',fragmentOperation:request.mode||'query',task:request.task?.trim()||'',selection:request.text||'',context,prompts:base?.prompts||[],variables:base?.variables,contract:'text',model:connection.model};
}
