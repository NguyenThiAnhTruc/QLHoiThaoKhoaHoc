import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/fetchAll.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { fetchAll, fetchByIds } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('returns all records despite a smaller server row cap', async () => {
  const source = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const result = await fetchAll(async from => ({ data: source.slice(from, from + 100), count: source.length, error: null }));
  assert.deepEqual(result.data, source);
});
test('does not publish partial statistics when a later page fails', async () => {
  const result = await fetchAll(async from => from === 0
    ? { data: [1, 2], count: 3, error: null }
    : { data: null, count: null, error: { message: 'connection lost' } });
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'connection lost');
});
test('rejects a truncated response instead of displaying incorrect totals', async () => {
  const result = await fetchAll(async from => ({ data: from === 0 ? [1] : [], count: 3, error: null }));
  assert.equal(result.data, null);
  assert.ok(result.error);
});
test('handles missing counts and empty data without looping forever', async () => {
  const result = await fetchAll(async from => ({ data: from === 0 ? [1] : [], count: null, error: null }));
  assert.deepEqual(result.data, [1]);
  const empty = await fetchAll(async () => ({ data: [], count: 0, error: null }));
  assert.deepEqual(empty.data, []);
});

test('a network exception on a later batch never publishes partial rows',async()=>{
 const result=await fetchAll(async from=>{if(from)throw new Error('Network failure');return {data:[1],count:2,error:null};});
 assert.equal(result.data,null);assert.ok(result.error);
});


test('related-record queries bound IN filters and preserve all rows under small API caps',async()=>{
 const ids=Array.from({length:267},(_,i)=>String(i));let calls=0;
 const result=await fetchByIds([...ids,ids[0]],async(batch,from)=>{
  assert.ok(batch.length<=100);calls++;
  return {data:batch.slice(from,from+17),error:null,count:batch.length};
 });
 assert.deepEqual(result.data,ids);assert.ok(calls>3);
});
test('a failed related-record batch does not expose an incomplete list',async()=>{
 const ids=Array.from({length:101},(_,i)=>String(i));
 const result=await fetchByIds(ids,async(batch)=>batch.includes('100')?{data:null,error:{message:'failed'},count:null}:{data:batch,error:null,count:batch.length});
 assert.equal(result.data,null);assert.ok(result.error);
});
