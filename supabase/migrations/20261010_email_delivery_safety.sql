BEGIN;
ALTER TABLE public.post_seminar_jobs ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;
ALTER TABLE public.post_seminar_jobs DROP CONSTRAINT IF EXISTS post_seminar_jobs_status_check;
ALTER TABLE public.post_seminar_jobs ADD CONSTRAINT post_seminar_jobs_status_check CHECK(status IN ('pending','processing','sent','failed','uncertain'));

CREATE OR REPLACE FUNCTION public.begin_post_seminar_delivery(target_job_id uuid,expected_attempt integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.post_seminar_jobs SET delivery_started_at=now()
  WHERE id=target_job_id AND status='processing' AND attempts=expected_attempt AND delivery_started_at IS NULL;
  RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION public.claim_post_seminar_jobs(batch_size integer DEFAULT 10) RETURNS SETOF public.post_seminar_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.post_seminar_jobs SET status='uncertain',last_error='Delivery started; verify Gmail before any manual resend'
  WHERE delivery_started_at IS NOT NULL AND (status='failed' OR (status='processing' AND locked_at<now()-interval '10 minutes'));
  RETURN QUERY UPDATE public.post_seminar_jobs j SET status='processing',locked_at=now(),attempts=j.attempts+1
  WHERE j.id IN(SELECT q.id FROM public.post_seminar_jobs q WHERE q.attempts<5 AND q.delivery_started_at IS NULL AND
    (q.status IN ('pending','failed') OR (q.status='processing' AND q.locked_at<now()-interval '10 minutes'))
    ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(batch_size,25))) RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_post_seminar_delivery(uuid,integer),public.claim_post_seminar_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_post_seminar_delivery(uuid,integer),public.claim_post_seminar_jobs(integer) TO service_role;
NOTIFY pgrst,'reload schema';
-- Serialize storage deletion with metadata insertion. Never remove a referenced file.
CREATE OR REPLACE FUNCTION public.lock_attached_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bucket text; path text;
BEGIN
  IF TG_TABLE_NAME='conference_resources' THEN bucket='conference-resources';path=NEW.file_path;
  ELSE bucket='fee-proofs';path=NEW.proof_url; END IF;
  IF path !~ '^https?://' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||bucket||':'||path,0));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aaa_lock_upload ON public.conference_resources;
CREATE TRIGGER aaa_lock_upload BEFORE INSERT ON public.conference_resources FOR EACH ROW EXECUTE FUNCTION public.lock_attached_upload();
DROP TRIGGER IF EXISTS aaa_lock_upload ON public.fee_payments;
CREATE TRIGGER aaa_lock_upload BEFORE INSERT ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION public.lock_attached_upload();
CREATE OR REPLACE FUNCTION public.can_delete_unattached_upload(target_bucket text,target_path text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR split_part(target_path,'/',1)<>auth.uid()::text OR target_bucket NOT IN ('conference-resources','fee-proofs') THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||target_bucket||':'||target_path,0));
  IF target_bucket='conference-resources' THEN RETURN NOT EXISTS(SELECT 1 FROM public.conference_resources WHERE file_path=target_path); END IF;
  RETURN NOT EXISTS(SELECT 1 FROM public.fee_payments WHERE proof_url=target_path);
END;
$$;
REVOKE ALL ON FUNCTION public.lock_attached_upload(),public.can_delete_unattached_upload(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_unattached_upload(text,text) TO authenticated;
DROP POLICY IF EXISTS own_unattached_upload_read ON storage.objects;
CREATE POLICY own_unattached_upload_read ON storage.objects FOR SELECT TO authenticated USING(public.can_delete_unattached_upload(bucket_id,name));
DROP POLICY IF EXISTS own_unattached_upload_delete ON storage.objects;
CREATE POLICY own_unattached_upload_delete ON storage.objects FOR DELETE TO authenticated USING(public.can_delete_unattached_upload(bucket_id,name));
COMMIT;
