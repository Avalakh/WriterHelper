import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { Store, children, createProject, createBook, createChapter } from '../server/store.js';
import { collectBook, exportBook, exportFormats, bookExportSummary } from '../server/book-export.js';
import { makeServer } from '../server/index.js';

function fixture(t) {
  fs.mkdirSync('test-data',{recursive:true});
  const directory=fs.mkdtempSync(path.resolve('test-data/export-')),store=new Store(directory);
  t.after(()=>store.close());
  const p=createProject(store,'Проект'),book=createBook(store,p.id,'Книга <&> «Тест»',1),plan=children(store,book.id,'plan')[0];
  const second=createChapter(store,plan.id,2,'Вторая'),first=createChapter(store,plan.id,1,'Первая'),empty=createChapter(store,plan.id,3,'Пустая');
  for(const [c,content] of [[first,'# Старое название\n\nНачало **истории** и *мысль*.\n\n> Заряд: 3%.\n\n***\n\n<script>alert(1)</script>\n\nКонец первой.'],[second,'Вторая глава.\n\n'+('Длинная строка с кириллицей — ёж идёт в сад.\n\n').repeat(70)]]) {
    const m=children(store,c.id,'manuscript')[0];store.save({...m,content},m.rev);
  }
  store.save({type:'candidate',parent:first.id,title:'Не включать',content:'КАНДИДАТ-СЕКРЕТ'});
  const other=createBook(store,p.id,'Чужая книга',2),otherChapter=createChapter(store,children(store,other.id,'plan')[0].id,1,'Чужая');
  const m=children(store,otherChapter.id,'manuscript')[0];store.save({...m,content:'ЧУЖОЙ-ТЕКСТ'},m.rev);
  return {store,book,first,second,empty,directory};
}
test('exports all seven formats without changing materials; archives contain ordered chapters and metadata', async t=>{
  const {store,book,directory}=fixture(t),before=JSON.stringify(store.all());
  const summary=bookExportSummary(store,book.id);assert.equal(summary.chapters,2);assert.deepEqual(summary.skipped,['3. Пустая']);
  assert.deepEqual(collectBook(store,book.id).chapters.map(c=>c.title),['1. Первая','2. Вторая']);
  for (const format of Object.keys(exportFormats)) {
    const file=await exportBook(store,{book:book.id,format,author:'Автор & соавтор',fingerprint:summary.fingerprint});
    assert.ok(file.data.length>100);assert.ok(file.filename.endsWith('.'+format));assert.ok(!file.filename.includes('<'));
    fs.writeFileSync(path.join(directory,'book.'+format),file.data);
    if(['txt','md','html','fb2'].includes(format)) {
      const text=file.data.toString();assert.ok(text.indexOf('1. Первая')<text.indexOf('2. Вторая'));
      assert.ok(!text.includes('ЧУЖОЙ-ТЕКСТ')&&!text.includes('КАНДИДАТ-СЕКРЕТ'));assert.ok(!text.includes('Старое название'));
      if(format==='html'||format==='fb2') assert.ok(!text.includes('<script>'));
    }
    if(format==='epub') {
      assert.equal(file.data.readUInt16LE(8),0);assert.equal(file.data.subarray(30,38).toString(),'mimetype');
      const zip=await JSZip.loadAsync(file.data);assert.equal(await zip.file('mimetype').async('string'),'application/epub+zip');
      const opf=await zip.file('EPUB/package.opf').async('string');assert.match(opf,/dc:language>ru</);assert.match(opf,/properties="nav"/);assert.ok(opf.indexOf('idref="c1"')<opf.indexOf('idref="c2"'));
      assert.match(await zip.file('EPUB/chapter-1.xhtml').async('string'),/<strong>истории<\/strong>/);
    }
    if(format==='docx') {
      const zip=await JSZip.loadAsync(file.data),document=await zip.file('word/document.xml').async('string');
      assert.ok(document.includes('Первая')&&document.includes('Вторая'));assert.ok(!document.includes('КАНДИДАТ-СЕКРЕТ'));
    }
    if(format==='pdf')assert.equal(file.data.subarray(0,5).toString(),'%PDF-');
  }
  assert.equal(JSON.stringify(store.all()),before);
  fs.writeFileSync('reports/export-fixture-path.txt',directory);
});
test('rejects empty book, invalid format, wrong target, invalid metadata and stale export summary', async t=>{
  const {store,book,first}=fixture(t),fingerprint=bookExportSummary(store,book.id).fingerprint;
  await assert.rejects(exportBook(store,{book:book.id,format:'zip'}),/Неподдерживаемый/);
  await assert.rejects(exportBook(store,{book:first.id,format:'txt'}),/Выберите книгу/);
  await assert.rejects(exportBook(store,{book:book.id,format:'epub',language:'<bad>'}),/Проверьте/);
  const m=children(store,first.id,'manuscript')[0];store.save({...m,content:'Изменённый текст'},m.rev);
  await assert.rejects(exportBook(store,{book:book.id,format:'txt',fingerprint}),/изменилась/);
  const empty=createBook(store,book.parent,'Пустая',5);
  await assert.rejects(exportBook(store,{book:empty.id,format:'pdf'}),/нет заполненных/);
});
test('HTTP download exposes UTF-8 filename and rejects untrusted requests', async t=>{
  const {store,book}=fixture(t),server=makeServer(store);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const summary=await (await fetch(url+'/api/book/export/summary?book='+book.id)).json();assert.equal(summary.chapters,2);
  const response=await fetch(url+'/api/book/export',{method:'POST',headers:{'Content-Type':'application/json','X-Writer-Client':'1'},body:JSON.stringify({book:book.id,format:'txt',fingerprint:summary.fingerprint})});
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.match(await response.text(),/Начало истории и мысль/);
  const forbidden=await fetch(url+'/api/book/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);
});
