import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('existing database upgrade is repeatable and preserves conference data',async(t)=>{
  const db=new PGlite();t.after(()=>db.close());
  const read=(p)=>readFile(new URL(p,import.meta.url),'utf8');
  await db.exec(await read('./local_bootstrap.sql'));
  await db.exec((await read('../migrations/initialize_production.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  const owner='a0000000-0000-0000-0000-000000000001',conf='b0000000-0000-0000-0000-000000000001';
  await db.query('INSERT INTO auth.users(id) VALUES($1)',[owner]);
  await db.query("UPDATE profiles SET role='organizer' WHERE id=$1",[owner]);
  await db.query("INSERT INTO conferences(id,title,start_date,end_date,status,organizer_id) VALUES($1,'Keep existing conference',now()+interval '1 day',now()+interval '2 days','open',$2)",[conf,owner]);
  const before=(await db.query('SELECT id,title,start_date::text AS start_day,end_date::text AS end_day,organizer_id FROM conferences')).rows;
  const upgrade=await read('../migrations/upgrade_existing_database.sql');
  await db.exec(upgrade);
  assert.deepEqual((await db.query("SELECT id,title,(start_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS start_day,(end_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS end_day,organizer_id FROM conferences")).rows,before);
  const upgraded=(await db.query('SELECT id,title,start_date,end_date,organizer_id FROM conferences')).rows;
  await db.exec(upgrade);
  assert.deepEqual((await db.query('SELECT id,title,start_date,end_date,organizer_id FROM conferences')).rows,upgraded);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM auth.users')).rows[0].count,1);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const path=owner+'/'+conf+'/orphan.pdf';
  assert.equal((await db.query("SELECT can_delete_unattached_upload('conference-resources',$1) AS allowed",[path])).rows[0].allowed,true);
  assert.equal((await db.query("SELECT can_delete_unattached_upload('conference-resources','someone-else/file.pdf') AS allowed")).rows[0].allowed,false);
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('conference-resources',$1)",[path]);
  await db.query("INSERT INTO conference_resources(conference_id,uploader_id,title,kind,visibility,file_path) VALUES($1,$2,'Protected file','reading','public',$3)",[conf,owner,path]);
  assert.equal((await db.query("SELECT can_delete_unattached_upload('conference-resources',$1) AS allowed",[path])).rows[0].allowed,false);
  const old=owner+'/'+conf+'/abandoned.pdf',fresh=owner+'/'+conf+'/fresh.pdf';
  await db.query("UPDATE storage.objects SET created_at=now()-interval '2 days' WHERE name=$1",[path]);
  await db.query("INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('conference-resources',$1,now()-interval '2 days'),('fee-proofs',$2,now())",[old,fresh]);
  assert.deepEqual((await db.query('SELECT * FROM reserve_orphan_uploads(25)')).rows,[{bucket_id:'conference-resources',file_path:old}]);
  assert.deepEqual((await db.query('SELECT * FROM reserve_orphan_uploads(25)')).rows,[{bucket_id:'conference-resources',file_path:old}]);
  await assert.rejects(db.query("INSERT INTO conference_resources(conference_id,uploader_id,title,kind,visibility,file_path) VALUES($1,$2,'Late save','reading','public',$3)",[conf,owner,old]),/Upload expired/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM reserve_orphan_uploads(25)'),/permission denied/);
  await db.exec('RESET ROLE');
  await db.query('UPDATE upload_cleanup_jobs SET cleaned_at=now() WHERE file_path=$1',[old]);
  assert.deepEqual((await db.query('SELECT * FROM reserve_orphan_uploads(25)')).rows,[]);
  await db.exec('SELECT review_enabled,require_accepted_paper,auto_certificates FROM conferences; SELECT problem_statement,objectives,corresponding_author_id FROM papers; SELECT parent_session_id,tags,difficulty,resource_deadline FROM sessions; SELECT id FROM conference_resources; SELECT session_id FROM session_feedback; SELECT attendance_minutes,pdf_path FROM certificates;');
});

test('combined upgrade matches the versioned migrations',async()=>{
 const read=p=>readFile(new URL(p,import.meta.url),'utf8');
 const combined=await read('../migrations/upgrade_existing_database.sql');
 const incremental=await read('../migrations/20261011_local_improvements.sql');
 for(const name of ['20261011_certificate_verification.sql','20261011_review_revision.sql','20261011_audit_integrity.sql'])assert.ok(incremental.includes((await read('../migrations/'+name)).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'')),name+' in incremental upgrade');
 for(const name of ['conference_updates.sql','20260927_paper_status_consistency.sql','20260927_disable_blind_review.sql','20261008_complete_workflows.sql','20261008_seminar_experience.sql','20261009_certificate_consistency.sql','20261010_email_delivery_safety.sql','20261010_orphan_upload_cleanup.sql','20261011_certificate_verification.sql','20261011_review_revision.sql','20261011_audit_integrity.sql']){
  const source=(await read('../migrations/'+name)).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
  assert.ok(combined.includes(source),name+' is up to date in the deployment bundle');
 }
});
