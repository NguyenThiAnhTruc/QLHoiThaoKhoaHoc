import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {transform} from 'esbuild';
const {code}=await transform(await readFile('supabase/functions/upload-cleanup/handler.ts','utf8'),{loader:'ts',format:'esm'});
const {createUploadCleanupHandler}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const config={url:'https://example.test',key:'server-key',secret:'cleanup-secret'};
const request=()=>new Request('https://example.test',{method:'POST',headers:{'X-Job-Secret':config.secret}});
test('cleanup rejects unauthorized requests without contacting storage',async()=>{
 const handler=createUploadCleanupHandler(config,async()=>{throw new Error('Network forbidden');});
 assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401);
 assert.equal((await handler(new Request('https://example.test'))).status,405);
});
test('cleanup removes only reserved paths through Storage API and then acknowledges',async()=>{
 const calls=[];
 const handler=createUploadCleanupHandler(config,async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/rpc/'))return Response.json([{bucket_id:'fee-proofs',file_path:'user/conf/old.pdf'}]);
  return new Response(null,{status:204});
 });
 assert.deepEqual(await (await handler(request())).json(),{cleaned:1,failed:0});
 assert.equal(calls[1].options.method,'DELETE');
 assert.deepEqual(JSON.parse(calls[1].options.body),{prefixes:['user/conf/old.pdf']});
 assert.equal(calls[2].options.method,'PATCH');
});
test('failed storage removal keeps reservation pending for the next run',async()=>{
 let acknowledged=false;
 const handler=createUploadCleanupHandler(config,async(url)=>{
  if(url.includes('/rpc/'))return Response.json([{bucket_id:'conference-resources',file_path:'old.pdf'}]);
  if(url.includes('/storage/'))return new Response(null,{status:503});
  acknowledged=true;return new Response(null,{status:204});
 });
 assert.deepEqual(await (await handler(request())).json(),{cleaned:0,failed:1});
 assert.equal(acknowledged,false);
});
