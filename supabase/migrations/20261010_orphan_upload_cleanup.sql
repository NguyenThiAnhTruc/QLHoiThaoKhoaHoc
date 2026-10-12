BEGIN;
CREATE TABLE IF NOT EXISTS public.upload_cleanup_jobs (
 bucket_id text NOT NULL CHECK(bucket_id IN ('conference-resources','fee-proofs')),
 file_path text NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT now(),
 cleaned_at timestamptz,
 PRIMARY KEY(bucket_id,file_path)
);
ALTER TABLE public.upload_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upload_cleanup_jobs FROM anon,authenticated;
GRANT SELECT,UPDATE ON public.upload_cleanup_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.lock_attached_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bucket text; path text;
BEGIN
 IF TG_TABLE_NAME='conference_resources' THEN bucket='conference-resources';path=NEW.file_path;
 ELSE bucket='fee-proofs';path=NEW.proof_url; END IF;
 IF path !~ '^https?://' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||bucket||':'||path,0));
  IF EXISTS(SELECT 1 FROM public.upload_cleanup_jobs WHERE bucket_id=bucket AND file_path=path) THEN
   RAISE EXCEPTION 'Upload expired; upload a new file';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_orphan_uploads(batch_size integer DEFAULT 25)
RETURNS TABLE(bucket_id text,file_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate record; cap integer:=greatest(1,least(coalesce(batch_size,25),100));
BEGIN
 -- Serialize collectors. A durable reservation also survives a worker/network failure.
 PERFORM pg_advisory_xact_lock(610102027);
 FOR candidate IN
  SELECT o.bucket_id,o.name FROM storage.objects o
  WHERE o.bucket_id IN ('conference-resources','fee-proofs') AND o.created_at<now()-interval '24 hours'
   AND NOT EXISTS(SELECT 1 FROM public.upload_cleanup_jobs j WHERE j.bucket_id=o.bucket_id AND j.file_path=o.name)
   AND NOT EXISTS(SELECT 1 FROM public.conference_resources r WHERE o.bucket_id='conference-resources' AND r.file_path=o.name)
   AND NOT EXISTS(SELECT 1 FROM public.fee_payments p WHERE o.bucket_id='fee-proofs' AND p.proof_url=o.name)
  ORDER BY o.created_at,o.name LIMIT cap
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('upload:'||candidate.bucket_id||':'||candidate.name,0));
  -- Recheck after obtaining the same lock used by metadata inserts.
  IF NOT EXISTS(SELECT 1 FROM public.conference_resources WHERE candidate.bucket_id='conference-resources' AND public.conference_resources.file_path=candidate.name)
   AND NOT EXISTS(SELECT 1 FROM public.fee_payments WHERE candidate.bucket_id='fee-proofs' AND proof_url=candidate.name) THEN
   INSERT INTO public.upload_cleanup_jobs(bucket_id,file_path) VALUES(candidate.bucket_id,candidate.name) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 RETURN QUERY SELECT j.bucket_id,j.file_path FROM public.upload_cleanup_jobs j WHERE j.cleaned_at IS NULL ORDER BY j.reserved_at,j.file_path LIMIT cap;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_orphan_uploads(integer),public.lock_attached_upload() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_orphan_uploads(integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
