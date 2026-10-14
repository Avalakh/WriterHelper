import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, createProject, createBook, createChapter, children } from '../server/store.js';
import { textContext } from '../server/text-context.js';
test('Nearest book context preserves local neighbours, identifies field and excludes other books and later chapters',t=>{
 const store=new Store(fs.mkdtempSync(path.resolve('test-data/text-context-')));t.after(()=>store.close());
 const project=createProject(store,'Проект'),book=createBook(store,project.id,'Книга',1),docs=children(store,book.id),chapter=createChapter(store,docs.find(e=>e.type==='plan').id,11,'Дом и дорога');
 const current=store.save({...chapter,content:'Герой ремонтирует корабль. Линия питания отключена.'},chapter.rev),target=children(store,current.id,'manuscript')[0];
 const later=createChapter(store,current.parent,12,'Будущая тайна');store.save({...later,content:'СЕКРЕТ БУДУЩЕГО'},later.rev);createBook(store,project.id,'ЧУЖАЯ КНИГА',2);
 const context=textContext(store,{contextMode:'compact',target:target.id,field:'Текст главы',text:'Линия отключена.',before:'Несохранённый абзац о кабеле питания.',after:'Герой затягивает болт.'},{context:32000,maxOutput:1000});
 assert.equal(context.book.title,'Книга');assert.equal(context.chapter.number,11);assert.equal(context.field,'Текст главы');assert.ok(JSON.stringify(context).includes('Несохранённый абзац'));assert.ok(JSON.stringify(context).includes('Линия питания'));assert.ok(!JSON.stringify(context).includes('СЕКРЕТ БУДУЩЕГО'));assert.ok(!JSON.stringify(context).includes('ЧУЖАЯ КНИГА'));
 const huge=textContext(store,{contextMode:'compact',target:target.id,text:'X',before:'А'.repeat(5000),after:'Б'.repeat(5000)},{context:32000,maxOutput:1000});assert.ok(huge.characters<=16000);assert.equal(huge.sources[0].text.length,1600);
 const small=textContext(store,{contextMode:'compact',target:target.id,text:'X'.repeat(1000),before:'А'.repeat(5000),after:'Б'.repeat(5000)},{context:2300,maxOutput:1000});assert.ok(small.characters<=800);assert.throws(()=>textContext(store,{target:'missing'},{}),/не найден/);
});
