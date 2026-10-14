import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Store,createProject,createBook,createChapter,children } from '../server/store.js';
import { makeServer } from '../server/index.js';
fs.mkdirSync('test-data',{recursive:true});
const store=new Store(fs.mkdtempSync(path.resolve('test-data/preview-dirty-'))),project=createProject(store,'Fixture'),book=createBook(store,project.id,'Book',1),chapter=createChapter(store,children(store,book.id,'plan')[0].id,1,'Chapter');
const text=children(store,chapter.id,'manuscript')[0];store.save({...text,content:'Paragraph.\n\n'.repeat(200)},text.rev);
const preview=children(store,book.id,'preview')[0];store.save({...preview,fields:{...preview.fields,fitWidth:true}},preview.rev);
const initial=store.get(preview.id),world=children(store,book.id,'world')[0];
const server=makeServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1905,height:1020}});
 await page.addInitScript(id=>{if(!localStorage.getItem('writer-studio-ui-v1'))localStorage.setItem('writer-studio-ui-v1',JSON.stringify({selected:id,theme:'dark'}));},preview.id);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.page').first().waitFor();
 const search=async(title)=>{await page.getByRole('button',{name:'Поиск',exact:true}).click();await page.getByLabel('Найти в проекте').fill(title);await page.locator('.search-results button').filter({has:page.getByText(title,{exact:true})}).first().click();};
 const modal=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Несохранённые изменения',exact:true})});
 for(const name of ['Полотно: ширина','Полотно: высота','Шрифт, px','Заголовки, px','Масштаб, %']){await page.getByLabel(name,{exact:true}).focus();await page.getByLabel(name,{exact:true}).press('Tab');}
 await page.setViewportSize({width:1500,height:900});await page.locator('.preview-scroll').hover({position:{x:100,y:150}});await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');await page.mouse.wheel(0,200);
 await search('Описание мира');await expect(modal).toHaveCount(0);await expect(page.locator('.document-header')).toContainText('Описание мира');assert.deepEqual(store.get(preview.id),initial);
 await search('Предпросмотр');await page.getByLabel('Шрифт, px',{exact:true}).fill('23');await search('Описание мира');await expect(modal).toBeVisible();await modal.getByRole('button',{name:'Остаться',exact:true}).click();await expect(page.getByLabel('Шрифт, px',{exact:true})).toHaveValue('23');
 await search('Описание мира');await modal.getByRole('button',{name:'Оставить черновик',exact:true}).click();await search('Предпросмотр');await expect(page.getByRole('button',{name:'Посмотреть локальный черновик',exact:true})).toBeVisible();
 await page.evaluate(async id=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('writer-studio-drafts',1);r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts','readwrite');t.objectStore('drafts').put({id,base:{},draft:{},at:'fixture'});t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};r.onerror=()=>reject(r.error);});},world.id);
 await page.getByLabel('Шрифт, px',{exact:true}).fill('24');await page.waitForTimeout(300);await search('Описание мира');await modal.getByRole('button',{name:'Не сохранять',exact:true}).click();await expect(modal).toHaveCount(0);assert.deepEqual(store.get(preview.id),initial);
 const keys=await page.evaluate(async()=>await new Promise((resolve,reject)=>{const r=indexedDB.open('writer-studio-drafts',1);r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts'),q=t.objectStore('drafts').getAllKeys();t.oncomplete=()=>{db.close();resolve(q.result);};t.onerror=()=>reject(t.error);};r.onerror=()=>reject(r.error);}));assert.ok(!keys.includes(preview.id));assert.ok(keys.includes(world.id),'Other material draft preserved');
 await search('Предпросмотр');await expect(page.getByLabel('Шрифт, px',{exact:true})).toHaveValue('17');await expect(page.getByRole('button',{name:'Посмотреть локальный черновик',exact:true})).toHaveCount(0);
 await page.getByLabel('Шрифт, px',{exact:true}).fill('22');await search('Описание мира');await modal.getByRole('button',{name:'Сохранить и перейти',exact:true}).click();await expect(modal).toHaveCount(0);assert.equal(store.get(preview.id).fields.size,22);assert.equal(store.get(preview.id).fields.height,1123,'Viewport height is not saved as formatting');
 console.log('PASS Unchanged focus, responsive fit, scroll and zoom are clean; real formatting edits guarded; discard current draft only; leave draft and save remain available');
}finally{await browser.close();await new Promise(r=>server.close(r));store.close();}
