-- Run on a test database with the reporting migration. Fixtures are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
INSERT INTO auth.users(id, raw_user_meta_data) VALUES
 ('96000000-0000-0000-0000-000000000001', '{"full_name":"Reporting admin"}'),
 ('96000000-0000-0000-0000-000000000002', '{"full_name":"Reporting author","role":"author"}');
UPDATE public.profiles SET role = 'admin' WHERE id = '96000000-0000-0000-0000-000000000001';
INSERT INTO public.conferences(id, title, start_date, end_date, status, organizer_id) VALUES
 ('97000000-0000-0000-0000-000000000001', 'Reporting fixture', current_date, current_date + 1, 'open', '96000000-0000-0000-0000-000000000001');
INSERT INTO public.participants(conference_id, user_id) VALUES ('97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002');
DELETE FROM public.participants WHERE conference_id = '97000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.reporting_events WHERE conference_id = '97000000-0000-0000-0000-000000000001' AND event_type = 'registration_cancelled'), 'cancellation recorded once');
INSERT INTO public.papers(id, conference_id, title, submitted_by, status) VALUES
 ('98000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'Paper reporting fixture', '96000000-0000-0000-0000-000000000002', 'submitted');
INSERT INTO public.paper_versions(paper_id, version_number, file_url, uploaded_by) VALUES
 ('98000000-0000-0000-0000-000000000001', 1, 'fixture/v1.pdf', '96000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.reporting_events WHERE paper_id = '98000000-0000-0000-0000-000000000001'), 'ordinary submission is not camera-ready');
UPDATE public.papers SET status = 'accepted' WHERE id = '98000000-0000-0000-0000-000000000001';
INSERT INTO public.paper_versions(paper_id, version_number, file_url, uploaded_by) VALUES
 ('98000000-0000-0000-0000-000000000001', 2, 'fixture/v2.pdf', '96000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.reporting_events WHERE paper_id = '98000000-0000-0000-0000-000000000001' AND event_type = 'camera_ready'), 'post-acceptance version recorded');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000002', true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.reporting_events), 'non-admin cannot read history');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.reporting_events(event_type) VALUES ('registration_cancelled');
    RAISE EXCEPTION 'FAIL: client could forge reporting history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.reporting_events WHERE conference_id = '97000000-0000-0000-0000-000000000001'), 'admin reads history');
ROLLBACK;
