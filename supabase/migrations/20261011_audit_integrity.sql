BEGIN;
-- Application triggers and administrative RPCs execute as their owner.
-- Browser roles must not manufacture arbitrary audit events through a public RPC.
REVOKE ALL ON FUNCTION public.write_audit_log(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
