import { useEffect, useState } from 'react';
export type Preferences={theme:string;left:number;right:number;tab:string;book:string;selected:string;opened:Record<string,boolean>;places:Record<string,{id:string;scroll:number}>;scrolls:Record<string,number>;cursors:Record<string,[number,number]>;font:string;size:number;line:number;width:number;manuscriptWide:boolean;previewZooms:Record<string,number>};
const defaults:Preferences={theme:'system',left:240,right:320,tab:'materials',book:'',selected:'',opened:{},places:{},scrolls:{},cursors:{},font:'Georgia',size:18,line:1.7,width:72,manuscriptWide:true,previewZooms:{}};
function legacy(){try{return localStorage.getItem('writer-selected')||'';}catch{return '';}}
export function readPreferences():Preferences {
 try {
  const raw=JSON.parse(localStorage.getItem('writer-studio-ui-v1')||'{}'),x=raw&&typeof raw==='object'?raw:{};
  const clamp=(key:string,fallback:number,min:number,max:number)=>Math.max(min,Math.min(max,Number(x[key])||fallback));
  const object=(key:string)=>x[key]&&typeof x[key]==='object'&&!Array.isArray(x[key])?x[key]:{};
  const cursors=Object.fromEntries(Object.entries(object('cursors')).filter(([,v])=>Array.isArray(v)&&v.length===2&&v.every(n=>Number.isFinite(n)&&n>=0))) as Preferences['cursors'];
  return {...defaults,left:clamp('left',240,180,360),right:clamp('right',320,280,440),size:clamp('size',18,14,28),line:clamp('line',1.7,1.3,2.2),width:clamp('width',72,45,90),manuscriptWide:x.manuscriptWide!==false,previewZooms:Object.fromEntries(Object.entries(object('previewZooms')).filter(([,v])=>typeof v==='number'&&v>=25&&v<=250)) as Record<string,number>,font:['Georgia','Segoe UI'].includes(x.font)?x.font:'Georgia',tab:x.tab==='ai'?'ai':'materials',book:typeof x.book==='string'?x.book:'',opened:object('opened'),places:object('places'),scrolls:object('scrolls'),cursors,selected:typeof x.selected==='string'&&x.selected?x.selected:legacy(),theme:['system','light','dark'].includes(x.theme)?x.theme:'system'};
 }catch{return {...defaults,selected:legacy()};}
}
export function usePreferences(){const [prefs,setPrefs]=useState(readPreferences);useEffect(()=>{try{localStorage.setItem('writer-studio-ui-v1',JSON.stringify(prefs));}catch{}},[prefs]);return [prefs,setPrefs] as const;}
