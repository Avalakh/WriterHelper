import test from 'node:test';import assert from 'node:assert/strict';import {modelConnection} from '../server/model-choice.js';
test('Primary defaults and packet snapshots do not mutate saved connection',()=>{
 const connection={model:'legacy',primaryModel:'main',reviewModel:''};assert.equal(modelConnection(connection).model,'main');assert.equal(modelConnection(connection).reviewModel,'main');assert.equal(modelConnection(connection,{model:'once'}).model,'once');assert.equal(modelConnection({...connection,primaryModel:'new'},{model:'snapshot',reviewModel:'snapshot-review'}).model,'snapshot');assert.equal(modelConnection({...connection,reviewModel:'review'}).reviewModel,'review');assert.equal(connection.model,'legacy');assert.equal(connection.primaryModel,'main');
});
