import { useEffect, useRef, useState } from 'react';
import type { Entity } from '../types';
import { clean, differs, draftStorage, deleteDrafts, editable, recoverableDraft, type DraftRecord } from './drafts';
import { Dialog } from '../components/Dialog';
import { DraftPreview } from '../components/DraftPreview';
export function useEditor(node:Entity|undefined,commit:(draft:Entity)=>Promise<Entity>,hotkeys=true,extra:{dirty?:boolean;flush?:()=>Promise<void>;discard?:()=>Promise<void>}={}){
 const [draft,setDraft]=useState<Entity|null>(null),[status,setStatus]=useState('Сохранено'),[error,setError]=useState(''),[recovery,setRecovery]=useState<DraftRecord|null>(null),[transition,setTransition]=useState<(()=>void)|null>(null),[saving,setSaving]=useState(false);
 const [recoveryOpen,setRecoveryOpen]=useState(false);
 const base=useRef<Entity|null>(null),latest=useRef<Entity|null>(null),generation=useRef(0);latest.current=draft;
 const discarding=useRef(false),ownedDrafts=useRef(new Set<string>()),writes=useRef(new Map<string,Promise<any>>());
 const extraRef=useRef(extra);extraRef.current=extra;
 const dirty=differs(draft,base.current)||!!extra.dirty;
 useEffect(()=>{const serial=++generation.current;if(node)ownedDrafts.current.delete(node.id);base.current=node?structuredClone(node):null;setDraft(node?structuredClone(node):null);setRecovery(null);setRecoveryOpen(false);setStatus('Сохранено');setError('');if(node&&!['connection','packet'].includes(node.type))draftStorage('get',node.id).then(r=>{if(serial===generation.current&&r&&recoverableDraft(r,node)){setRecovery(r);}}).catch(()=>setError('Локальное восстановление недоступно. Сохраните материал в приложении.'));},[node?.id]);
 const persist=async()=>{if(discarding.current)return;if(extraRef.current.dirty)await extraRef.current.flush?.();const d=latest.current,b=base.current;if(discarding.current||!d||!b||!differs(d,b)||d.type==='connection')return;try{ownedDrafts.current.add(d.id);const pending=draftStorage('put',d.id,{id:d.id,base:clean(b),draft:clean(d),at:new Date().toISOString()});writes.current.set(d.id,pending);await pending;setStatus('Черновик сохранён локально');}catch{setError('Не удалось сохранить локальный черновик. Сохраните материал в приложении.');throw new Error('Локальное восстановление недоступно');}};
 useEffect(()=>{if(dirty){setStatus('Есть несохранённые изменения');const timer=setTimeout(()=>{void persist().catch(()=>{});},250);return()=>clearTimeout(timer);}else if(draft){setStatus('Сохранено');const id=draft.id;if(id===node?.id&&id===base.current?.id&&ownedDrafts.current.has(id)){void (async()=>{await writes.current.get(id);if(latest.current?.id===id&&!differs(latest.current,base.current)){await draftStorage('delete',id);ownedDrafts.current.delete(id);}})().catch(()=>setError('Не удалось удалить отменённый черновик'));}}},[draft,extra.dirty]);
 useEffect(()=>{const flush=(e:Event)=>{const detail=(e as CustomEvent).detail;if(detail&&Array.isArray(detail.promises))detail.promises.push(persist());};window.addEventListener('writerhelper-desktop-flush',flush);return()=>window.removeEventListener('writerhelper-desktop-flush',flush);},[]);
 const save=async(value:Entity|null=latest.current)=>{
  if(!value)return;setSaving(true);setError('');
  try{
   const saved=await commit(value),current=latest.current;
   if(current?.id===value.id){
    setRecovery(null);setRecoveryOpen(false);
    base.current=structuredClone(saved);
    if(differs(current,value)){
     const newer={...saved,...editable(current)};latest.current=newer;setDraft(newer);setStatus('Есть новые несохранённые изменения');
     await draftStorage('put',saved.id,{id:saved.id,base:clean(saved),draft:clean(newer),at:new Date().toISOString()}).catch(()=>setError('Новые правки не удалось сохранить локально. Сохраните материал ещё раз.'));
    }else{latest.current=saved;setDraft(saved);await draftStorage('delete',saved.id).catch(()=>{});setStatus('Сохранено');}
   }else{
    const stored=await draftStorage('get',saved.id).catch(()=>undefined);
    if(stored&&differs(stored.draft,clean(value)))await draftStorage('put',saved.id,{...stored,base:clean(saved),draft:{...stored.draft,rev:saved.rev}}).catch(()=>{});
    else await draftStorage('delete',saved.id).catch(()=>{});
   }
   return saved;
  }catch(e:any){setError(e.message);setStatus('Не сохранено');throw e;}finally{setSaving(false);}
 };
 const discard=async()=>{
  const b=base.current;if(!b)return;discarding.current=true;setSaving(true);setError('');
  try{await extraRef.current.flush?.();await writes.current.get(b.id);await deleteDrafts(b.id);ownedDrafts.current.delete(b.id);await extraRef.current.discard?.();latest.current=structuredClone(b);setDraft(latest.current);setRecovery(null);setRecoveryOpen(false);setStatus('Сохранено');}
  catch(e:any){setError('Не удалось отменить локальные правки: '+e.message);throw e;}
  finally{discarding.current=false;setSaving(false);}
 };
 const request=(fn:()=>void)=>{if(dirty)setTransition(()=>fn);else fn();};
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(differs(latest.current,base.current)||extraRef.current.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 useEffect(()=>{if(!hotkeys)return;const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save().catch(()=>{});}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[hotkeys,commit]);
 const conflict=!!recovery&&!!node&&recovery.base.rev!==node.rev;
 const dialogs=<>{transition&&<Dialog title="Несохранённые изменения" close={()=>setTransition(null)}><p>Как поступить с правками «{draft?.title}»?</p><div className="toolbar"><button className="primary" disabled={saving} onClick={()=>void save().then(()=>{transition();setTransition(null);}).catch(()=>{})}>Сохранить и перейти</button><button disabled={saving} onClick={()=>void persist().then(()=>{transition();setTransition(null);}).catch(()=>{})}>Оставить черновик</button><button disabled={saving} onClick={()=>void discard().then(()=>{transition();setTransition(null);}).catch(()=>{})}>Не сохранять</button><button disabled={saving} onClick={()=>setTransition(null)}>Остаться</button></div></Dialog>}{recovery&&recoveryOpen&&<Dialog title={conflict?'Конфликт локального черновика':'Восстановить черновик'} close={()=>setRecoveryOpen(false)}><p>В этом браузере автоматически сохранены правки этого материала, которые ещё не сохранены в проекте. Они обнаруживаются при открытии материала — из навигации, поиска или после перезагрузки. Восстановление вернёт их в редактор; запись в проект произойдёт только после «Сохранить».</p><p>«{node?.title}» · исходная версия {recovery.base.rev} · {new Date(recovery.at).toLocaleString('ru')}</p>{conflict&&<><p>Материал обновился. Сравните правки; сохранение старой версии будет заблокировано.</p><div className="comparison"><section><h3>Исходная версия</h3><DraftPreview value={recovery.base}/></section><section><h3>Текущая версия</h3><DraftPreview value={clean(node!)}/></section></div></>}<h3>Локальный черновик</h3><DraftPreview value={recovery.draft}/><div className="toolbar"><button className="primary" onClick={()=>{base.current={...node!,...recovery.base};setDraft({...node!,...recovery.draft});setRecovery(null);}}>Восстановить черновик</button>{conflict&&<button onClick={()=>{base.current=structuredClone(node!);setDraft({...node!,...editableMerge(recovery.draft)});setRecovery(null);setStatus('Правки подготовлены к явному сохранению');}}>Использовать локальные правки после сравнения</button>}<button onClick={()=>setRecoveryOpen(false)}>Открыть сохранённую версию</button><button onClick={()=>void draftStorage('delete',recovery.id).then(()=>setRecovery(null)).catch(()=>setError('Не удалось удалить черновик'))}>Удалить черновик</button></div></Dialog>}</>;
 const reset=(value:Entity|null)=>{base.current=value?structuredClone(value):null;setDraft(value);setStatus('Сохранено');};
 useEffect(()=>{if(node&&base.current?.id===node.id&&base.current.rev!==node.rev&&!differs(latest.current,base.current)&&!recovery)reset(node);},[node?.rev]);
 const recoveryNotice=recovery&&<div className="notice" role="status">Есть локальный черновик «{node?.title}» от {new Date(recovery.at).toLocaleString('ru')}. Он хранится в этом браузере отдельно от сохранённой версии.<button onClick={()=>setRecoveryOpen(true)}>Посмотреть локальный черновик</button></div>;
 return {draft,setDraft,dirty,status,error,save,request,dialogs,recoveryNotice,hasRecovery:!!recovery,persist,saving,reset};
}
function editableMerge(e:Entity){return {title:e.title,content:e.content,fields:e.fields,task:e.task};}
