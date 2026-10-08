import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('speaker documents, private downloads, session surveys and automatic certificates',async(t)=>{
  const db=new PGlite();t.after(()=>db.close());
  const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
  await db.exec(await read('./local_bootstrap.sql'));
  await db.exec((await read('../migrations/initialize_production.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  await db.exec(await read('../migrations/conference_updates.sql'));
  await db.exec(await read('../migrations/20260927_paper_status_consistency.sql'));
  await db.exec(await read('../migrations/20261008_complete_workflows.sql'));
  const migration=await read('../migrations/20261008_seminar_experience.sql');await db.exec(migration);await db.exec(migration);
  const organizer='a0000000-0000-0000-0000-000000000001',speaker='a0000000-0000-0000-0000-000000000002',attendee='a0000000-0000-0000-0000-000000000003',outsider='a0000000-0000-0000-0000-000000000004';
  const conf='b0000000-0000-0000-0000-000000000001',other='b0000000-0000-0000-0000-000000000002',session='c0000000-0000-0000-0000-000000000001',parallel='c0000000-0000-0000-0000-000000000002';
  await db.exec(`INSERT INTO auth.users(id) VALUES('${organizer}'),('${speaker}'),('${attendee}'),('${outsider}');
    UPDATE profiles SET role='organizer' WHERE id='${organizer}';UPDATE profiles SET role='author' WHERE id='${speaker}';
    INSERT INTO conferences(id,title,start_date,end_date,status,organizer_id,auto_certificates,auto_surveys) VALUES
    ('${conf}','Experience',now()-interval '1 day',now()+interval '1 day','open','${organizer}',true,true),
    ('${other}','Other',now()-interval '1 day',now()+interval '1 day','open','${organizer}',false,false);
    INSERT INTO sessions(id,conference_id,title,start_time,end_time,speaker_id) VALUES('${session}','${conf}','Report',now()-interval '10 minutes',now()+interval '50 minutes','${speaker}'),('${parallel}','${conf}','Parallel',now()-interval '10 minutes',now()+interval '50 minutes',NULL);
    INSERT INTO participants(conference_id,user_id,attended) VALUES('${conf}','${attendee}',true),('${conf}','${speaker}',true);
    INSERT INTO storage.objects(bucket_id,name,owner) VALUES('conference-resources','${speaker}/${conf}/slides.pdf','${speaker}');`);
  const asUser=async(id)=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);if(id)await db.exec('SET ROLE authenticated');};
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  let resource,code,parallelCode;
  await t.test('speaker upload deadline is enforced and other authors cannot upload',async()=>{
    await asUser(speaker);assert.equal(await scalar('SELECT can_upload_session_documents($1)',[session]),false);
    await asUser(organizer);await db.query("UPDATE sessions SET resource_deadline=now()+interval '1 hour' WHERE id=$1",[session]);
    await asUser(outsider);assert.equal(await scalar('SELECT can_upload_session_documents($1)',[session]),false);
    await asUser(speaker);
    resource=await scalar("INSERT INTO conference_resources(conference_id,session_id,uploader_id,title,kind,file_path) VALUES($1,$2,$3,'Slides','slides',$4) RETURNING id",[conf,session,speaker,`${speaker}/${conf}/slides.pdf`]);
    assert.equal(await scalar('SELECT version_number FROM conference_resources WHERE id=$1',[resource]),1);
    await assert.rejects(db.query("INSERT INTO conference_resources(conference_id,session_id,uploader_id,title,kind,file_path) VALUES($1,$2,$3,'Wrong','slides',$4)",[other,session,speaker,`${speaker}/${conf}/slides.pdf`]));
  });
  await t.test('checked-in download permissions apply to storage and update atomically',async()=>{
    await asUser(attendee);assert.equal(await scalar('SELECT can_download_resource($1)',[resource]),true);
    assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='conference-resources'"),1);
    await asUser(outsider);assert.equal(await scalar('SELECT can_download_resource($1)',[resource]),false);
    assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='conference-resources'"),0);
    await asUser(organizer);await db.query("UPDATE conference_resources SET visibility='public' WHERE id=$1",[resource]);
    await asUser(outsider);assert.equal(await scalar('SELECT can_download_resource($1)',[resource]),true);
    await asUser(organizer);await db.query("UPDATE conference_resources SET visibility='checked_in' WHERE id=$1",[resource]);
  });
  await t.test('session codes are private and attendees cannot forge timestamps or enter parallel rooms',async()=>{
    await asUser(organizer);code=await scalar('SELECT create_session_checkin_code($1)',[session]);parallelCode=await scalar('SELECT create_session_checkin_code($1)',[parallel]);
    await asUser(attendee);assert.equal(await scalar('SELECT count(*)::int FROM session_checkin_codes'),0);
    await assert.rejects(db.query('SELECT record_session_attendance($1,$2,false)',[session,'invalid']));
    await db.query('SELECT record_session_attendance($1,$2,false)',[session,code]);
    await assert.rejects(db.query('INSERT INTO session_attendance(session_id,user_id) VALUES($1,$2)',[parallel,attendee]));
    await assert.rejects(db.query('SELECT record_session_attendance($1,$2,false)',[parallel,parallelCode]));
    await db.query('SELECT record_session_attendance($1,$2,true)',[session,code]);
    await asUser(outsider);await assert.rejects(db.query('SELECT record_session_attendance($1,$2,false)',[session,code]));
  });
  await t.test('feedback needs actual session attendance and a finished session',async()=>{
    await asUser(attendee);await assert.rejects(db.query('INSERT INTO session_feedback(session_id,user_id,speaker_rating,content_rating) VALUES($1,$2,5,4)',[session,attendee]));
    await asUser(null);await db.query("UPDATE sessions SET end_time=now()-interval '1 minute' WHERE id=$1",[session]);
    await asUser(attendee);await db.query('INSERT INTO session_feedback(session_id,user_id,speaker_rating,content_rating) VALUES($1,$2,5,4)',[session,attendee]);
    await assert.rejects(db.query('INSERT INTO session_feedback(session_id,user_id,speaker_rating,content_rating) VALUES($1,$2,5,4)',[session,attendee]));
    await asUser(outsider);assert.equal(await scalar('SELECT count(*)::int FROM session_feedback'),0);await assert.rejects(db.query('SELECT * FROM session_feedback_summary($1)',[session]));
    await asUser(organizer);const summary=(await db.query('SELECT * FROM session_feedback_summary($1)',[session])).rows[0];assert.equal(Number(summary.responses),1);assert.equal(Number(summary.speaker_average),5);
  });
  await t.test('measured hours clip to session times and merge overlapping attendance',async()=>{
    await asUser(null);await db.exec('ALTER TABLE sessions DISABLE TRIGGER validate_session_links;');
    await db.query("UPDATE sessions SET start_time='2026-01-01T09:00Z',end_time='2026-01-01T10:00Z' WHERE id=$1",[session]);
    await db.query("UPDATE sessions SET start_time='2026-01-01T09:30Z',end_time='2026-01-01T10:30Z' WHERE id=$1",[parallel]);
    await db.query("UPDATE session_attendance SET checked_in_at='2026-01-01T08:55Z',checked_out_at='2026-01-01T10:15Z' WHERE session_id=$1 AND user_id=$2",[session,attendee]);
    await db.query("INSERT INTO session_attendance(session_id,user_id,checked_in_at,checked_out_at) VALUES($1,$2,'2026-01-01T09:30Z','2026-01-01T10:30Z')",[parallel,attendee]);
    assert.equal(await scalar('SELECT measured_attendance_minutes($1,$2)',[conf,attendee]),90);
    assert.equal(await scalar('SELECT measured_attendance_minutes($1,$2)',[conf,speaker]),0);
    await db.exec('ALTER TABLE sessions ENABLE TRIGGER validate_session_links;');
    await db.query("UPDATE conferences SET start_date='2026-01-01T08:00Z',end_date='2026-01-01T11:00Z',status='completed' WHERE id=$1",[conf]);
  });
  await t.test('automatic jobs are idempotent, skipped for existing feedback and restricted to server',async()=>{
    await asUser(organizer);await assert.rejects(db.query('SELECT enqueue_post_seminar_jobs()'));
    await asUser(null);await db.exec('SELECT enqueue_post_seminar_jobs(); SELECT enqueue_post_seminar_jobs();');
    assert.equal(await scalar("SELECT count(*)::int FROM certificates WHERE conference_id=$1 AND certificate_type='attendance'",[conf]),2);
    assert.equal(await scalar("SELECT attendance_minutes FROM certificates WHERE conference_id=$1 AND user_id=$2",[conf,attendee]),90);
    assert.equal(await scalar("SELECT count(*)::int FROM post_seminar_jobs WHERE kind='certificate'"),2);
    assert.equal(await scalar("SELECT count(*)::int FROM post_seminar_jobs WHERE kind='survey'"),1);
    const first=(await db.query('SELECT * FROM claim_post_seminar_jobs(1)')).rows;assert.equal(first.length,1);
    const second=(await db.query('SELECT * FROM claim_post_seminar_jobs(25)')).rows;assert.equal(second.length,2);assert.ok(!second.some((job)=>job.id===first[0].id));
  });
});
