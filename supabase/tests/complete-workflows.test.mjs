import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('complete conference workflows enforce ownership, atomic writes and per-paper certificates', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');
  await db.exec(await read('./local_bootstrap.sql'));
  await db.exec((await read('../migrations/initialize_production.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM auth.users')).rows[0].count,0);
  await db.exec(await read('../migrations/conference_updates.sql'));
  await db.exec(await read('../migrations/20260927_paper_status_consistency.sql'));
  const migration = await read('../migrations/20261008_complete_workflows.sql');
  await db.exec(migration); await db.exec(migration);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM auth.users')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM conferences')).rows[0].count,0);
  const owner='f0000000-0000-0000-0000-000000000001';
  const coauthor='f0000000-0000-0000-0000-000000000002';
  const organizer='f0000000-0000-0000-0000-000000000003';
  const outsider='f0000000-0000-0000-0000-000000000004';
  const conf='f1000000-0000-0000-0000-000000000001';
  const other='f1000000-0000-0000-0000-000000000002';
  const paper='f2000000-0000-0000-0000-000000000001';
  const second='f2000000-0000-0000-0000-000000000002';
  const topic='f3000000-0000-0000-0000-000000000001';
  const wrongTopic='f3000000-0000-0000-0000-000000000002';
  const parent='f4000000-0000-0000-0000-000000000001';
  await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    ('${owner}','owner@test.local','{"role":"author","full_name":"Owner"}'),
    ('${coauthor}','coauthor@test.local','{"role":"author","full_name":"Coauthor"}'),
    ('${organizer}','organizer@test.local','{"role":"organizer","full_name":"Organizer"}'),
    ('${outsider}','outsider@test.local','{"role":"author","full_name":"Outsider"}');
    UPDATE profiles SET role='author' WHERE id IN ('${owner}','${coauthor}','${outsider}');
    UPDATE profiles SET role='organizer' WHERE id='${organizer}';
    INSERT INTO public.conferences(id,title,start_date,end_date,status,organizer_id,review_enabled)
    VALUES('${conf}','Complete workflow',now()+interval '1 day',now()+interval '2 days','open','${organizer}',false),
    ('${other}','Other',now()+interval '1 day',now()+interval '2 days','open','${organizer}',true);
    INSERT INTO public.conference_topics(id,conference_id,name) VALUES('${topic}','${conf}','Valid'),('${wrongTopic}','${other}','Wrong');
    INSERT INTO storage.objects(bucket_id,name,owner) VALUES('paper-files','${owner}/paper.pdf','${owner}');`);
  const asUser = async (id) => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id ?? '']);
    if (id) await db.exec('SET ROLE authenticated');
  };
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const save=(id=paper, opts={})=>db.query('SELECT public.save_complete_paper_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
    [id,conf,'Research','Summary',opts.keywords ?? 'science',`${owner}/paper.pdf`,[coauthor],'',opts.expected ?? null,opts.topics ?? [topic],opts.participation ?? {},'Problem','Objectives','Research group',owner]);
  await asUser(owner);
  await t.test('saves paper topics, authors and research information in one transaction',async()=>{
    await save();
    assert.equal(await scalar('SELECT count(*)::int FROM paper_topics WHERE paper_id=$1',[paper]),1);
    assert.equal(await scalar('SELECT objectives FROM papers WHERE id=$1',[paper]),'Objectives');
    assert.equal(await scalar('SELECT corresponding_author_id FROM papers WHERE id=$1',[paper]),owner);
  });
  await t.test('rejects wrong-conference topics and empty keywords',async()=>{
    await assert.rejects(save(second,{topics:[wrongTopic]}));
    await assert.rejects(save(second,{keywords:''}));
    assert.equal(await scalar('SELECT count(*)::int FROM papers WHERE id=$1',[second]),0);
  });
  await t.test('invalid participation rolls back paper, version and topic writes',async()=>{
    await assert.rejects(save(second,{participation:{[coauthor]:'invalid'}}));
    assert.equal(await scalar('SELECT count(*)::int FROM papers WHERE id=$1',[second]),0);
    assert.equal(await scalar('SELECT count(*)::int FROM paper_versions WHERE paper_id=$1',[second]),0);
    await save(second);
  });
  await t.test('organizer can update author participation and rejected save preserves existing data',async()=>{
    await asUser(organizer);
    const expected=await scalar('SELECT updated_at FROM papers WHERE id=$1',[paper]);
    await save(paper,{expected,participation:{[coauthor]:'not_participating'}});
    assert.equal(await scalar('SELECT participation_status FROM paper_authors WHERE paper_id=$1 AND user_id=$2',[paper,coauthor]),'not_participating');
    const updated=await scalar('SELECT updated_at FROM papers WHERE id=$1',[paper]);
    await assert.rejects(save(paper,{expected:updated,participation:{[coauthor]:'invalid'}}));
    assert.equal(await scalar('SELECT participation_status FROM paper_authors WHERE paper_id=$1 AND user_id=$2',[paper,coauthor]),'not_participating');
    await asUser(owner);
  });
  await t.test('authors cannot decide status but organizer can skip disabled review',async()=>{
    await assert.rejects(db.query("UPDATE papers SET status='accepted' WHERE id=$1",[paper]));
    await asUser(organizer);
    await db.query("UPDATE papers SET status='accepted' WHERE id IN ($1,$2)",[paper,second]);
    await assert.rejects(db.query('INSERT INTO reviews(paper_id,reviewer_id) VALUES($1,$2)',[paper,outsider]));
  });
  await t.test('accepted-paper registration applies to authors only when configured',async()=>{
    await db.query('UPDATE conferences SET require_accepted_paper=true WHERE id=$1',[conf]);
    await asUser(outsider);
    assert.equal(await scalar('SELECT can_register_for_conference($1)',[conf]),false);
    await asUser(owner);
    assert.equal(await scalar('SELECT can_register_for_conference($1)',[conf]),true);
    await asUser(coauthor);
    // The second paper still has participating coauthors, so registration is allowed.
    assert.equal(await scalar('SELECT can_register_for_conference($1)',[conf]),true);
    await asUser(organizer);
  });
  await t.test('parallel reports stay inside their parent and use accepted conference papers',async()=>{
    await db.query(`INSERT INTO sessions(id,conference_id,title,start_time,end_time) SELECT $1,id,'Parent',start_date,end_date FROM conferences WHERE id=$2`,[parent,conf]);
    await db.query(`INSERT INTO sessions(conference_id,title,start_time,end_time,paper_id,parent_session_id) VALUES($1,'Report',now()+interval '25 hours',now()+interval '26 hours',$2,$3)`,[conf,paper,parent]);
    await assert.rejects(db.query(`INSERT INTO sessions(conference_id,title,start_time,end_time,parent_session_id) VALUES($1,'Wrong',now()+interval '25 hours',now()+interval '26 hours',$2)`,[other,parent]));
    await assert.rejects(db.query(`UPDATE sessions SET end_time=now()+interval '25 hours' WHERE id=$1`,[parent]));
  });
  await asUser(null);
  // Move the conference and its presentation slots into the past for issuance.
  await db.exec('ALTER TABLE sessions DISABLE TRIGGER validate_session_links;');
  await db.query("UPDATE conferences SET start_date=now()-interval '2 days',end_date=now()-interval '1 day',status='completed' WHERE id=$1",[conf]);
  await db.query("UPDATE sessions SET start_time=now()-interval '2 days',end_time=now()-interval '1 day' WHERE conference_id=$1",[conf]);
  await db.query(`INSERT INTO sessions(conference_id,title,start_time,end_time,paper_id) VALUES($1,'Second report',now()-interval '2 days',now()-interval '1 day',$2)`,[conf,second]);
  await db.exec('ALTER TABLE sessions ENABLE TRIGGER validate_session_links;');
  await db.query('INSERT INTO participants(conference_id,user_id,attended) VALUES($1,$2,true),($1,$3,true)',[conf,owner,coauthor]);
  await asUser(organizer);
  await t.test('issues two certificates to one author for two papers and retries safely',async()=>{
    assert.equal(await scalar('SELECT issue_paper_certificates($1,$2,$3)',[conf,paper,[owner]]),1);
    assert.equal(await scalar('SELECT issue_paper_certificates($1,$2,$3)',[conf,second,[owner]]),1);
    assert.equal(await scalar('SELECT issue_paper_certificates($1,$2,$3)',[conf,paper,[owner]]),0);
    assert.equal(await scalar('SELECT count(*)::int FROM certificates WHERE user_id=$1',[owner]),2);
  });
  await t.test('rejects unrelated recipients and unauthorized issuers',async()=>{
    assert.equal((await db.query('SELECT * FROM paper_certificate_recipients($1,$2)',[conf,paper])).rows.some((row)=>row.user_id===coauthor),false);
    await assert.rejects(db.query('SELECT issue_paper_certificates($1,$2,$3)',[conf,paper,[coauthor,outsider]]));
    assert.equal(await scalar('SELECT count(*)::int FROM certificates WHERE user_id=$1',[coauthor]),0);
    await asUser(outsider);
    await assert.rejects(db.query('SELECT issue_paper_certificates($1,$2,$3)',[conf,paper,[owner]]));
    await asUser(organizer);
  });
  await t.test('receipt validation rejects missing proof and cross-conference funds',async()=>{
    const fund=await scalar("INSERT INTO conference_funds(conference_id,name,amount,created_by) VALUES($1,'Fee',100,$2) RETURNING id",[conf,organizer]);
    await asUser(owner);
    await assert.rejects(db.query('INSERT INTO fee_payments(fund_id,conference_id,payer_id,amount) VALUES($1,$2,$3,100)',[fund,conf,owner]));
    await assert.rejects(db.query("INSERT INTO fee_payments(fund_id,conference_id,payer_id,amount,proof_url) VALUES($1,$2,$3,100,'https://example.com/proof.pdf')",[fund,other,owner]));
    await db.query("INSERT INTO fee_payments(fund_id,conference_id,payer_id,amount,proof_url) VALUES($1,$2,$3,100,'https://example.com/proof.pdf')",[fund,conf,owner]);
    await asUser(outsider);
    assert.equal(await scalar('SELECT count(*)::int FROM fee_payments WHERE conference_id=$1',[conf]),0);
  });
  await t.test('private receipt storage is visible only to payer and conference organizer',async()=>{
    const path=`${owner}/${other}/proof.pdf`;
    await asUser(owner);
    await db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('fee-proofs',$1,$2)",[path,owner]);
    await asUser(outsider);
    assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='fee-proofs' AND name=$1",[path]),0);
    await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('fee-proofs',$1,$2)",[`${owner}/${other}/forged.pdf`,outsider]));
    await asUser(organizer);
    assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='fee-proofs' AND name=$1",[path]),1);
  });
  await t.test('new research fields cannot bypass submission deadlines through direct API updates',async()=>{
    await asUser(null);
    await db.query("UPDATE conferences SET submission_deadline=now()-interval '1 day',camera_ready_deadline=now()-interval '1 day' WHERE id=$1",[conf]);
    await asUser(owner);
    await assert.rejects(db.query("UPDATE papers SET objectives='Changed after deadline' WHERE id=$1",[paper]));
  });
});
