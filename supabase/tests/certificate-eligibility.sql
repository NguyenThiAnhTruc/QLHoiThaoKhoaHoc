BEGIN;
CREATE FUNCTION pg_temp.expect_check(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected eligibility/capacity rejection';
END $$;
INSERT INTO public.conferences(id,title,start_date,end_date,status,organizer_id,max_participants)
VALUES ('96000000-0000-0000-0000-000000000001','Certificate test',current_date-1,current_date,'open','00000000-0000-0000-0000-000000000002',2);
INSERT INTO public.participants(conference_id,user_id,attended) VALUES
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',true),
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',false);
INSERT INTO public.papers(id,conference_id,title,status,submitted_by) VALUES
 ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001','Accepted talk','accepted','00000000-0000-0000-0000-000000000003');
INSERT INTO public.sessions(id,conference_id,title,start_time,end_time,speaker_id,paper_id) VALUES
 ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000001','Talk',now()+interval '1 hour',now()+interval '2 hours','00000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.expect_check($q$INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','attendance')$q$);
SELECT pg_temp.expect_check($q$INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','presentation')$q$);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.certificate_eligible_recipients('96000000-0000-0000-0000-000000000001','attendance')) <> 1 THEN RAISE EXCEPTION 'Wrong attendance picker'; END IF;
  IF EXISTS(SELECT 1 FROM public.certificate_eligible_recipients('96000000-0000-0000-0000-000000000001','presentation')) THEN RAISE EXCEPTION 'Future session was eligible'; END IF;
END $$;
INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','attendance');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.certificate_eligible_recipients('96000000-0000-0000-0000-000000000001','attendance')) THEN RAISE EXCEPTION 'Already issued certificate offered again'; END IF;
END $$;
UPDATE public.sessions SET start_time=now()-interval '2 hours',end_time=now()-interval '1 hour' WHERE id='96000000-0000-0000-0000-000000000003';
INSERT INTO public.certificates(conference_id,user_id,certificate_type) VALUES
 ('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','presentation');
SELECT pg_temp.expect_check($q$UPDATE public.conferences SET max_participants=1 WHERE id='96000000-0000-0000-0000-000000000001'$q$);
DELETE FROM public.participants WHERE conference_id='96000000-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000004';
UPDATE public.conferences SET max_participants=1 WHERE id='96000000-0000-0000-0000-000000000001';
DO $$ BEGIN RAISE NOTICE 'PASS: certificate eligibility, picker, completed session, capacity reduction and released slot'; END $$;
ROLLBACK;
