-- Run with psql -v ON_ERROR_STOP=1 after schema + 20260923 migration.
-- Fixtures and all assertions are rolled back; no existing records are changed.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
CREATE FUNCTION pg_temp.expect_denied(statement text, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % was allowed', label;
END $$;

INSERT INTO auth.users(id, raw_user_meta_data)
SELECT ('90000000-0000-0000-0000-00000000000' || n)::uuid,
  jsonb_build_object('full_name', 'Role test ' || n, 'role', CASE WHEN n IN (3,4) THEN 'author' ELSE 'participant' END)
FROM generate_series(1,6) n;
UPDATE public.profiles SET role = CASE right(id::text, 1) WHEN '1' THEN 'admin' WHEN '2' THEN 'organizer' ELSE role END
WHERE id::text LIKE '90000000-%';
INSERT INTO public.conferences(id, title, start_date, end_date, status, organizer_id, blind_review)
VALUES
 ('91000000-0000-0000-0000-000000000001','Blind test',current_date,current_date+1,'open','90000000-0000-0000-0000-000000000002',true),
 ('91000000-0000-0000-0000-000000000002','Other test',current_date,current_date+1,'open','90000000-0000-0000-0000-000000000001',false);
INSERT INTO public.conference_staff(conference_id,user_id) VALUES
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000006');
INSERT INTO public.papers(id, conference_id, title, submitted_by, file_url) VALUES
 ('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','Blind manuscript','90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000003/manuscript.pdf');
INSERT INTO public.paper_authors(paper_id,user_id,author_order) VALUES
 ('92000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',1);
INSERT INTO public.paper_versions(paper_id,version_number,file_url,uploaded_by) VALUES
 ('92000000-0000-0000-0000-000000000001',1,'90000000-0000-0000-0000-000000000003/manuscript.pdf','90000000-0000-0000-0000-000000000003');
INSERT INTO public.reviews(id,paper_id,reviewer_id) VALUES
 ('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004');
INSERT INTO storage.objects(bucket_id,name,owner) VALUES
 ('paper-files','90000000-0000-0000-0000-000000000003/manuscript.pdf','90000000-0000-0000-0000-000000000003');
INSERT INTO public.participants(conference_id,user_id) VALUES
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005'),
 ('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000005');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.expect_denied($q$INSERT INTO public.papers(conference_id,title,status) VALUES
 ('91000000-0000-0000-0000-000000000001','Forged acceptance','accepted')$q$, 'author cannot insert accepted paper');
INSERT INTO public.papers(conference_id,title) VALUES
 ('91000000-0000-0000-0000-000000000001','Valid submission');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.papers WHERE title='Valid submission' AND status='submitted'), 'normal author submission succeeds');
SELECT pg_temp.assert_true((SELECT submitted_by = auth.uid() FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'owner retains identity and access');

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.papers WHERE id='92000000-0000-0000-0000-000000000001'), 'reviewer cannot read raw blind paper');
SELECT pg_temp.assert_true((SELECT submitted_by IS NULL AND file_url='blind:92000000-0000-0000-0000-000000000001' FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'reviewer receives masked paper and opaque file handle');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001' AND submitted_by='90000000-0000-0000-0000-000000000003'), 'owner filter cannot probe hidden identity');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.paper_versions WHERE paper_id='92000000-0000-0000-0000-000000000001'), 'blind reviewer cannot read identifying versions');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.paper_authors WHERE paper_id='92000000-0000-0000-0000-000000000001'), 'blind reviewer cannot read coauthor identities');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='90000000-0000-0000-0000-000000000003/manuscript.pdf'), 'blind reviewer cannot list/download identifying storage object');
UPDATE public.reviews SET status='in_progress', comments='Review in progress' WHERE id='93000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT status='in_progress' FROM public.reviews WHERE id='93000000-0000-0000-0000-000000000001'), 'assigned author can still review');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.profile_directory WHERE id='90000000-0000-0000-0000-000000000002' AND full_name='Role test 2'), 'safe directory exposes organizer display name');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='90000000-0000-0000-0000-000000000002'), 'private profile remains protected');

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'unassigned participant cannot read unpublished paper');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.managed_conferences()), 'ordinary participant has no management rights');
SELECT pg_temp.expect_denied($q$INSERT INTO public.papers(conference_id,title) VALUES
 ('91000000-0000-0000-0000-000000000001','Participant submission')$q$, 'participant cannot submit paper');
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.expect_denied($q$INSERT INTO public.participants(conference_id,user_id,attended) VALUES
 ('91000000-0000-0000-0000-000000000001',auth.uid(),true)$q$, 'registration cannot forge attendance');
INSERT INTO public.participants(conference_id,user_id) VALUES ('91000000-0000-0000-0000-000000000001',auth.uid());
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.participants WHERE user_id=auth.uid() AND attended=false), 'normal registration succeeds');

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.managed_conferences()), 'participant staff manages only assigned conference');
UPDATE public.participants SET attended=true WHERE conference_id='91000000-0000-0000-0000-000000000001' AND user_id='90000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert_true((SELECT attended FROM public.participants WHERE conference_id='91000000-0000-0000-0000-000000000001' AND user_id='90000000-0000-0000-0000-000000000005'), 'staff can check in attendee');
INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','attendance');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.certificates WHERE conference_id='91000000-0000-0000-0000-000000000001'), 'staff can issue and read certificates');
SELECT pg_temp.expect_denied($q$INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('91000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000005','attendance')$q$, 'staff cannot issue certificate in another conference');
SELECT pg_temp.assert_true((SELECT submitted_by IS NOT NULL FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'authorized staff retains author identity');

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
UPDATE public.papers SET status='accepted' WHERE id='92000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT status='accepted' FROM public.papers WHERE id='92000000-0000-0000-0000-000000000001'), 'organizer can accept paper');
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true((SELECT submitted_by IS NULL FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'accepted paper reading does not bypass blind identity protection');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.papers WHERE id='92000000-0000-0000-0000-000000000001'), 'accepted policy cannot expose raw blind paper');
SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.managed_conferences() WHERE id::text LIKE '91000000-%'), 'admin manages both conferences');
SELECT pg_temp.assert_true((SELECT submitted_by IS NOT NULL FROM public.read_papers() WHERE id='92000000-0000-0000-0000-000000000001'), 'admin retains author identity');
ROLLBACK;
