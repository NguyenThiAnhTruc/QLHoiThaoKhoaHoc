-- Restore the authenticated RPC grant for existing databases.
-- This does not change data or bypass row-level security.
BEGIN;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_complete_paper_submission(
  uuid, uuid, text, text, text, text, uuid[], text, timestamptz,
  uuid[], jsonb, text, text, text, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
