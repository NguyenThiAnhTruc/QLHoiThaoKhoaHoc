import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../../src/lib/constants.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { getConferenceDisplayStatus } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function withNow(iso, callback) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return new RealDate(iso).getTime(); }
  };
  try { callback(); } finally { globalThis.Date = RealDate; }
}

test('an open future conference without a registration deadline remains open', () => {
  withNow('2026-09-24T12:00:00', () => assert.equal(getConferenceDisplayStatus({
    status: 'open', start_date: '2026-09-30', end_date: '2026-10-01', registration_deadline: null,
  }), 'open'));
});

test('a date-only end date remains ongoing for its entire final day', () => {
  withNow('2026-09-24T18:00:00', () => assert.equal(getConferenceDisplayStatus({
    status: 'open', start_date: '2026-09-23', end_date: '2026-09-24', registration_deadline: null,
  }), 'ongoing'));
});

test('expired registration and ended conferences display the derived state', () => {
  withNow('2026-09-24T12:00:00', () => {
    assert.equal(getConferenceDisplayStatus({ status: 'open', start_date: '2026-09-30', end_date: '2026-10-01', registration_deadline: '2026-09-23T23:59:59' }), 'closed');
    assert.equal(getConferenceDisplayStatus({ status: 'open', start_date: '2026-09-20', end_date: '2026-09-23', registration_deadline: null }), 'completed');
  });
});
