import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {PDFDocument} from 'pdf-lib';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const result=await build({entryPoints:['supabase/functions/post-seminar/handler.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'deno-npm',setup(builder){builder.onResolve({filter:/^npm:/},args=>({path:pathToFileURL(require.resolve(args.path.replace(/^npm:/,'').replace(/@\d[^/]*$/,''))).href,external:true}));}}]});
const {createPostSeminarHandler}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const font=await readFile('supabase/functions/post-seminar/assets/NotoSans-Regular.ttf');
const seal=await readFile('supabase/functions/post-seminar/assets/con-dau.png');
const config={url:'https://example.supabase.co',key:'private-test-key',secret:'test-job-secret',appUrl:'https://conference.example/app',clientId:'client',clientSecret:'secret',refreshToken:'refresh',sender:'organizer@example.com'};
const request=()=>new Request('https://example.test/function',{method:'POST',headers:{'X-Job-Secret':config.secret}});
function fixture({kind='certificate',delivery=200,reservation=true,lostAcknowledgement=false}={}) {
  const calls=[];let mime='',pdf;
  const fetcher=async(url,options={})=>{
    calls.push({url,options});const path=new URL(url).pathname;
    const json=value=>Response.json(value);
    if(path==='/token')return json({access_token:'test-access'});
    if(path.endsWith('/rpc/begin_post_seminar_delivery'))return json(reservation);
    if(path.endsWith('/rpc/enqueue_post_seminar_jobs'))return json(1);
    if(path.endsWith('/rpc/claim_post_seminar_jobs'))return json([{id:'job-1',conference_id:'conf-1',user_id:'user-1',certificate_id:'cert-1',session_id:'session-1',kind,attempts:1}]);
    if(path.endsWith('/profiles'))return json([{full_name:'Nguyễn Thị Ánh',organization:'Đại học Công nghệ',contact_email:'author@example.com'}]);
    if(path.endsWith('/conferences'))return json([{title:'Hội thảo Khoa học',location:'Hà Nội',start_date:'2026-10-01',end_date:'2026-10-02',status:'completed',auto_certificates:true,auto_surveys:true}]);
    if(path.endsWith('/sessions'))return json([{title:'Phiên trí tuệ nhân tạo'}]);
    if(path.endsWith('/certificates') && !options.method)return json([{id:'cert-1',certificate_number:'CN-2026-01',issued_at:'2026-10-03',attendance_minutes:90}]);
    if(path.includes('/storage/v1/object/')){pdf=options.body;return json({});}
    if(path.endsWith('/messages/send')){const raw=JSON.parse(options.body).raw;mime=Buffer.from(raw,'base64url').toString('utf8');return new Response('{}',{status:delivery});}
    if(options.method==='PATCH' && path.endsWith('/post_seminar_jobs') && lostAcknowledgement && JSON.parse(options.body).status==='sent')throw new Error('lost acknowledgement');
    if(options.method==='PATCH')return new Response(null,{status:204});
    throw new Error(`Unexpected mocked path: ${path}`);
  };
  return {calls,fetcher,get mime(){return mime},get pdf(){return pdf}};
}
test('worker rejects unauthorized calls before reading data or contacting Gmail',async()=>{
  const handler=createPostSeminarHandler(config,async()=>font,async()=>{throw new Error('Must not call network');});
  assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401);
  assert.equal((await handler(new Request('https://example.test'))).status,405);
});
test('certificate job stores one Vietnamese PDF privately and attaches it to email',async()=>{
  const f=fixture();const response=await createPostSeminarHandler(config,async()=>font,f.fetcher)(request());
  assert.deepEqual(await response.json(),{sent:1,failed:0});
  const document=await PDFDocument.load(f.pdf);assert.equal(document.getPageCount(),1);assert.equal(document.getTitle(),'Chứng nhận CN-2026-01');
  assert.match(f.mime,/Content-Disposition: attachment/);assert.match(f.mime,/To: author@example.com/);
  const parts=f.mime.split('Content-Transfer-Encoding: base64\r\n\r\n');assert.ok(parts.length>=3);
  const attached=Buffer.from(parts[2].split('--seminar_')[0].replace(/\s/g,''),'base64');assert.deepEqual(attached,Buffer.from(f.pdf));
  const patch=f.calls.find(c=>c.url.includes('post_seminar_jobs') && c.options.method==='PATCH');assert.equal(JSON.parse(patch.options.body).status,'sent');
});
test('certificate PDF embeds the transparent seal when configured',async()=>{
  const f=fixture();
  const response=await createPostSeminarHandler(config,async()=>font,f.fetcher,async()=>seal)(request());
  assert.deepEqual(await response.json(),{sent:1,failed:0});
  const document=await PDFDocument.load(f.pdf);
  assert.ok(document.getPage(0).node.Resources().get(require('pdf-lib').PDFName.of('XObject')));
});

test('survey email links to the exact session and contains no PDF',async()=>{
  const f=fixture({kind:'survey'});await createPostSeminarHandler(config,async()=>{throw new Error('No PDF for survey');},f.fetcher)(request());
  assert.doesNotMatch(f.mime,/Content-Disposition: attachment/);
  const encodedBody=f.mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('--seminar_')[0].replace(/\s/g,'');
  assert.match(Buffer.from(encodedBody,'base64').toString('utf8'),/https:\/\/conference.example\/app\?session=session-1/);
});
test('Gmail failure requires reconciliation and never automatically retries delivery',async()=>{
  const f=fixture({delivery:500});const response=await createPostSeminarHandler(config,async()=>font,f.fetcher)(request());
  assert.deepEqual(await response.json(),{sent:0,failed:1});
  const patch=f.calls.find(c=>c.url.includes('post_seminar_jobs') && c.options.method==='PATCH');assert.equal(JSON.parse(patch.options.body).status,'uncertain');assert.doesNotMatch(patch.options.body,/private-test-key|test-access|refresh/);
});


test('another attempt holding the delivery marker prevents sending',async()=>{
 const f=fixture({kind:'survey',reservation:false});
 await createPostSeminarHandler(config,async()=>font,f.fetcher)(request());
 assert.equal(f.calls.filter(c=>c.url.includes('/messages/send')).length,0);
});
test('successful Gmail delivery with lost database acknowledgement requires reconciliation',async()=>{
 const f=fixture({kind:'survey',lostAcknowledgement:true});
 const response=await createPostSeminarHandler(config,async()=>font,f.fetcher)(request());
 assert.deepEqual(await response.json(),{sent:0,failed:1});
 assert.equal(f.calls.filter(c=>c.url.includes('/messages/send')).length,1);
 const patches=f.calls.filter(c=>c.url.includes('/post_seminar_jobs') && c.options.method==='PATCH');
 assert.equal(JSON.parse(patches.at(-1).options.body).status,'uncertain');
});
