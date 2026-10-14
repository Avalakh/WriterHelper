import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Store, createProject, createBook, createChapter, children } from '../server/store.js';
import { makeServer } from '../server/index.js';

fs.mkdirSync("test-data",{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-data/manuscript-position-')),store=new Store(dir);
const project=createProject(store,'Проверка места чтения'),book=createBook(store,project.id,'Книга',1);
const plan=children(store,book.id,'plan')[0];
const manuscripts=[1,2].map(number=>{
 const chapter=createChapter(store,plan.id,number,`Глава ${number}`),m=children(store,chapter.id,'manuscript')[0];
 return store.save({...m,title:`Рукопись ${number}`,content:('Длинный абзац для проверки сохранения места чтения.\n\n').repeat(160)},m.rev);
});
const before=manuscripts.map(m=>store.get(m.id));
const server=makeServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1500,height:950}}),errors=[];
await context.addInitScript(id=>{if(!localStorage.getItem('writer-studio-ui-v1'))localStorage.setItem('writer-studio-ui-v1',JSON.stringify({selected:id}));},manuscripts[0].id);
let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const ready=async(m=manuscripts[0])=>{await expect(page.getByLabel('Текст главы')).toHaveValue(m.content);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
const top=()=>page.locator('.document-scroll').evaluate(el=>el.scrollTop);
const scroll=async(n)=>{await page.locator('.document-scroll').evaluate((el,n)=>el.scrollTop=n,n);await expect.poll(top).toBe(n);await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('writer-studio-ui-v1')).scrolls[id],manuscripts[0].id)).toBe(n);};
const open=async(m)=>{
 await page.getByRole('button',{name:'Поиск',exact:true}).click();await page.getByLabel('Найти в проекте').fill(m.title);
 await page.locator('.search-results button').filter({has:page.getByText(m.title,{exact:true})}).click();await ready(m);
};
try{
 await page.goto(url);await ready();await scroll(1400);
 await page.getByRole('button',{name:'Разделы приложения'}).click();
 await page.getByRole('dialog',{name:'Разделы приложения'}).getByRole('button',{name:'Настройки ИИ',exact:true}).click();
 await page.locator('.document-scroll').evaluate(el=>{el.scrollTop=200;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
 await open(manuscripts[0]);await expect.poll(top).toBe(1400);
 await open(manuscripts[1]);await expect.poll(top).toBe(0);
 await page.locator('.document-scroll').evaluate(el=>el.scrollTop=800);
 await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('writer-studio-ui-v1')).scrolls[id],manuscripts[1].id)).toBe(800);
 await open(manuscripts[0]);await expect.poll(top).toBe(1400);
 await page.route('**/api/state',async route=>{await new Promise(r=>setTimeout(r,250));await route.continue();});
 await page.reload();await ready();await expect.poll(top).toBe(1400);await page.unroute('**/api/state');
 // A constrained textarea also has its own scroll, independent of the page.
 await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
  const style=document.createElement('style');style.textContent='.manuscript-field textarea{field-sizing:fixed!important;height:650px!important;min-height:0!important}';document.head.append(style);
 }));
 await page.reload();await ready();
 const text=page.getByLabel('Текст главы');
 await text.evaluate(t=>{t.focus({preventScroll:true});t.setSelectionRange(710,730);t.blur();t.scrollTop=900;});
 await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem('writer-studio-ui-v1')).textScrolls[id],manuscripts[0].id)).toBe(900);
 await open(manuscripts[1]);await open(manuscripts[0]);
 await expect.poll(()=>text.evaluate(t=>t.scrollTop)).toBe(900);
 assert.deepEqual(await text.evaluate(t=>[t.selectionStart,t.selectionEnd]),[710,730]);
 await page.evaluate(async()=>{const detail={promises:[]};window.dispatchEvent(new CustomEvent('writerhelper-desktop-flush',{detail}));await Promise.all(detail.promises);});
 await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await ready();
 await expect.poll(()=>page.getByLabel('Текст главы').evaluate(t=>t.scrollTop)).toBe(900);
 assert.deepEqual(await page.getByLabel('Текст главы').evaluate(t=>[t.selectionStart,t.selectionEnd]),[710,730]);
 assert.deepEqual(manuscripts.map(m=>store.get(m.id)),before);assert.deepEqual(errors,[]);
 console.log('PASS: per-manuscript page/textarea position and selection, service navigation, delayed reload, desktop flush, close/reopen; text unchanged');
}finally{await browser.close();await new Promise(r=>server.close(r));store.close();}
