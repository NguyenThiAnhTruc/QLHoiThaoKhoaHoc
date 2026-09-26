import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../functions/paper-download/handler.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { createPaperDownloadHandler } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const paperId = '92000000-0000-0000-0000-000000000001';
const authorPath = '90000000-0000-0000-0000-000000000003/manuscript.pdf';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const input = (body = { paperId }, auth = 'Bearer user-jwt') => new Request('http://localhost/paper-download', {
  method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body),
});
function fixture(responses) {
  const calls = [];
  const handler = createPaperDownloadHandler({
    supabaseUrl: 'https://project.supabase.co', anonKey: 'anon', serviceRoleKey: 'server-only',
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.ok(responses.length, 'unexpected upstream request');
      return responses.shift();
    },
  });
  return { handler, calls };
}

test('reject missing auth before privileged fetch', async () => {
  const { handler, calls } = fixture([]);
  assert.equal((await handler(input({ paperId }, ''))).status, 401);
  assert.equal(calls.length, 0);
});
test('reject malformed identifiers', async () => {
  const { handler, calls } = fixture([]);
  assert.equal((await handler(input({ paperId: '../objects' }))).status, 400);
  assert.equal(calls.length, 0);
});
test('reject invalid user JWT', async () => {
  const { handler, calls } = fixture([json({}, 401)]);
  assert.equal((await handler(input())).status, 401);
  assert.equal(calls.length, 1);
});
test('deny another paper without accessing service role', async () => {
  const { handler, calls } = fixture([json({ id: 'reviewer' }), json([])]);
  assert.equal((await handler(input())).status, 403);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === 'Bearer user-jwt'));
});
test('return PDF bytes without revealing object path or storage headers', async () => {
  const pdf = new Uint8Array([37,80,68,70,45,49,46,55,10,0,255]);
  const { handler, calls } = fixture([
    json({ id: 'reviewer' }), json([{ id: paperId, file_url: `blind:${paperId}` }]),
    json([{ file_url: authorPath }]), new Response(pdf, { headers: { 'Content-Location': authorPath } }),
  ]);
  const response = await handler(input());
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
  assert.equal(response.headers.get('Content-Location'), null);
  assert.equal(response.headers.get('Content-Disposition'), 'inline; filename="review-paper.pdf"');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls[3].options.redirect, 'error');
  assert.equal(calls[3].options.headers.Authorization, 'Bearer server-only');
});
test('never send credentials to an external manuscript URL', async () => {
  const { handler, calls } = fixture([
    json({ id: 'reviewer' }), json([{ id: paperId, file_url: `blind:${paperId}` }]),
    json([{ file_url: 'https://untrusted.example/file.pdf' }]),
  ]);
  assert.equal((await handler(input())).status, 422);
  assert.equal(calls.length, 3);
});
test('legacy bucket URL is fetched internally without redirecting the reader', async () => {
  const { handler, calls } = fixture([
    json({ id: 'reviewer' }), json([{ id: paperId, file_url: `blind:${paperId}` }]),
    json([{ file_url: `https://project.supabase.co/storage/v1/object/public/paper-files/${authorPath}` }]),
    new Response('pdf'),
  ]);
  assert.equal((await handler(input())).status, 200);
  assert.equal(calls[3].url, `https://project.supabase.co/storage/v1/object/authenticated/paper-files/${authorPath}`);
});
test('reject path traversal in stored file references', async () => {
  const { handler, calls } = fixture([
    json({ id: 'reviewer' }), json([{ id: paperId, file_url: `blind:${paperId}` }]),
    json([{ file_url: '../private/secret' }]),
  ]);
  assert.equal((await handler(input())).status, 404);
  assert.equal(calls.length, 3);
});
