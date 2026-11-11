import QRCode from "qrcode";
import {transform} from 'esbuild';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const profile=await mkdtemp(path.join(tmpdir(),'confmanager-ui-'));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4182','--strictPort'],{stdio:'ignore',windowsHide:true});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;let next=0;const pending=new Map();const errors=[];let onEvent=()=>{};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);chrome.stderr.on('data',chunk=>{output+=chunk;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else { if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);onEvent(m); }};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 const c=(m,p={})=>call(m,p,sessionId);await c('Runtime.enable');await c('Page.enable');
 const evaluate=async expression=>(await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 await pause(600);await c('Page.navigate',{url:'http://127.0.0.1:4182/'});
 for(let i=0;i<60;i++){if(await evaluate('document.body.innerText.length>200'))break;await pause(500);}
 await mkdir('docs/ui-review',{recursive:true});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:name==='mobile'});await evaluate('window.scrollTo(0,0)');await pause(700);
  const layout=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.body.innerText.slice(0,500),buttons:[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).filter(Boolean).slice(0,18)})');
  assert.ok(layout.scrollWidth<=width+1, name+' page has no horizontal overflow');console.log(name, 'page rendered; no horizontal overflow');
  const shot=await c('Page.captureScreenshot',{format:'png'});await writeFile('docs/ui-review/'+name+'.png',Buffer.from(shot.data,'base64'));
 }
 await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Đăng nhập")?.click()');await pause(500);
 console.log('signin',JSON.stringify(await evaluate('({text:document.body.innerText.slice(0,650),inputs:[...document.querySelectorAll("input")].map(i=>({type:i.type,placeholder:i.placeholder})),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})')));
 await c('Page.navigate',{url:'http://127.0.0.1:4182/certificate-template.html'});await pause(1000);
 console.log('certificate',JSON.stringify(await evaluate('({sealLoaded:document.getElementById("certificate-seal").naturalWidth>0,sealVisible:getComputedStyle(document.getElementById("certificate-seal")).display})')));
 assert.equal(await evaluate('document.getElementById("certificate-seal").naturalWidth>0'),true);
 const printed=await c('Page.printToPDF',{preferCSSPageSize:true,printBackground:true});const pdf=await PDFDocument.load(Buffer.from(printed.data,'base64'));console.log('certificate printed pages',pdf.getPageCount());assert.equal(pdf.getPageCount(),1,'Certificate template fits one landscape A4 page');
 const rendered=await transform(await readFile('src/lib/certificatePrint.ts','utf8'),{loader:'ts',format:'esm'});
 const {renderCertificate}=await import('data:text/javascript;base64,'+Buffer.from(rendered.code).toString('base64'));
 const {frameTree}=await c('Page.getFrameTree');
 const verificationUrl='http://127.0.0.1:4182/?certificate=00000000-0000-0000-0000-000000000001';
 const verificationQr=await QRCode.toDataURL(verificationUrl,{width:180,margin:1});
 for(const type of ['attendance','presentation']){
  const html=renderCertificate({name:'Nguyễn Thị Ánh',organization:'Trường Đại học Công nghệ',title:'Hội thảo Khoa học sinh viên Luật toàn quốc năm 2026',paper:type==='presentation'?'Hoàn thiện pháp luật Việt Nam trong bối cảnh chuyển đổi số':undefined,type,start:'2026-10-01',end:'2026-10-02',issued:'2026-10-03',number:'CN-2026-001',minutes:90,verificationUrl,verificationQr});
  await c('Page.setDocumentContent',{frameId:frameTree.frame.id,html});await pause(250);
  const generated=await c('Page.printToPDF',{preferCSSPageSize:true,printBackground:true});
  assert.equal((await PDFDocument.load(Buffer.from(generated.data,'base64'))).getPageCount(),1,type+' certificate fits one page');
 }
 // Authenticated UI uses isolated HTTP fixtures; no authenticated API or mutations reach Supabase.
 const env=await readFile('.env','utf8');const supabaseUrl=env.match(/^VITE_SUPABASE_URL=(.+)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
 const project=new URL(supabaseUrl).hostname.split('.')[0];
 const userId='a0000000-0000-0000-0000-000000000001';let mockRole='admin', profileFailure=false, verificationState='valid';
 onEvent=message=>{if(message.method!=='Fetch.requestPaused')return;const {requestId,request}=message.params;
  const url=new URL(request.url);let body=[],status=200;
  if(request.method==='OPTIONS'){body={};status=204;} else if(url.pathname.includes('/profiles')){body=[{id:userId,full_name:'UI Test',role:mockRole,organization:'Test',email:'ui@example.test',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'}];if(profileFailure){status=503;body={message:'Profile unavailable'};}}
  else if(url.pathname.includes('/rpc/verify_certificate'))body=verificationState==='missing'?[]:[{certificate_number:'CN-2026-001',conference_title:'UI verified conference',certificate_type:'attendance',issued_at:'2026-10-01T00:00:00Z',revoked_at:verificationState==='revoked'?'2026-10-02T00:00:00Z':null}];
  else if(url.pathname.includes('/auth/v1/user'))body={id:userId,email:'ui@example.test',aud:'authenticated'};
  else if(url.pathname.includes('/rpc/is_')||url.pathname.includes('/rpc/can_'))body=false;
  void c('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer,accept,range'},{name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,DELETE,OPTIONS'},{name:'Content-Range',value:'0-0/0'}],body:status===204?'':Buffer.from(JSON.stringify(body)).toString('base64')}).catch(()=>{});
 };
 await c('Fetch.enable',{patterns:[{urlPattern:supabaseUrl+'/*'}]});
 const expires=Math.floor(Date.now()/1000)+3600;
 const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:userId,exp:expires,aud:'authenticated',role:'authenticated'})).toString('base64url'),'test'].join('.');
 const session={access_token:token,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:expires,user:{id:userId,email:'ui@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-01T00:00:00Z'}};
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'localStorage.setItem('+JSON.stringify('sb-'+project+'-auth-token')+','+JSON.stringify(JSON.stringify(session))+');'});
 const waitFor=async(expression,label)=>{for(let i=0;i<50;i++){if(await evaluate(expression))return;await pause(200);}console.log('Failed UI state',await evaluate('document.body.innerText.slice(0,500)'));throw new Error('Timeout: '+label);};
 await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 for(const role of ['admin','organizer','author','reviewer','participant']){
  mockRole=role;await c('Page.navigate',{url:'http://127.0.0.1:4182/'});
  await waitFor('!!document.querySelector("aside nav")','profile '+role);
  const menus=await evaluate('[...document.querySelectorAll("aside nav button")].map(b=>b.textContent.trim())');
  assert.equal(menus.includes('Tài khoản'),role==='admin');
  assert.equal(menus.includes('Chủ đề'),false);
  assert.equal(menus.includes('Người tham dự'),false);
  assert.equal(menus.includes('Điểm danh'),false);
  for(const label of menus){await evaluate('[...document.querySelectorAll("aside nav button")].find(b=>b.textContent.trim()==='+JSON.stringify(label)+')?.click()');await pause(250);assert.ok(await evaluate('document.querySelector("main").innerText.length>0'),'page '+label);}
  for(const [width,height] of [[1440,1000],[390,844]]){await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width===390});await pause(200);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),role+' layout fits viewport');}
  await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  console.log('role UI',role,menus.length+' pages rendered with mocked backend');
  if(role==='organizer'){
   await evaluate('[...document.querySelectorAll("aside nav button")].find(b=>b.textContent.trim()==="Hội thảo").click()');await pause(200);
   await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent.includes("Tạo hội thảo")).click()');
   await waitFor('!!document.querySelector("[role=dialog]")','conference modal');
   await evaluate('(()=>{const input=document.querySelector("[role=dialog] input");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(input,"Draft remains after refresh");input.dispatchEvent(new Event("input",{bubbles:true}));})()');
   await evaluate('(()=>{const channel=new BroadcastChannel('+JSON.stringify('sb-'+project+'-auth-token')+');channel.postMessage({event:"TOKEN_REFRESHED",session:'+JSON.stringify(session)+'});setTimeout(()=>channel.close(),100);})()');
   await pause(350);
   assert.equal(await evaluate('document.querySelector("[role=dialog] input")?.value'),'Draft remains after refresh','token refresh preserves form input');
   assert.equal(await evaluate('document.body.style.overflow'),'hidden');
   assert.equal(await evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'),true);
   await c('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await waitFor('!document.querySelector("[role=dialog]")','modal closes on Escape');
  }
 }
 for(const [state,label] of [['valid','Chứng nhận đang có hiệu lực'],['revoked','Chứng nhận đã thu hồi'],['missing','Không tìm thấy chứng nhận']]){verificationState=state;await c('Page.navigate',{url:'http://127.0.0.1:4182/?certificate=00000000-0000-0000-0000-000000000001'});await waitFor('document.body.innerText.includes('+JSON.stringify(label)+')','public certificate '+state);}
 console.log('Public certificate UI: valid, revoked and missing states passed');
 profileFailure=true;await c('Page.navigate',{url:'http://127.0.0.1:4182/'});await waitFor('document.body.innerText.includes("Không thể tải hồ sơ")','profile failure');
 profileFailure=false;await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Thử lại").click()');await waitFor('!!document.querySelector("aside nav")','profile retry');
 assert.deepEqual(errors,[]);console.log('runtimeExceptions',JSON.stringify(errors));

}finally{ws?.close();chrome.kill();server.kill();await pause(500);assert.equal(path.dirname(path.resolve(profile)),path.resolve(tmpdir()));assert.ok(path.basename(profile).startsWith('confmanager-ui-'));await rm(profile,{recursive:true,force:true}).catch(()=>{});}
