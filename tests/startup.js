import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../server/store.js';

fs.mkdirSync('test-data',{recursive:true});const directory=fs.mkdtempSync(path.resolve('test-data/clean-start-'));
const port=44000+Math.floor(Math.random()*5000);
const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,WRITER_DATA:directory,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',b=>{if(b.toString().includes('WriterHelper:')){clearTimeout(timeout);resolve();}});child.on('exit',code=>reject(Error('Server exited '+code)));});
  const root=await fetch(`http://127.0.0.1:${port}/`);assert.equal(root.status,200);assert.ok((await root.text()).includes('WriterHelper'));
  const state=await(await fetch(`http://127.0.0.1:${port}/api/state`)).json();assert.equal(state.entities.filter(e=>e.type==='prompt').length,8);
  console.log(JSON.stringify({status:'PASS',directory,prompts:8,loopbackPort:port}));
}finally{child.kill();await new Promise(r=>child.once('exit',r));const store=new Store(directory);assert.equal(store.all('prompt').length,8);store.close();}
