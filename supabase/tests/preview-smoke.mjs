import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd=fileURLToPath(new URL('../..', import.meta.url));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4179','--strictPort'],{cwd,stdio:'ignore',windowsHide:true});
const url='http://127.0.0.1:4179';
try {
  let response;
  for(let attempt=0;attempt<30;attempt++) {
    try { response=await fetch(url,{signal:AbortSignal.timeout(1000)}); break; }
    catch { await new Promise((resolve)=>setTimeout(resolve,250)); }
  }
  assert.ok(response?.ok,'Preview server serves the built application');
  const html=await response.text();
  assert.match(html,/id="root"/);
  assert.doesNotMatch(html,/modulepreload[^>]*scanner/,'Scanner is loaded only when QR is opened');
  const script=html.match(/src="([^\"]+\.js)"/)[1];
  assert.equal((await fetch(url+script)).status,200);
  const template=await fetch(url+'/certificate-template.html');
  assert.equal(template.status,200);
  assert.match(await template.text(),/contenteditable="true"/);
  process.stdout.write('Preview smoke passed: app, JS assets, editable certificate template and deferred QR scanner.\n');
} finally { server.kill(); }
