import { useEffect } from 'react';

// Click the same control as a mouse save, including its guards and error handling.
export function useSaveShortcut(){
 useEffect(()=>{
  const handler=(e:KeyboardEvent)=>{
   if(!(e.ctrlKey||e.metaKey)||e.altKey||!(e.code==='KeyS'||['s','ы'].includes(e.key.toLowerCase())))return;
   e.preventDefault();e.stopPropagation();if(e.repeat)return;
   const buttons=(scope:ParentNode)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].filter(b=>/^Сохранить(?:\s|$)/u.test(b.textContent?.trim()||'')&&b.textContent?.trim()!=='Сохранить и перейти'&&b.getClientRects().length>0);
   const dialogs=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
   let scope:ParentNode=dialogs.at(-1)||document;
   if(!dialogs.length){
    let parent=document.activeElement?.parentElement;
    while(parent){if(buttons(parent).length){scope=parent;break;}parent=parent.parentElement;}
   }
   const button=buttons(scope)[0];if(button&&!button.disabled)button.click();
  };
  window.addEventListener('keydown',handler,true);return()=>window.removeEventListener('keydown',handler,true);
 },[]);
}
