import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const { code } = await transform(await readFile(new URL('../../src/lib/requestTimeout.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { withRequestTimeout } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('returns successful response and clears timeout', async () => {
  let signal;
  assert.equal(await withRequestTimeout(s => { signal = s; return Promise.resolve('saved'); }, 10, 'timeout'), 'saved');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test('releases a hung request and aborts its network signal', async () => {
  let signal;
  await assert.rejects(withRequestTimeout(s => { signal = s; return new Promise(() => {}); }, 10, 'upload timed out'), /upload timed out/);
  assert.equal(signal.aborted, true);
});

test('preserves server errors and supports a subsequent retry', async () => {
  await assert.rejects(withRequestTimeout(() => Promise.reject(new Error('denied')), 100, 'timeout'), /denied/);
  assert.equal(await withRequestTimeout(() => Promise.resolve('retry saved'), 100, 'timeout'), 'retry saved');
});
