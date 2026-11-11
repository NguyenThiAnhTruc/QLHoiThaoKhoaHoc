import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/certificatePrint.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { certificateOrganization, escapeCertificateText, renderCertificate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
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

const input = { name: 'Nguyễn Văn A', title: '<script>alert(1)</script>', type: 'attendance', start: '2026-10-01', end: '2026-10-02', issued: '2026-10-03', number: 'CN-01' };
test('certificate uses transparent seal and escapes unsafe content and seal URLs', () => {
  const html = renderCertificate({...input, seal: 'javascript:alert(1)'});
  assert.match(html, /src="\/images\/con-dau.png"/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.match(renderCertificate({...input, seal:'data:image/png;base64,aGVsbG8='}), /src="data:image\/png;base64,aGVsbG8="/);
});
test('demo organizations are omitted from certificates', () => {
  assert.equal(certificateOrganization('Trường Đại học Demo'), '');
  assert.equal(certificateOrganization('Đại học Công nghệ'), 'Đại học Công nghệ');
  assert.ok(!renderCertificate({...input, organization: 'Trường Đại học Demo'}).includes('Trường Đại học Demo'));
});
test('downloadable template embeds PNG with an alpha channel for offline use', async () => {
  const html=await readFile(new URL('../../public/certificate-template.html',import.meta.url),'utf8');
  const data=html.match(/id="certificate-seal" src="data:image\/png;base64,([^"]+)"/);
  assert.ok(data, 'Seal is embedded instead of relying on the local filesystem');
  const png=Buffer.from(data[1],'base64');
  assert.equal(png.subarray(1,4).toString(), 'PNG');
  assert.equal(png[25],6,'PNG has RGBA transparency');
});
