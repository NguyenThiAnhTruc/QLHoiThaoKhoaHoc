import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {PDFDocument} from 'pdf-lib';

// Uses ordinary test accounts and application RLS. No administrative key or mail worker.
const source=await readFile('.env','utf8');
const env=Object.fromEntries(source.split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
let accounts;
try{accounts=JSON.parse((await readFile('.local/live-test-accounts.json','utf8')).replace(/^\uFEFF/,''));}
catch{console.error('Chưa có tài khoản thử. Chạy scripts/configure-live-test.ps1.');process.exit(1);}
const clients={},users={};
const report={started_at:new Date().toISOString(),conference_id:crypto.randomUUID(),paper_id:crypto.randomUUID(),steps:[],files:[],status:'preflight'};
const reportPath=`.local/live-workflow-${report.conference_id}.json`;
const checkpoint=async()=>{await mkdir('.local',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));};
async function checked(query){const result=await query;if(result.error){const error=new Error('REQUEST_FAILED');error.code=result.error.code ?? 'NETWORK';throw error;}return result.data;}
async function step(name,work){
 report.steps.push({name,status:'running'});await checkpoint();
 try{await work();report.steps.at(-1).status='passed';console.log('PASS: '+name);}
 catch(error){report.steps.at(-1).status='failed';report.steps.at(-1).code=error.code ?? (error instanceof assert.AssertionError?'ASSERTION':'NETWORK_OR_CONFIGURATION');throw error;}
 finally{await checkpoint();}
}
const iso=hours=>new Date(Date.now()+hours*3600000).toISOString();
try{
 for(const role of ['organizer','author','reviewer','participant']){
  const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
  clients[role]=client;
  const signed=await checked(client.auth.signInWithPassword(accounts[role]));
  if(!signed.user)throw new Error('LOGIN');users[role]=signed.user.id;
  const profile=await checked(client.from('profiles').select('role').eq('id',signed.user.id).single());
  assert.equal(profile.role,role);
 }
 assert.equal(new Set(Object.values(users)).size,4);
 const {organizer,author,reviewer,participant}=clients;
 // Missing release migrations stop the run before any conference/file is created.
 await checked(organizer.from('certificates').select('verification_token,revoked_at').limit(0));
 await checked(reviewer.from('reviews').select('revision').limit(0));
 report.status='running';await checkpoint();
 const conf=report.conference_id,paper=report.paper_id;
 await step('Tạo hội thảo thử, tắt email tự động',async()=>{
  await checked(organizer.from('conferences').insert({id:conf,title:'[TEST] Workflow '+conf.slice(0,8),description:'Disposable release validation fixture. No real event.',organizer_id:users.organizer,start_date:iso(48),end_date:iso(72),status:'open',max_participants:1,field:'Công nghệ thông tin',topics:['Kỹ thuật phần mềm'],review_enabled:true,blind_review:false,require_accepted_paper:false,auto_certificates:false,auto_surveys:false,is_featured:false,is_schedule_public:false}).select('id').single());
 });
 await step('Hai tài khoản tranh chấp chỗ đăng ký cuối',async()=>{
  const results=await Promise.all(['author','participant'].map(role=>clients[role].from('participants').insert({id:crypto.randomUUID(),conference_id:conf,user_id:users[role]}).select('id')));
  assert.equal(results.filter(r=>!r.error && r.data?.length===1).length,1);
  const rows=await checked(organizer.from('participants').select('id,user_id').eq('conference_id',conf));assert.equal(rows.length,1);
  await checked(organizer.from('conferences').update({max_participants:2}).eq('id',conf).select('id').single());
  const loser=rows[0].user_id===users.author?'participant':'author';
  await checked(clients[loser].from('participants').insert({id:crypto.randomUUID(),conference_id:conf,user_id:users[loser]}).select('id').single());
 });
 let submission;
 await step('Tải PDF thật và nộp bài',async()=>{
  const doc=await PDFDocument.create();doc.addPage().drawText('ConfManager release test PDF');const bytes=await doc.save();
  const path=`${users.author}/${paper}/release-test.pdf`;
  report.files.push({bucket:'paper-files',path});await checkpoint();
  await checked(author.storage.from('paper-files').upload(path,bytes,{contentType:'application/pdf',upsert:false}));
  submission={target_paper_id:paper,target_conference_id:conf,paper_title:'[TEST] Release workflow paper',paper_abstract:'Submission for isolated release validation.',paper_keywords:'testing, release',paper_file:path,author_ids:[],version_notes:'Initial PDF',expected_updated_at:null,topic_ids:[],participation:{[users.author]:'participating'},problem:'Verify complete workflow',goals:'Check permissions and idempotency',group_name:'Test accounts',main_author_id:users.author};
  assert.equal(await checked(author.rpc('save_complete_paper_submission',submission)),paper);
 });
 await step('Thử lại sau giả lập mất phản hồi, không tạo phiên bản trùng',async()=>{
  // The first committed result is deliberately ignored before retrying the same UUID.
  await checked(author.rpc('save_complete_paper_submission',submission));
  const versions=await checked(author.from('paper_versions').select('id').eq('paper_id',paper));assert.equal(versions.length,1);
 });
 await step('Chặn người tham dự đọc bài chưa công bố và tác giả tự duyệt',async()=>{
  const rows=await checked(participant.rpc('read_papers').eq('id',paper));assert.equal(rows.length,0);
  const attempted=await author.from('papers').update({status:'accepted'}).eq('id',paper).select('id');
  assert.ok(attempted.error || attempted.data?.length===0);
 });
 let review;
 await step('Phân công và nhận lời phản biện',async()=>{
  review=await checked(organizer.from('reviews').insert({id:crypto.randomUUID(),paper_id:paper,reviewer_id:users.reviewer,status:'assigned'}).select('id').single());
  await checked(reviewer.rpc('respond_review_assignment',{target_review_id:review.id,accept_assignment:true}));
 });
 await step('Lưu phản biện và từ chối bản chỉnh sửa cũ',async()=>{
  const snapshot=await checked(reviewer.from('reviews').select('revision,status').eq('id',review.id).single());
  await checked(reviewer.from('reviews').update({score:8,comments:'Release validation draft'}).eq('id',review.id).eq('revision',snapshot.revision).select('id').single());
  const stale=await checked(reviewer.from('reviews').update({score:1}).eq('id',review.id).eq('revision',snapshot.revision).select('id'));assert.equal(stale.length,0);
  await checked(reviewer.from('reviews').update({status:'completed',score:8,comments:'Completed review for isolated release test.',recommendation:'accept'}).eq('id',review.id).select('id').single());
 });
 await step('Ban tổ chức quyết định bài, chặn quyết định từ bản cũ',async()=>{
  let snapshot=await checked(organizer.from('papers').select('status,updated_at').eq('id',paper).single());
  if(snapshot.status==='submitted'){
   await checked(organizer.from('papers').update({status:'under_review'}).eq('id',paper).eq('updated_at',snapshot.updated_at).select('id').single());
   snapshot=await checked(organizer.from('papers').select('status,updated_at').eq('id',paper).single());
  }
  await checked(organizer.from('papers').update({status:'accepted'}).eq('id',paper).eq('updated_at',snapshot.updated_at).select('id').single());
  const stale=await checked(organizer.from('papers').update({status:'rejected'}).eq('id',paper).eq('updated_at',snapshot.updated_at).select('id'));assert.equal(stale.length,0);
 });
 await step('Điểm danh hai người, quét trùng không ghi lại thời gian',async()=>{
  const attendance=await checked(organizer.rpc('create_attendance_session',{target_conference_id:conf,session_starts_at:iso(-1),session_ends_at:iso(1)}));
  const code=(Array.isArray(attendance)?attendance[0]:attendance).code;
  for(const role of ['author','participant'])await checked(clients[role].rpc('check_in_self',{attendance_code_input:code}));
  const before=await checked(participant.from('participants').select('checked_in_at').eq('conference_id',conf).eq('user_id',users.participant).single());
  await Promise.all([checked(participant.rpc('check_in_self',{attendance_code_input:code})),checked(participant.rpc('check_in_self',{attendance_code_input:code}))]);
  const after=await checked(participant.from('participants').select('checked_in_at').eq('conference_id',conf).eq('user_id',users.participant).single());assert.equal(after.checked_in_at,before.checked_in_at);
 });
 await step('Kết thúc hội thảo thử và ghi nhận phiên báo cáo',async()=>{
  await checked(organizer.from('conferences').update({start_date:iso(-48),end_date:iso(-1)}).eq('id',conf).select('id').single());
  await checked(organizer.from('sessions').insert({id:crypto.randomUUID(),conference_id:conf,title:'[TEST] Completed presentation',start_time:iso(-3),end_time:iso(-2),room:'TEST',speaker_id:users.author,paper_id:paper}).select('id').single());
  await checked(organizer.from('conferences').update({status:'completed'}).eq('id',conf).select('id').single());
 });
 await step('Cấp chứng nhận đồng thời và thử lại không cấp trùng',async()=>{
  const args={conf_id:conf,cert_type:'attendance',recipient_ids:[users.author,users.participant]};
  const issued=await Promise.all([checked(organizer.rpc('issue_certificates_bulk',args)),checked(organizer.rpc('issue_certificates_bulk',args))]);assert.equal(issued.reduce((a,b)=>a+b,0),2);
  assert.equal(await checked(organizer.rpc('issue_certificates_bulk',args)),0);
  assert.equal(await checked(organizer.rpc('issue_paper_certificates',{conf_id:conf,target_paper_id:paper,recipient_ids:[users.author]})),1);
 });
 await step('Phạm vi chứng nhận và tra cứu công khai',async()=>{
  const own=await checked(participant.from('certificates').select('user_id,verification_token').eq('conference_id',conf));assert.equal(own.length,1);assert.equal(own[0].user_id,users.participant);
  const publicClient=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
  const verified=await checked(publicClient.rpc('verify_certificate',{token:own[0].verification_token}));assert.equal(verified.length,1);assert.equal(verified[0].revoked_at,null);assert.equal('recipient_name' in verified[0],false);
 });
 report.status='passed';report.completed_at=new Date().toISOString();await checkpoint();
 console.log('Luồng Supabase thật đạt. Dữ liệu thử giữ lại để đối chiếu: '+reportPath);
}catch(error){
 report.status=report.status==='preflight'?'blocked':'failed';report.failure_code=error.code ?? 'ASSERTION_OR_CONFIGURATION';await checkpoint();
 console.error('Chưa hoàn tất kiểm thử thật. Xem bước dừng và ID dữ liệu thử tại '+reportPath+'. Không tự chạy lại để tạo thêm dữ liệu.');process.exitCode=1;
}finally{await Promise.all(Object.values(clients).map(c=>c.auth.signOut({scope:'local'}).catch(()=>{})));}
