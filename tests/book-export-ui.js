import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { Store,createProject,createBook,createChapter,children } from '../server/store.js';
import { makeServer } from '../server/index.js';

const dir=fs.mkdtempSync(path.resolve('test-data/export-ui-')),store=new Store(dir);
const project=createProject(store,'Экспорт — проверка'),book=createBook(store,project.id,'Книга проверки',1),plan=children(store,book.id,'plan')[0];
const chapter=createChapter(store,plan.id,1,'Начало'),empty=createChapter(store,plan.id,2,'Ещё не написана'),m=children(store,chapter.id,'manuscript')[0];
store.save({...m,content:'# Глава 1. Начало\n\nСохранённая рукопись.\n\n***\n\nКонец.'},m.rev);
const server=makeServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1500,height:950},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button').filter({has:page.getByText(project.title,{exact:true})}).click();
  await page.getByLabel('Активная книга').selectOption(book.id);
  await page.getByRole('button',{name:'Выгрузить книгу',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Выгрузить книгу',exact:true});
  await dialog.getByText('Глав с текстом: 1. Пропущено пустых глав: 1.').waitFor();
  assert.equal(await dialog.getByLabel('Формат выгрузки').locator('option').count(),7);
  const outputs=[];
  for (const format of ['txt','fb2','epub','md','html','docx','pdf']) {
    await dialog.getByLabel('Формат выгрузки').selectOption(format);
    const downloadPromise=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'Скачать файл',exact:true}).click();
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),`Книга проверки.${format}`);
    await download.saveAs(path.join(dir,'download.'+format));outputs.push(format);
    await dialog.getByRole('status').waitFor();assert.equal(await download.failure(),null);
  }
  await page.screenshot({path:'reports/screenshots/book-export.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'reports/screenshots/book-export-mobile.png'});
  const downloadBounds=await dialog.getByRole('button',{name:'Скачать файл',exact:true}).boundingBox();assert.ok(downloadBounds&&downloadBounds.x>=0&&downloadBounds.x+downloadBounds.width<=390);
  await page.setViewportSize({width:1500,height:950});
  await dialog.getByRole('button',{name:'Закрыть диалог'}).click();
  const nav=page.getByRole('navigation',{name:'Материалы книги'});
  if(!await nav.isVisible())await page.getByRole('button',{name:'Навигация',exact:true}).click();
  await nav.getByRole('button',{name:'Поглавный план',exact:true}).click();
  await nav.getByRole('button',{name:'1. Начало',exact:true}).click();
  await nav.getByRole('button',{name:'Рукопись',exact:true}).first().click();
  await page.getByLabel('Текст главы').fill('Несохранённая рукопись');
  await page.waitForTimeout(400);
  await page.getByRole('button',{name:'Выгрузить книгу',exact:true}).click();
  await dialog.getByText(/Есть несохранённые правки/).waitFor();
  await dialog.getByLabel('Формат выгрузки').selectOption('txt');
  const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'Скачать файл',exact:true}).click();
  const download=await downloadPromise;const file=await download.path();assert.match(fs.readFileSync(file,'utf8'),/Сохранённая рукопись/);assert.ok(!fs.readFileSync(file,'utf8').includes('Несохранённая рукопись'));
  await dialog.getByRole('button',{name:'Закрыть диалог'}).click();assert.equal(await page.getByLabel('Текст главы').inputValue(),'Несохранённая рукопись');
  assert.deepEqual(errors,[]);
  fs.writeFileSync('reports/book-export-ui.json',JSON.stringify({status:'PASS',formats:outputs,draftPreserved:true,errors},null,2));
  console.log('PASS: seven UI downloads, skipped chapter, saved version and preserved draft');
} finally {await browser.close();await new Promise(r=>server.close(r));store.close();}
