import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/fetchAll.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { fetchAll } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

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
