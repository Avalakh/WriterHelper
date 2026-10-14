import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { api } from '../api';
import { hasDrafts } from '../state/drafts';
import type { Entity } from '../types';

export function BookExport({book, entities, dirty, close}:{book:Entity; entities:Entity[]; dirty:boolean; close:()=>void}) {
  const [format,setFormat]=useState('epub'),[author,setAuthor]=useState(book.fields?.author || ''),[language,setLanguage]=useState('ru');
  const [summary,setSummary]=useState<{title:string;chapters:number;skipped:string[];fingerprint:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[drafts,setDrafts]=useState(dirty);
  useEffect(()=>{let active=true;api('book/export/summary?book='+encodeURIComponent(book.id)).then(s=>{if(active)setSummary(s);}).catch(e=>{if(active)setError(e.message);});
    const belongs=(e:Entity):boolean=>e.id===book.id||!!e.parent&&!!entities.find(p=>p.id===e.parent)&&belongs(entities.find(p=>p.id===e.parent)!);
    Promise.all(entities.filter(e=>e.type==='manuscript'&&belongs(e)).map(e=>hasDrafts(e.id))).then(values=>{if(active)setDrafts(dirty||values.some(Boolean));}).catch(()=>{if(active)setDrafts(true);});
    return()=>{active=false;};
  },[book.id]);
  const download=async()=>{
    setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/book/export',{method:'POST',headers:{'Content-Type':'application/json','X-Writer-Client':'1'},body:JSON.stringify({book:book.id,format,author,language,fingerprint:summary?.fingerprint})});
      if(!response.ok)throw new Error((await response.json()).error || 'Не удалось выгрузить книгу');
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
      const filename=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      link.href=url;link.download=filename?decodeURIComponent(filename):`Книга.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      setMessage('Файл подготовлен и передан для сохранения.');
    } catch(e:any){setError(e.message);} finally{setBusy(false);}
  };
  return <Dialog title="Выгрузить книгу" close={()=>{if(!busy)close();}}><p><strong>{book.title}</strong></p><p>В файл войдут сохранённые рукописи в порядке глав. Лор, планы, кандидаты и история чата не включаются.</p>
    {drafts&&<p className="notice">Есть несохранённые правки или локальные черновики. Чтобы включить их в файл, закройте это окно и сохраните материалы. Сейчас будет выгружена сохранённая версия.</p>}
    {summary&&<><p>Глав с текстом: {summary.chapters}. Пропущено пустых глав: {summary.skipped.length}.</p>{summary.skipped.length>0&&<details><summary>Пропущенные главы</summary><ul>{summary.skipped.map((title,i)=><li key={i}>{title}</li>)}</ul></details>}</>}
    <label className="field">Формат<select aria-label="Формат выгрузки" value={format} disabled={busy} onChange={e=>setFormat(e.target.value)}>{[['txt','TXT'],['fb2','FB2'],['epub','EPUB'],['md','Markdown (.md)'],['html','HTML'],['docx','DOCX'],['pdf','PDF']].map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label>
    <label className="field">Автор (необязательно)<input value={author} disabled={busy} maxLength={300} onChange={e=>setAuthor(e.target.value)}/></label>
    <label className="field">Язык книги<select aria-label="Язык книги" value={language} disabled={busy} onChange={e=>setLanguage(e.target.value)}><option value="ru">Русский</option><option value="en">Английский</option></select></label>
    <p className="muted">PDF и DOCX используют собственное книжное оформление. Настройки предпросмотра не меняются. Внешние изображения не загружаются; в текст входит их подпись.</p>
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
    <button disabled={busy||!summary?.chapters} onClick={()=>void download()}>{busy?'Подготовка файла…':'Скачать файл'}</button>
  </Dialog>;
}
