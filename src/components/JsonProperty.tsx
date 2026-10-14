import { useEffect, useState } from 'react';
import { draftStorage, type DraftRecord } from '../state/drafts';
import { Dialog } from './Dialog';
export function JsonProperty({owner,name,value,change,invalid,pending}:{owner:string;name:string;value:any;change:(value:any)=>void;invalid:(error:string)=>void;pending:(promise:Promise<void>)=>void}){
 const [text,setText]=useState(JSON.stringify(value,null,2));
 const [recovery,setRecovery]=useState<DraftRecord|null>(null),key=`${owner}:json:${name}`;
 useEffect(()=>{draftStorage('get',key).then(record=>{if(record)setRecovery(record);}).catch(()=>{});},[key]);
 useEffect(()=>{setText(JSON.stringify(value,null,2));},[value]);
 useEffect(()=>()=>invalid(''),[]);
 const apply=(raw:string)=>{setText(raw);try{change(JSON.parse(raw));invalid('');pending(draftStorage('delete',key).then(()=>{}));}catch{invalid(`Свойство «${name}»: исправьте JSON перед сохранением.`);const base={id:key,type:'json-property',rev:0,title:name,content:JSON.stringify(value,null,2)};pending(draftStorage('put',key,{id:key,base,draft:{...base,content:raw},at:new Date().toISOString()}).then(()=>{}));}};
 return <><label className="field"><span>{name}</span><textarea aria-label={name} value={text} onChange={e=>apply(e.target.value)}/></label>{recovery&&<Dialog title="Восстановить правку свойства" close={()=>setRecovery(null)}><p>{name}: сохранён незавершённый ввод JSON.</p><pre>{recovery.draft.content}</pre><button onClick={()=>{apply(recovery.draft.content);setRecovery(null);}}>Восстановить ввод свойства</button><button onClick={()=>{pending(draftStorage('delete',key).then(()=>setRecovery(null)));}}>Удалить ввод свойства</button></Dialog>}</>;
}
