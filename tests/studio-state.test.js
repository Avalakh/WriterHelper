import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPreferences } from '../src/state/workspace.ts';
import { differs, recoverableDraft } from '../src/state/drafts.ts';

test('Recovery requires actual unsaved changes and ignores newline or object key formatting',()=>{
 const base={id:'text',type:'manuscript',rev:1,title:'Рукопись',content:'Строка\r\nАбзац',fields:{a:1,b:2}};
 const same={...base,content:'Строка\nАбзац',fields:{b:2,a:1}};
 assert.equal(differs(base,same),false);
 assert.equal(recoverableDraft({base,draft:same}, {...base,rev:2,content:'Обновлённый текст'}),false);
 const edited={...same,content:same.content+'\nПравка автора'};
 assert.equal(recoverableDraft({base,draft:edited},base),true);
 assert.equal(recoverableDraft({base,draft:edited}, {...edited,rev:2}),false);
 assert.equal(differs({...base,fields:{people:['A','B']}},{...base,fields:{people:['B','A']}}),true);
});
test('Studio preferences restore legacy selection and safely bound corrupted settings',()=>{
 const values=new Map([['writer-selected','old-material']]);global.localStorage={getItem:key=>values.get(key)||null};
 assert.equal(readPreferences().selected,'old-material');values.set('writer-studio-ui-v1','broken JSON');assert.equal(readPreferences().selected,'old-material');
 values.set('writer-studio-ui-v1',JSON.stringify({selected:'new-material',left:9999,right:-4,theme:'invalid',font:'broken',cursors:{a:'bad',b:[4,7]},scrolls:[],opened:[]}));
 const p=readPreferences();assert.equal(p.selected,'new-material');assert.equal(p.left,360);assert.equal(p.right,280);assert.equal(p.theme,'system');assert.equal(p.font,'Georgia');assert.deepEqual(p.cursors,{b:[4,7]});assert.deepEqual(p.opened,{});
 global.localStorage={getItem(){throw Error('Storage denied');}};assert.equal(readPreferences().selected,'');delete global.localStorage;
});
