import { useEffect, useState } from 'react';
export type TextSelection={target?:string;element:HTMLInputElement|HTMLTextAreaElement|null;source:string;start:number;end:number;title:string};
export function useTextSelection(owner:string){
 const [selection,setSelection]=useState<TextSelection|null>(null);
 useEffect(()=>{setSelection(null);},[owner]);
 useEffect(()=>{
  const capture=(event?:Event)=>{
   const active=document.activeElement;
   if(active?.closest('.manuscript-actions')||active?.closest('dialog:not(:has(.context))'))return;
   if(active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement&&['text','search','url','email','tel'].includes(active.type)){
    if(!active.closest('.studio main,.context')||active.disabled)return;
    const start=active.selectionStart,end=active.selectionEnd;if(start===null||end===null)return;
    setSelection({element:active.readOnly?null:active,source:active.value,start,end,title:active.getAttribute('aria-label')||active.closest('label')?.textContent?.trim()||'Текстовое поле'});return;
   }
   const selected=window.getSelection();if(selected&&!selected.isCollapsed&&selected.anchorNode?.parentElement?.closest('.studio main,.context')&&selected.focusNode?.parentElement?.closest('.studio main,.context')){const range=selected.getRangeAt(0),parent=range.commonAncestorContainer.nodeType===Node.ELEMENT_NODE?range.commonAncestorContainer as Element:range.commonAncestorContainer.parentElement;const block=parent?.closest('p,pre,article')||parent;if(!block)return;const before=document.createRange();before.selectNodeContents(block);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length,source=block.textContent||'';setSelection({element:null,source,start,end:start+selected.toString().length,title:'Выделенный текст'});}
  };
  for(const event of ['selectionchange','select','keyup','mouseup','input','focusin'])document.addEventListener(event,capture);
  return()=>{for(const event of ['selectionchange','select','keyup','mouseup','input','focusin'])document.removeEventListener(event,capture);};
 },[]);
 return selection;
}
