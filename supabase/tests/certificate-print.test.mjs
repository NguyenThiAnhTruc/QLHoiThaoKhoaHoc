import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/certificatePrint.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { escapeCertificateText } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('profile and conference HTML payloads remain printable text', () => {
  const payload = '</title><script>alert(1)</script><img src=x onerror="alert(2)">';
  const escaped = escapeCertificateText(payload);
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&quot;'));
});
test('preserves Vietnamese text and safely handles missing fields and entities', () => {
  assert.equal(escapeCertificateText('Nguyễn Văn A & B'), 'Nguyễn Văn A &amp; B');
  assert.equal(escapeCertificateText('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  assert.equal(escapeCertificateText(null), '');
});
