import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {transform} from 'esbuild';
const {code}=await transform(await readFile('src/lib/listPage.ts','utf8'),{loader:'ts',format:'esm'});
const {listPage,normalizeSearch}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('pagination clamps a removed last page and preserves empty result state',()=>{
 const p=listPage([1,2,3],99,2);assert.equal(p.page,2);assert.deepEqual(p.items,[3]);
 assert.deepEqual(listPage([],2,0),{page:1,totalPages:1,total:0,items:[]});
});
test('Vietnamese search matches accented names and uppercase D with stroke',()=>{
 assert.equal(normalizeSearch('  ĐẶNG Thị Ánh '),'dang thi anh');
 assert.ok(normalizeSearch('Đại học Huế').includes(normalizeSearch('dai hoc')));
});
