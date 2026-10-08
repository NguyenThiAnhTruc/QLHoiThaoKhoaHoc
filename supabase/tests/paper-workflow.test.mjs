import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(
  new URL('../../src/lib/paperWorkflow.ts', import.meta.url),
  'utf8',
);
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const {
  PAPER_STATUS_DISPLAY_ORDER,
  PAPER_STATUS_NUMBERS,
  getPaperStatusTransitions,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('orders decision statuses like the requested workflow', () => {
  assert.deepEqual(PAPER_STATUS_DISPLAY_ORDER, [
    'accepted',
    'rejected',
    'revision_required',
    'under_review',
    'submitted',
  ]);
  assert.deepEqual(PAPER_STATUS_NUMBERS, {
    accepted: 1,
    rejected: 2,
    revision_required: 3,
    under_review: 4,
  });
});

test('a submitted paper starts review only after an assignment exists', () => {
  assert.deepEqual(getPaperStatusTransitions('submitted', false, false), []);
  assert.deepEqual(getPaperStatusTransitions('submitted', true, false), [
    'under_review',
  ]);
});

test('a paper can receive a decision only after a review is completed', () => {
  assert.deepEqual(getPaperStatusTransitions('under_review', true, false), []);
  assert.deepEqual(getPaperStatusTransitions('under_review', true, true), [
    'accepted',
    'rejected',
    'revision_required',
  ]);
});

test('a revised paper returns to review and final decisions cannot move backward', () => {
  assert.deepEqual(getPaperStatusTransitions('revision_required', true, true), [
    'under_review',
  ]);
  assert.deepEqual(getPaperStatusTransitions('accepted', true, true), []);
  assert.deepEqual(getPaperStatusTransitions('rejected', true, true), []);
});
