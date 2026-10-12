import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const source=await readFile('.env','utf8');
const env=Object.fromEntries(source.split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
let accounts;
try{accounts=JSON.parse((await readFile('.local/live-test-accounts.json','utf8')).replace(/^\uFEFF/,''));}
catch{console.error('Chưa có tài khoản thử. Chạy scripts/configure-live-test.ps1 trên máy.');process.exit(1);}
for(const role of ['organizer','author','reviewer','participant']){
 const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
 try{
  const {data,error}=await client.auth.signInWithPassword(accounts[role]);
  if(error || !data.user)throw new Error('LOGIN');
  const profile=await client.from('profiles').select('id,role').eq('id',data.user.id).single();
  if(profile.error || profile.data.role!==role)throw new Error('ROLE');
  const certs=await client.from('certificates').select('id,user_id,conference_id').limit(100);
  if(certs.error)throw new Error('CERTIFICATE_READ');
  const managed=await client.rpc('managed_conferences');
  if(managed.error)throw new Error('MANAGED_SCOPE');
  const managedIds=new Set((managed.data ?? []).map(c=>c.id));
  if(certs.data.some(c=>c.user_id!==data.user.id && !managedIds.has(c.conference_id)))throw new Error('CERTIFICATE_SCOPE');
  const jobs=await client.from('upload_cleanup_jobs').select('bucket_id').limit(1);
  if(!jobs.error && jobs.data.length)throw new Error('SERVER_JOB_SCOPE');
  console.log(role+': đăng nhập, vai trò và phạm vi đọc chứng nhận đạt');
 }catch(error){console.error(role+': không đạt ('+(error.message ?? 'NETWORK')+'). Không in thông tin đăng nhập.');process.exitCode=1;}
 finally{await client.auth.signOut({scope:'local'}).catch(()=>{});}
}
console.log('Kiểm tra chỉ đọc; chưa xác nhận quy trình ghi dữ liệu hoặc tranh chấp đồng thời.');
