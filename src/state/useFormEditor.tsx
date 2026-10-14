import { useEffect, useMemo, useRef } from 'react';
import { useEditor } from './useEditor';
import type { Entity } from '../types';

export function useFormEditor(value:any,id:string,title:string,commit:(value:any)=>Promise<any>,guard:(request:((fn:()=>void)=>void)|null)=>void){
 const node=useMemo(()=>value?({id,type:'service-form',title,rev:value.rev||0,content:'',fields:{value}} as Entity):undefined,[value,id,title]);
 const editing=useEditor(node,async draft=>({...draft,fields:{value:await commit(draft.fields!.value)}}));
 const current=editing.draft?.id===id?editing.draft.fields?.value:value;
 const latest=useRef(current);latest.current=current;
 const set=(next:any)=>{const v=typeof next==='function'?next(latest.current):next;latest.current=v;if(node)editing.setDraft({...editing.draft||node,id,fields:{value:v}});};
 const reset=(v:any)=>{latest.current=v;if(node)editing.reset({...node,fields:{value:v}});};
 useEffect(()=>{guard(editing.request);return()=>guard(null);},[editing.dirty,id]);
 return {...editing,dialogs:<>{editing.error&&<p role="alert">{editing.error}</p>}{editing.dialogs}</>,value:current,set,reset};
}
