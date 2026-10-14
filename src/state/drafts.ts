import type { Entity } from '../types';
export type DraftRecord={id:string;base:Entity;draft:Entity;at:string};
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('writer-studio-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=undefined;reject(request.error);};});}
export async function draftStorage(action:'get'|'put'|'delete',id:string,value?:DraftRecord):Promise<DraftRecord|undefined>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts',action==='get'?'readonly':'readwrite'),s=t.objectStore('drafts');const r=action==='get'?s.get(id):action==='put'?s.put(value):s.delete(id);t.oncomplete=()=>resolve(action==='get'?r.result:undefined);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Хранилище недоступно'));});}
export async function hasDrafts(id:string):Promise<boolean>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts'),r=t.objectStore('drafts').getAllKeys();t.oncomplete=()=>resolve(r.result.some(key=>key===id||String(key).startsWith(`${id}:json:`)));t.onerror=()=>reject(t.error);});}
export const editable=(e:Entity)=>({title:e.title,content:e.content,fields:e.fields||{},task:e.task||''});
function comparable(value:any):any{
 if(typeof value==='string')return value.replace(/\r\n?/g,'\n');
 if(Array.isArray(value))return value.map(comparable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,comparable(value[key])]));
 return value;
}
export const differs=(a:Entity|null,b:Entity|null)=>!!a&&!!b&&JSON.stringify(comparable(editable(a)))!==JSON.stringify(comparable(editable(b)));
export const recoverableDraft=(record:DraftRecord,node:Entity)=>differs(record.draft,record.base)&&differs(record.draft,node);
export const clean=(e:Entity):Entity=>({id:e.id,type:e.type,rev:e.rev,...editable(e)});
