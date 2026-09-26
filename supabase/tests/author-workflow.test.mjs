import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine with minimal stand-ins for Supabase-owned schemas.
// Application tables, functions, triggers and RLS are loaded from the real SQL.
test('author workflow database integration', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text, owner uuid, UNIQUE(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth, storage TO authenticated;
    GRANT ALL ON storage.objects TO authenticated;
  `);
  const baseline = await readFile(new URL('../migrations/conference_management_supabase.sql', import.meta.url), 'utf8');
  await db.exec(baseline.split('-- 21. DEMO ACCOUNTS')[0].replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  await db.exec(await readFile(new URL('../migrations/20260923_role_permissions.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../migrations/20260924_reporting.sql', import.meta.url), 'utf8'));
  const migration = await readFile(new URL('../migrations/20260925_author_workflow.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Re-applying the patch is safe.
  const owner = '10000000-0000-0000-0000-000000000001';
  const coauthor = '10000000-0000-0000-0000-000000000002';
  const reviewer = '10000000-0000-0000-0000-000000000003';
  const organizer = '10000000-0000-0000-0000-000000000004';
  const conference = '20000000-0000-0000-0000-000000000001';
  const paper = '30000000-0000-0000-0000-000000000001';
  const failedPaper = '30000000-0000-0000-0000-000000000002';
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${owner}'),('${coauthor}'),('${reviewer}'),('${organizer}');
    UPDATE public.profiles SET role = 'author'; UPDATE public.profiles SET role = 'organizer' WHERE id = '${organizer}';
    INSERT INTO public.conferences(id,title,start_date,end_date,status,organizer_id,submission_deadline,camera_ready_deadline)
    VALUES ('${conference}','Test conference',current_date+10,current_date+11,'open','${organizer}',now()+interval '1 day',now()+interval '2 days');
    INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('paper-files','${owner}/v1.pdf','${owner}');`);
  const asUser = async (id) => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
    if (id) await db.exec('SET ROLE authenticated');
  };
  const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0];
  const save = (opts = {}) => db.query(`SELECT public.save_paper_submission($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [opts.id ?? paper, conference, opts.title ?? 'Paper', opts.abstract ?? 'Abstract', '', opts.file ?? `${owner}/v1.pdf`, opts.authors ?? [coauthor], 'Revision notes', opts.expected ?? null]);
  await asUser(owner);
  await t.test('create metadata, authors and initial PDF version atomically', async () => {
    await save();
    assert.equal(await scalar('SELECT count(*)::int FROM public.paper_versions WHERE paper_id=$1',[paper]),1);
    assert.equal(await scalar('SELECT count(*)::int FROM public.paper_authors WHERE paper_id=$1',[paper]),1);
  });
  await t.test('retry create does not duplicate paper or version', async () => {
    await save();
    assert.equal(await scalar('SELECT count(*)::int FROM public.paper_versions WHERE paper_id=$1',[paper]),1);
  });
  await t.test('invalid coauthor rolls back all new records and notification', async () => {
    const before = await scalar('SELECT count(*)::int FROM public.notifications');
    await assert.rejects(save({id: failedPaper,authors:['99999999-0000-0000-0000-000000000000']}));
    assert.equal(await scalar('SELECT count(*)::int FROM public.papers WHERE id=$1',[failedPaper]),0);
    assert.equal(await scalar('SELECT count(*)::int FROM public.notifications'),before);
  });
  await t.test('reject incomplete submission', async () => { await assert.rejects(save({id:failedPaper,abstract:''}),/tóm tắt/); });
  let oldTimestamp;
  await t.test('URL revision creates version; metadata-only save does not', async () => {
    oldTimestamp = await scalar('SELECT updated_at::text FROM public.papers WHERE id=$1',[paper]);
    await save({file:'https://example.org/v2.pdf',expected:oldTimestamp});
    assert.equal(await scalar('SELECT current_version FROM public.papers WHERE id=$1',[paper]),2);
    const stamp = await scalar('SELECT updated_at::text FROM public.papers WHERE id=$1',[paper]);
    await save({file:'https://example.org/v2.pdf',title:'Updated paper',expected:stamp});
    assert.equal(await scalar('SELECT count(*)::int FROM public.paper_versions WHERE paper_id=$1',[paper]),2);
  });
  await t.test('reject stale edit without overwriting newer content', async () => {
    await assert.rejects(save({expected:oldTimestamp}),/đã thay đổi/);
    assert.equal(await scalar('SELECT title FROM public.papers WHERE id=$1',[paper]),'Updated paper');
  });
  await t.test('version failure rolls back changed metadata and coauthors', async () => {
    await asUser(null);
    await db.exec("ALTER TABLE public.paper_versions ADD CONSTRAINT test_version_failure CHECK (file_url <> 'https://example.org/fail.pdf')");
    await asUser(owner);
    const stamp = await scalar('SELECT updated_at::text FROM public.papers WHERE id=$1',[paper]);
    await assert.rejects(save({title:'Must rollback',file:'https://example.org/fail.pdf',authors:[],expected:stamp}));
    assert.equal(await scalar('SELECT title FROM public.papers WHERE id=$1',[paper]),'Updated paper');
    assert.equal(await scalar('SELECT count(*)::int FROM public.paper_authors WHERE paper_id=$1',[paper]),1);
    assert.equal(await scalar('SELECT current_version FROM public.papers WHERE id=$1',[paper]),2);
    await asUser(null);
    await db.exec('ALTER TABLE public.paper_versions DROP CONSTRAINT test_version_failure');
  });
  await t.test('coauthor and reviewer cannot edit owner submission', async () => {
    await asUser(coauthor);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),false);
    await assert.rejects(save(),/không có quyền/);
    await asUser(organizer);
    await db.query("INSERT INTO public.reviews(paper_id,reviewer_id) VALUES($1,$2)",[paper,reviewer]);
    await asUser(reviewer);
    await assert.rejects(save(),/không có quyền/);
  });
  await t.test('adding assigned reviewer as coauthor is rejected, preserving metadata', async () => {
    await asUser(owner);
    const stamp = await scalar('SELECT updated_at::text FROM public.papers WHERE id=$1',[paper]);
    await assert.rejects(save({title:'Must rollback',file:'https://example.org/v2.pdf',authors:[coauthor,reviewer],expected:stamp}),/phản biện/);
    assert.equal(await scalar('SELECT title FROM public.papers WHERE id=$1',[paper]),'Updated paper');
    await assert.rejects(db.query('INSERT INTO public.paper_authors(paper_id,user_id,author_order) VALUES($1,$2,2)',[paper,reviewer]),/phản biện/);
  });
  await t.test('existing coauthor cannot be assigned to review', async () => {
    await asUser(organizer);
    await assert.rejects(db.query('INSERT INTO public.reviews(paper_id,reviewer_id) VALUES($1,$2)',[paper,coauthor]),/co-authored/);
  });
  await t.test('completed review notifies owner and coauthor only once', async () => {
    await asUser(reviewer);
    await db.query("UPDATE public.reviews SET status='completed',score=8 WHERE paper_id=$1 AND reviewer_id=$2",[paper,reviewer]);
    await asUser(null);
    assert.equal(await scalar("SELECT count(*)::int FROM public.notifications WHERE title='Có kết quả phản biện mới'"),2);
    await asUser(reviewer);
    await db.query("UPDATE public.reviews SET status='completed',score=9 WHERE paper_id=$1 AND reviewer_id=$2",[paper,reviewer]);
    await asUser(null);
    assert.equal(await scalar("SELECT count(*)::int FROM public.notifications WHERE title='Có kết quả phản biện mới'"),2);
  });
  await t.test('deadline prevents metadata, coauthor and version writes', async () => {
    await db.query("UPDATE public.conferences SET submission_deadline=now()-interval '1 day' WHERE id=$1",[conference]);
    await asUser(owner);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),false);
    await assert.rejects(db.query("UPDATE public.papers SET title='Late' WHERE id=$1",[paper]));
    await assert.rejects(db.query('SELECT public.replace_paper_authors($1,$2)',[paper,[]]),/hết hạn/);
    await assert.rejects(db.query("INSERT INTO public.paper_versions(paper_id,version_number,file_url) VALUES($1,3,'https://example.org/late.pdf')",[paper]),/hết hạn/);
  });
  await t.test('accepted paper uses camera-ready deadline and notifies authors', async () => {
    await asUser(organizer);
    await db.query("UPDATE public.papers SET status='accepted' WHERE id=$1",[paper]);
    await asUser(owner);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),true);
    const stamp = await scalar('SELECT updated_at::text FROM public.papers WHERE id=$1',[paper]);
    await save({title:'Updated paper',file:'https://example.org/final.pdf',expected:stamp});
    assert.equal(await scalar('SELECT current_version FROM public.papers WHERE id=$1',[paper]),3);
    await asUser(null);
    assert.equal(await scalar("SELECT count(*)::int FROM public.notifications WHERE title='Cập nhật kết quả bài báo'"),2);
    assert.equal(await scalar("SELECT count(*)::int FROM public.reporting_events WHERE event_type='camera_ready' AND paper_id=$1",[paper]),1);
    await db.query("UPDATE public.conferences SET camera_ready_deadline=now()-interval '1 day' WHERE id=$1",[conference]);
    await asUser(owner);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),false);
  });
  await t.test('historical file cannot be overwritten or deleted, even after newer URL version', async () => {
    const changes = await db.query("UPDATE storage.objects SET name='renamed.pdf' WHERE name=$1 RETURNING id",[`${owner}/v1.pdf`]);
    assert.equal(changes.rows.length,0);
    assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING id',[`${owner}/v1.pdf`])).rows.length,0);
    await db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('paper-files','unused.pdf',$1)",[owner]);
    assert.equal((await db.query("DELETE FROM storage.objects WHERE name='unused.pdf' RETURNING id")).rows.length,1);
  });
  await t.test('blind conference rejects external URL submission', async () => {
    await asUser(null);
    await db.query("UPDATE public.conferences SET blind_review=true,submission_deadline=now()+interval '1 day' WHERE id=$1",[conference]);
    await asUser(owner);
    await assert.rejects(save({id:failedPaper,file:'https://example.org/public.pdf'}),/ẩn danh/);
  });
  await t.test('author cannot decide paper status', async () => {
    await assert.rejects(db.query("UPDATE public.papers SET status='rejected' WHERE id=$1",[paper]),/status/);
  });
  await t.test('rejected paper and completed conference are locked', async () => {
    await asUser(organizer);
    await db.query("UPDATE public.papers SET status='rejected' WHERE id=$1",[paper]);
    await asUser(owner);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),false);
    await asUser(organizer);
    await db.query("UPDATE public.papers SET status='submitted' WHERE id=$1",[paper]);
    await db.query("UPDATE public.conferences SET status='completed' WHERE id=$1",[conference]);
    await asUser(owner);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),false);
    await asUser(organizer);
    assert.equal(await scalar('SELECT public.can_edit_paper_submission($1)',[paper]),true);
  });
  await t.test('unauthenticated caller cannot submit', async () => {
    await asUser(null);
    await assert.rejects(save(),/đăng nhập/);
  });
  const reviewerMigration = await readFile(new URL('../migrations/20260925_reviewer_workflow.sql', import.meta.url), 'utf8');
  await db.exec(reviewerMigration);
  await db.exec(reviewerMigration);
  const invitationPaper = '30000000-0000-0000-0000-000000000003';
  let invitationId;
  await t.test('reviewer migration preserves completed reviews and supports dedicated reviewer role', async () => {
    assert.equal(await scalar("SELECT status FROM public.reviews WHERE paper_id=$1",[paper]),'completed');
    await db.query("UPDATE public.profiles SET role='reviewer' WHERE id=$1",[reviewer]);
    await db.query("UPDATE public.conferences SET status='open',review_deadline=now()+interval '2 days' WHERE id=$1",[conference]);
    await db.query("INSERT INTO public.papers(id,conference_id,title,submitted_by) VALUES($1,$2,'Invitation paper',$3)",[invitationPaper,conference,owner]);
    await asUser(organizer);
    invitationId = await scalar('INSERT INTO public.reviews(paper_id,reviewer_id) VALUES($1,$2) RETURNING id',[invitationPaper,reviewer]);
  });
  await t.test('pending invitation cannot be graded or completed', async () => {
    await asUser(reviewer);
    await assert.rejects(db.query('UPDATE public.reviews SET score=8 WHERE id=$1',[invitationId]),/nhận phân công/);
    await assert.rejects(db.query("UPDATE public.reviews SET status='completed',score=8,comments='Good',recommendation='accept' WHERE id=$1",[invitationId]),/không hợp lệ/);
  });
  await t.test('organizer and another author cannot accept on reviewer behalf', async () => {
    await asUser(organizer);
    await assert.rejects(db.query('SELECT public.respond_review_assignment($1,true)',[invitationId]),/không có quyền/);
    await assert.rejects(db.query("UPDATE public.reviews SET status='in_progress' WHERE id=$1",[invitationId]),/Chỉ người/);
    await assert.rejects(db.query('UPDATE public.reviews SET reviewer_id=$2 WHERE id=$1',[invitationId,coauthor]),/lời mời mới/);
    await asUser(owner);
    await assert.rejects(db.query('SELECT public.respond_review_assignment($1,true)',[invitationId]),/không có quyền/);
  });
  await t.test('decline requires reason, persists response and notifies organizer', async () => {
    await asUser(reviewer);
    await assert.rejects(db.query('SELECT public.respond_review_assignment($1,false)',[invitationId]),/lý do/);
    await db.query("SELECT public.respond_review_assignment($1,false,'Không phù hợp chuyên môn')",[invitationId]);
    assert.equal(await scalar('SELECT status FROM public.reviews WHERE id=$1',[invitationId]),'declined');
    assert.ok(await scalar('SELECT response_at FROM public.reviews WHERE id=$1',[invitationId]));
    await asUser(organizer);
    assert.equal(await scalar("SELECT count(*)::int FROM public.notifications WHERE title='Phản biện từ chối phân công'"),1);
  });
  await t.test('declined invitation cannot be accepted or graded without reassignment', async () => {
    await asUser(reviewer);
    await assert.rejects(db.query('SELECT public.respond_review_assignment($1,true)',[invitationId]),/đã được phản hồi/);
    await assert.rejects(db.query('UPDATE public.reviews SET score=8 WHERE id=$1',[invitationId]),/nhận phân công/);
  });
  await t.test('new assignment can be accepted then completed with required feedback', async () => {
    await asUser(organizer);
    await db.query('DELETE FROM public.reviews WHERE id=$1',[invitationId]);
    invitationId=await scalar('INSERT INTO public.reviews(paper_id,reviewer_id) VALUES($1,$2) RETURNING id',[invitationPaper,reviewer]);
    await asUser(reviewer);
    await db.query('SELECT public.respond_review_assignment($1,true)',[invitationId]);
    assert.equal(await scalar('SELECT status FROM public.reviews WHERE id=$1',[invitationId]),'in_progress');
    await assert.rejects(db.query("UPDATE public.reviews SET status='completed',score=8,recommendation='accept' WHERE id=$1",[invitationId]),/nhận xét/);
    await db.query("UPDATE public.reviews SET status='completed',score=8,comments='Đánh giá đầy đủ',recommendation='accept' WHERE id=$1",[invitationId]);
    assert.ok(await scalar('SELECT completed_at FROM public.reviews WHERE id=$1',[invitationId]));
    await assert.rejects(db.query('UPDATE public.reviews SET score=9 WHERE id=$1',[invitationId]),/không thể sửa/);
  });
  await t.test('reviewers cannot read each other evaluations on the same paper', async () => {
    await asUser(organizer);
    await db.query('INSERT INTO public.reviews(paper_id,reviewer_id) VALUES($1,$2)',[invitationPaper,coauthor]);
    await asUser(reviewer);
    assert.equal(await scalar('SELECT count(*)::int FROM public.reviews WHERE paper_id=$1',[invitationPaper]),1);
    await asUser(owner);
    assert.equal(await scalar('SELECT count(*)::int FROM public.reviews WHERE paper_id=$1',[invitationPaper]),2);
  });
});
