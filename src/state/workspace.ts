import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
export type Preferences={theme:string;left:number;right:number;tab:string;book:string;selected:string;opened:Record<string,boolean>;places:Record<string,{id:string;scroll:number}>;scrolls:Record<string,number>;textScrolls:Record<string,number>;cursors:Record<string,[number,number]>;font:string;size:number;line:number;width:number;manuscriptWide:boolean;previewZooms:Record<string,number>};
const defaults:Preferences={theme:'system',left:240,right:320,tab:'materials',book:'',selected:'',opened:{},places:{},scrolls:{},textScrolls:{},cursors:{},font:'Georgia',size:18,line:1.7,width:72,manuscriptWide:true,previewZooms:{}};
function legacy(){try{return localStorage.getItem('writer-selected')||'';}catch{return '';}}
export function readPreferences():Preferences {
 try {
  const raw=JSON.parse(localStorage.getItem('writer-studio-ui-v1')||'{}'),x=raw&&typeof raw==='object'?raw:{};
  const clamp=(key:string,fallback:number,min:number,max:number)=>Math.max(min,Math.min(max,Number(x[key])||fallback));
  const object=(key:string)=>x[key]&&typeof x[key]==='object'&&!Array.isArray(x[key])?x[key]:{};
  const cursors=Object.fromEntries(Object.entries(object('cursors')).filter(([,v])=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&n>=0))) as Preferences['cursors'];
  return {...defaults,left:clamp('left',240,180,360),right:clamp('right',320,280,440),size:clamp('size',18,14,28),line:clamp('line',1.7,1.3,2.2),width:clamp('width',72,45,90),manuscriptWide:x.manuscriptWide!==false,previewZooms:Object.fromEntries(Object.entries(object('previewZooms')).filter(([,v])=>typeof v==='number'&&v>=25&&v<=250)) as Record<string,number>,font:['Georgia','Segoe UI'].includes(x.font)?x.font:'Georgia',tab:x.tab==='ai'?'ai':'materials',book:typeof x.book==='string'?x.book:'',opened:object('opened'),places:object('places'),scrolls:object('scrolls'),textScrolls:Object.fromEntries(Object.entries(object('textScrolls')).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)&&v>=0)) as Record<string,number>,cursors,selected:typeof x.selected==='string'&&x.selected?x.selected:legacy(),theme:['system','light','dark'].includes(x.theme)?x.theme:'system'};
 }catch{return {...defaults,selected:legacy()};}
}
export function usePreferences(){
 const [prefs,setState]=useState(readPreferences),latest=useRef(prefs);
 const persist=()=>{try{localStorage.setItem('writer-studio-ui-v1',JSON.stringify(latest.current));}catch{}};
 const setPrefs:Dispatch<SetStateAction<Preferences>>=next=>{
  const value=typeof next==='function'?next(latest.current):next;
  latest.current=value;persist();setState(value);
 };
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')persist();};
  window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',persist);
  window.addEventListener('writerhelper-desktop-flush',persist);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',persist);window.removeEventListener('writerhelper-desktop-flush',persist);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 return [prefs,setPrefs] as const;
}
