-- Run on a test database after schema and 20260924_admin_management.sql.
-- All fixtures and changes are rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
INSERT INTO auth.users(id, raw_user_meta_data) VALUES
 ('94000000-0000-0000-0000-000000000001', '{"full_name":"Admin test"}'),
 ('94000000-0000-0000-0000-000000000002', '{"full_name":"Owner test"}'),
 ('94000000-0000-0000-0000-000000000003', '{"full_name":"Participant test"}');
UPDATE public.profiles SET role = CASE right(id::text, 1) WHEN '1' THEN 'admin' WHEN '2' THEN 'organizer' ELSE 'participant' END
WHERE id IN ('94000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000003');
INSERT INTO public.conferences(id, title, start_date, end_date, organizer_id) VALUES
 ('95000000-0000-0000-0000-000000000001', 'Transfer test', current_date, current_date + 1, '94000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.transfer_conference_ownership('95000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: organizer was allowed to transfer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000001', true);
SELECT public.transfer_conference_ownership('95000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true((SELECT organizer_id = '94000000-0000-0000-0000-000000000002' FROM public.conferences WHERE id = '95000000-0000-0000-0000-000000000001'), 'owner changed');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id = '95000000-0000-0000-0000-000000000001' AND action = 'conference.ownership_transferred'), 'transfer audited');
ROLLBACK;
