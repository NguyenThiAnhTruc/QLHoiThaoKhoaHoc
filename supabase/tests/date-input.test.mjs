import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../../src/lib/dateInput.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { toLocalDateTimeInput, parseDateInput } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('editing a session preserves its instant in local date/time inputs', () => {
  for (const value of ['2026-09-27T08:30:00Z', '2026-09-28T00:15:00+07:00']) {
    assert.equal(new Date(toLocalDateTimeInput(value)).getTime(), new Date(value).getTime());
  }
  assert.equal(toLocalDateTimeInput('invalid'), '');
});

test('Vietnamese date input rejects impossible dates and times', () => {
  assert.equal(parseDateInput('29/02/2026', false), '');
  assert.equal(parseDateInput('29/02/2028', false), '2028-02-29');
  assert.equal(parseDateInput('27/09/2026 24:00', true), '');
  assert.equal(parseDateInput('27/09/2026 08:30', true), '2026-09-27T08:30');
});
