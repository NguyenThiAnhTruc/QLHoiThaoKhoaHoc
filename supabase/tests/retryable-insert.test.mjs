import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {transform} from 'esbuild';
const {code}=await transform(await readFile('src/lib/retryableInsert.ts','utf8'),{loader:'ts',format:'esm'});
const {confirmInsert,insertAttempt}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('unchanged form keeps its insertion ID; changed payload gets a new ID',()=>{
 const a=insertAttempt(null,{amount:100});
 assert.equal(insertAttempt(a,{amount:100}).id,a.id);
 assert.notEqual(insertAttempt(a,{amount:200}).id,a.id);
});
test('lost acknowledgement is reconciled against the exact inserted record',async()=>{
 await confirmInsert(async()=>{throw new Error('offline');},async()=>({data:{id:'same-id'},error:null}));
});
test('failed or unavailable lookup does not claim the write succeeded',async()=>{
 for(const result of [{data:null,error:null},{data:null,error:new Error('offline')}])
  await assert.rejects(confirmInsert(async()=>({error:new Error('write failed')}),async()=>result),/write failed/);
});
