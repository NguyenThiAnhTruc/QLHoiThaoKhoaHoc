import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('SQL bundles initialize and upgrade twice without shifting conference times', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  await db.exec(await read('./local_bootstrap.sql'));
  // Password hashing is owned by pgcrypto on Supabase; only stub it in this disposable test.
  await db.exec("CREATE FUNCTION gen_salt(text) RETURNS text LANGUAGE sql AS $$ SELECT 'test'::text $$; CREATE FUNCTION crypt(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'test-only-hash'::text $$;");
  await db.exec((await read('../migrations/conference_management_supabase.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  const updates = await read('../migrations/conference_updates.sql');
  await db.exec(updates);
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    VALUES
      ('f0000000-0000-0000-0000-000000000001', 'author-two@example.com', '{"full_name":"Tác giả Hai","role":"author"}', now(), now()),
      ('f0000000-0000-0000-0000-000000000002', 'author-three@example.com', '{"full_name":"Tác giả Ba","role":"author"}', now(), now());
  `);
  const times = (await db.query('SELECT id, start_date, end_date FROM conferences ORDER BY id')).rows;
  await db.exec(updates);
  assert.deepEqual((await db.query('SELECT id, start_date, end_date FROM conferences ORDER BY id')).rows, times);
  const demo = await read('../migrations/conference_demo_data.sql');
  await db.exec(demo);
  await db.exec(demo);
  const paperStatusConsistency = await read('../migrations/20260927_paper_status_consistency.sql');
  await db.exec(paperStatusConsistency);
  await db.exec(paperStatusConsistency);
  const disableBlindReview = await read('../migrations/20260927_disable_blind_review.sql');
  await db.exec(disableBlindReview);
  await db.exec(disableBlindReview);
  await db.exec(await read('../migrations/create_reviewer_accounts.sql'));
  await db.exec("ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check; ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'organizer', 'author', 'reviewer', 'participant')); UPDATE public.profiles SET role = 'participant' WHERE id = '00000000-0000-0000-0000-000000000005';");
  const removeParticipant = await read('../migrations/20261009_remove_participant_role.sql');
  await db.exec(removeParticipant);
  await db.exec(removeParticipant);
  const adminGrantedReviewers = await read('../migrations/20261009_admin_granted_reviewers.sql');
  await db.exec(adminGrantedReviewers);
  await db.exec(adminGrantedReviewers);
  assert.equal((await db.query("SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000005'")).rows[0].role, 'author');
  assert.equal((await db.query("SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'")).rows[0].column_default, "'author'::text");
  await assert.rejects(db.exec("UPDATE public.profiles SET role = 'participant' WHERE id = '00000000-0000-0000-0000-000000000005'"));
  assert.equal((await db.query("SELECT count(*)::int AS count FROM profiles WHERE role = 'reviewer' AND id::text LIKE '10000000-0000-0000-0000-%'")).rows[0].count, 10);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth.users WHERE email LIKE 'reviewer%@confmanager.com'")).rows[0].count, 11);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM auth.identities WHERE provider = 'email' AND provider_id LIKE 'reviewer%@confmanager.com'")).rows[0].count, 11);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM profiles WHERE btrim(full_name) = ''")).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM profiles p JOIN auth.users u ON u.id = p.id WHERE coalesce(u.raw_user_meta_data->>'full_name', '') IS DISTINCT FROM p.full_name")).rows[0].count, 0);
  assert.equal((await db.query("SELECT full_name FROM profiles WHERE id = '00000000-0000-0000-0000-000000000003'")).rows[0].full_name, 'Lê Hoàng Nam');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM conferences')).rows[0].count, 22);
  assert.equal((await db.query('SELECT count(DISTINCT field)::int AS count FROM conferences')).rows[0].count, 12);
  const newPapers = (await db.query("SELECT conference_id, count(*)::int AS count FROM papers WHERE id::text LIKE 'e2000000-%' GROUP BY conference_id")).rows;
  assert.equal(newPapers.length, 12);
  assert.ok(newPapers.every((row) => row.count === 2));
  assert.equal((await db.query("SELECT count(*)::int AS count FROM papers WHERE btrim(coalesce(file_url, '')) = ''")).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM papers p WHERE p.status IN ('accepted','rejected','revision_required') AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.paper_id=p.id AND r.status='completed')")).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM papers p WHERE p.status='under_review' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.paper_id=p.id AND r.status IN ('assigned','in_progress','completed'))")).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM conferences WHERE blind_review")).rows[0].count, 0);
  assert.equal((await db.query("SELECT public.must_hide_paper_identity('20000000-0000-0000-0000-000000000001') AS hidden")).rows[0].hidden, false);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM papers p WHERE id::text LIKE 'e2000000-%' AND NOT EXISTS (SELECT 1 FROM paper_versions pv WHERE pv.paper_id = p.id AND pv.version_number = 1 AND pv.file_url = p.file_url)")).rows[0].count, 0);
  const authorLoads = (await db.query(`
    SELECT submitted_by, count(*)::int AS count
    FROM papers
    WHERE id::text LIKE '20000000-0000-0000-0000-%'
       OR id::text LIKE 'd0000000-0000-0000-0000-%'
       OR id::text LIKE 'e2000000-0000-0000-0000-%'
    GROUP BY submitted_by
  `)).rows;
  const authorCount = (await db.query("SELECT count(*)::int AS count FROM profiles WHERE role = 'author'")).rows[0].count;
  assert.equal(authorLoads.length, authorCount);
  assert.ok(Math.max(...authorLoads.map((row) => row.count)) - Math.min(...authorLoads.map((row) => row.count)) <= 1);
  assert.equal((await db.query(`
    SELECT count(*)::int AS count
    FROM paper_versions version
    JOIN papers paper ON paper.id = version.paper_id
    WHERE version.uploaded_by IS DISTINCT FROM paper.submitted_by
      AND (paper.id::text LIKE '20000000-0000-0000-0000-%'
        OR paper.id::text LIKE 'd0000000-0000-0000-0000-%'
        OR paper.id::text LIKE 'e2000000-0000-0000-0000-%')
  `)).rows[0].count, 0);
  const summaries = (await db.query("SELECT abstract FROM papers WHERE id::text LIKE 'e2000000-%'")).rows;
  assert.equal(new Set(summaries.map((row) => row.abstract)).size, 24);
  assert.ok(summaries.every((row) => !/giả lập|minh họa|chưa có/i.test(row.abstract)));
  const introductions = (await db.query("SELECT description FROM conferences WHERE id::text LIKE 'e1000000-%'")).rows;
  assert.equal(new Set(introductions.map((row) => row.description)).size, 12);
  assert.ok(introductions.every((row) => !/hội thảo mẫu/i.test(row.description)));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM conferences WHERE field IS NULL')).rows[0].count, 0);
  await db.exec("INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('f0000000-0000-0000-0000-000000000099', '{\"full_name\":\"Self-selected reviewer\",\"role\":\"reviewer\"}')");
  assert.equal((await db.query("SELECT role FROM public.profiles WHERE id = 'f0000000-0000-0000-0000-000000000099'")).rows[0].role, 'author');
  await assert.rejects(db.exec("INSERT INTO public.reviews(paper_id, reviewer_id) VALUES ('20000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000099')"));
});
