-- Apply after the 20261010 upgrade. Existing records are retained.
BEGIN;

-- SOURCE: 20261011_certificate_verification.sql

ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS verification_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS revocation_reason text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS certificates_verification_token_unique ON public.certificates(verification_token);
-- Keep the existing number lookup compatible, but never report a revoked certificate as valid.
CREATE OR REPLACE FUNCTION public.verify_certificate(lookup_number text)
RETURNS TABLE(certificate_number text,certificate_type text,issued_at timestamptz,recipient_name text,recipient_organization text,conference_title text,conference_start_date date,conference_end_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.certificate_number,c.certificate_type,c.issued_at,p.full_name,p.organization,e.title,
 (e.start_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,(e.end_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
 FROM public.certificates c JOIN public.profiles p ON p.id=c.user_id JOIN public.conferences e ON e.id=c.conference_id
 WHERE c.certificate_number=lookup_number AND c.revoked_at IS NULL LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.verify_certificate(token uuid)
RETURNS TABLE(certificate_number text,conference_title text,certificate_type text,issued_at timestamptz,revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.certificate_number,e.title,c.certificate_type,c.issued_at,c.revoked_at
 FROM public.certificates c JOIN public.conferences e ON e.id=c.conference_id WHERE c.verification_token=token;
$$;
CREATE OR REPLACE FUNCTION public.revoke_certificate(target_certificate_id uuid,reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cert public.certificates;
BEGIN
 SELECT * INTO cert FROM public.certificates WHERE id=target_certificate_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT public.is_conference_organizer(cert.conference_id) THEN
  RAISE EXCEPTION 'Bạn không có quyền thu hồi chứng nhận' USING ERRCODE='42501';
 END IF;
 IF length(trim(coalesce(reason,'')))<5 OR length(reason)>1000 THEN RAISE EXCEPTION 'Nhập lý do thu hồi từ 5 đến 1000 ký tự' USING ERRCODE='23514'; END IF;
 IF cert.revoked_at IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.certificates SET revoked_at=now(),revoked_by=auth.uid(),revocation_reason=trim(reason) WHERE id=cert.id;
 PERFORM public.write_audit_log('certificate.revoked','certificate',cert.id,jsonb_build_object('reason',trim(reason)));
 UPDATE public.post_seminar_jobs SET status='failed',attempts=5,last_error='Certificate revoked' WHERE certificate_id=cert.id AND delivery_started_at IS NULL AND status IN ('pending','failed','processing');
 RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_certificate_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.verification_token IS DISTINCT FROM OLD.verification_token OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
  OR NEW.conference_id IS DISTINCT FROM OLD.conference_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
  OR NEW.certificate_type IS DISTINCT FROM OLD.certificate_type OR NEW.paper_id IS DISTINCT FROM OLD.paper_id
  OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN RAISE EXCEPTION 'Nội dung chứng nhận đã cấp không được thay đổi'; END IF;
 IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
  RAISE EXCEPTION 'Chứng nhận đã thu hồi không được khôi phục';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_certificate_record ON public.certificates;
CREATE TRIGGER guard_certificate_record BEFORE UPDATE ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.guard_certificate_record();
REVOKE ALL ON FUNCTION public.verify_certificate(uuid),public.revoke_certificate(uuid,text),public.guard_certificate_record() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.begin_post_seminar_delivery(target_job_id uuid,expected_attempt integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.post_seminar_jobs j SET delivery_started_at=now()
 WHERE j.id=target_job_id AND j.status='processing' AND j.attempts=expected_attempt AND j.delivery_started_at IS NULL
  AND (j.certificate_id IS NULL OR EXISTS(SELECT 1 FROM public.certificates c WHERE c.id=j.certificate_id AND c.revoked_at IS NULL));
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_post_seminar_delivery(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_post_seminar_delivery(uuid,integer) TO service_role;
DROP POLICY IF EXISTS certificate_pdf_read ON storage.objects;
CREATE POLICY certificate_pdf_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='certificate-pdfs'
 AND EXISTS(SELECT 1 FROM public.certificates c WHERE c.pdf_path=name AND c.revoked_at IS NULL AND (c.user_id=auth.uid() OR public.is_conference_organizer(c.conference_id))));
NOTIFY pgrst,'reload schema';


-- SOURCE: 20261011_review_revision.sql

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.bump_review_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.revision=OLD.revision+1;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bump_review_revision ON public.reviews;
CREATE TRIGGER bump_review_revision BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.bump_review_revision();
REVOKE ALL ON FUNCTION public.bump_review_revision() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';


-- SOURCE: 20261011_audit_integrity.sql

-- Application triggers and administrative RPCs execute as their owner.
-- Browser roles must not manufacture arbitrary audit events through a public RPC.
REVOKE ALL ON FUNCTION public.write_audit_log(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

NOTIFY pgrst, 'reload schema';
COMMIT;
