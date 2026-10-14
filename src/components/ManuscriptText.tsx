import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { manuscriptBoundaries } from '../state/manuscriptScenes';
export function ManuscriptText({value,change,cursor,select,scroll=0,saveScroll}:{value:string;change:(text:string)=>void;cursor?:[number,number];select:(start:number,end:number)=>void;scroll?:number;saveScroll:(top:number)=>void;}){
 const textarea=useRef<HTMLTextAreaElement>(null),mirror=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const t=textarea.current;if(!t)return;
  if(cursor)t.setSelectionRange(...cursor);
  t.scrollTop=scroll;
 },[]);
 const boundaries=useMemo(()=>manuscriptBoundaries(value),[value]);
 const [lines,setLines]=useState<{top:number;label:string}[]>([]);
 useLayoutEffect(()=>{
  const t=textarea.current,m=mirror.current;if(!t||!m)return;
  const update=()=>{
   const s=getComputedStyle(t);m.style.width=`${t.clientWidth}px`;
   for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','paddingTop','paddingBottom','paddingLeft','paddingRight','wordBreak','overflowWrap','tabSize'] as const)m.style[key]=s[key];
   const rect=m.getBoundingClientRect();setLines([...m.querySelectorAll<HTMLElement>('[data-boundary]')].map((el,i)=>({top:el.getBoundingClientRect().top-rect.top-t.scrollTop,label:boundaries[i].label})));
  };
  update();const observer=new ResizeObserver(update);observer.observe(t);t.addEventListener('scroll',update);
  const styles=new MutationObserver(update),parent=t.closest('.material-editor');if(parent)styles.observe(parent,{attributes:true,attributeFilter:['style']});
  return()=>{observer.disconnect();styles.disconnect();t.removeEventListener('scroll',update);};
 },[value,boundaries]);
 const fragments=[];let from=0;for(const b of boundaries){fragments.push(value.slice(from,b.start),<span data-boundary key={b.start}>{value.slice(b.start,b.end)}</span>);from=b.end;}fragments.push(value.slice(from),'\n');
 return <><p className="muted scene-divider-help">{boundaries.length?`Разделители сцен и интерлюдий: ${boundaries.length}. Границы взяты из текста рукописи.`:'В тексте пока нет разделителей сцен.'} Для новой границы поставьте *** отдельной строкой.</p><div className="manuscript-field manuscript-text"><label><span className="sr-only">Текст главы</span><textarea aria-label="Текст главы" value={value} onChange={e=>change(e.target.value)} onSelect={e=>{if(document.activeElement===e.currentTarget)select(e.currentTarget.selectionStart,e.currentTarget.selectionEnd);}} onBlur={e=>select(e.currentTarget.selectionStart,e.currentTarget.selectionEnd)} onScroll={e=>saveScroll(e.currentTarget.scrollTop)} ref={textarea}/></label><div className="manuscript-mirror" aria-hidden ref={mirror}>{fragments}</div><div className="manuscript-dividers" aria-hidden>{lines.map((line,i)=><div className="manuscript-divider" key={i} style={{top:line.top}}><span>{line.label}</span></div>)}</div></div></>;
}
