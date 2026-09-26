import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/exportExcel.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { excelXml } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('exports Vietnamese titles safely as text, not formulas or XML', () => {
  const output = excelXml(['Hội thảo', 'Đăng ký'], [['=1+1 <Hội thảo> & "AI"\u0000', 12]]);
  assert.ok(output.includes('ss:Type="String">=1+1 &lt;Hội thảo&gt; &amp; &quot;AI&quot;'));
  assert.ok(output.includes('ss:Type="Number">12'));
  assert.ok(!output.includes('\u0000'));
  assert.ok(!output.includes('ss:Formula'));
});
