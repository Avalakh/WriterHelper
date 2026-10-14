import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, createProject, createBook, children } from '../server/store.js';
test('New books start with A4; reopening preserves custom preview dimensions',t=>{
 fs.mkdirSync('test-data',{recursive:true});
 const directory=fs.mkdtempSync(path.resolve('test-data/preview-defaults-'));
 let store=new Store(directory);t.after(()=>store.close());
 const project=createProject(store,'Fixture'),book=createBook(store,project.id,'Book',1);
 const preview=children(store,book.id,'preview')[0];
 assert.equal(preview.fields.width,794);assert.equal(preview.fields.height,1123);assert.equal(preview.fields.fitWidth,false);
 store.save({...preview,fields:{...preview.fields,width:1200,height:1400}},preview.rev);
 store.close();store=new Store(directory);
 assert.equal(store.get(preview.id).fields.width,1200);assert.equal(store.get(preview.id).fields.height,1400);
});
