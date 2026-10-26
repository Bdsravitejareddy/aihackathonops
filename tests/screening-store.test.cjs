'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createStore}=require('../server/store.cjs');

test('PIN applicant lookup queries Neon records by exact normalized six-digit PIN',async()=>{
  const calls=[];
  const store=createStore({query:async(sql,params)=>{calls.push({sql,params});return {rows:[{record:{id:'A-1',pin:'560001',investment:30}}]};}});
  const rows=await store.listApplicationsByPin('f28e574b-6f52-4f24-97c6-69e0c28bb54f','560001');
  assert.deepEqual(rows,[{id:'A-1',pin:'560001',investment:30}]);
  assert.match(calls[0].sql,/workspace_id\s*=\s*\$1/);
  assert.match(calls[0].sql,/record\s*->>\s*'pin'\s*=\s*\$2/);
  assert.deepEqual(calls[0].params,['f28e574b-6f52-4f24-97c6-69e0c28bb54f','560001']);
});

test('PIN applicant lookup rejects invalid PIN formats before querying',async()=>{
  let calls=0;const store=createStore({query:async()=>{calls++;return {rows:[]};}});
  await assert.rejects(()=>store.listApplicationsByPin('workspace','56001'),/six-digit/i);
  assert.equal(calls,0);
});
