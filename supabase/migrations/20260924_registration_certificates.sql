-- Apply after 20260923_role_permissions.sql. Existing certificates are retained.
BEGIN;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS paper_id uuid REFERENCES public.papers(id) ON DELETE SET NULL;
LOCK TABLE public.participants IN SHARE ROW EXCLUSIVE MODE;

-- Private counters make slot reservation atomic, including under concurrent
-- requests. Higher isolation levels receive serialization errors, not overbooking.
CREATE TABLE IF NOT EXISTS public.conference_registration_counts (
  conference_id uuid PRIMARY KEY REFERENCES public.conferences(id) ON DELETE CASCADE,
  registered_count bigint NOT NULL DEFAULT 0 CHECK (registered_count >= 0)
);
ALTER TABLE public.conference_registration_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conference_registration_counts FROM PUBLIC, anon, authenticated;
INSERT INTO public.conference_registration_counts(conference_id, registered_count)
SELECT c.id, count(p.id) FROM public.conferences c
LEFT JOIN public.participants p ON p.conference_id = c.id GROUP BY c.id
ON CONFLICT (conference_id) DO UPDATE SET registered_count = EXCLUDED.registered_count;

CREATE OR REPLACE FUNCTION public.reserve_conference_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE capacity integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.conference_id = OLD.conference_id THEN RETURN NEW; END IF;
  -- Always lock source/destination conferences in the same order during moves.
  IF TG_OP = 'UPDATE' THEN
    PERFORM id FROM public.conferences WHERE id IN (OLD.conference_id, NEW.conference_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM id FROM public.conferences WHERE id = NEW.conference_id FOR UPDATE;
  END IF;
  SELECT max_participants INTO capacity FROM public.conferences WHERE id = NEW.conference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hội thảo không tồn tại' USING ERRCODE='23503'; END IF;
  INSERT INTO public.conference_registration_counts(conference_id) VALUES (NEW.conference_id)
  ON CONFLICT (conference_id) DO NOTHING;
  UPDATE public.conference_registration_counts SET registered_count = registered_count + 1
  WHERE conference_id = NEW.conference_id AND (capacity = 0 OR registered_count < capacity);
  IF NOT FOUND THEN RAISE EXCEPTION 'Hội thảo đã đủ số lượng người đăng ký' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.conference_registration_counts SET registered_count = registered_count - 1 WHERE conference_id = OLD.conference_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.release_conference_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conference_registration_counts SET registered_count = registered_count - 1
  WHERE conference_id = OLD.conference_id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.validate_conference_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE occupied bigint;
BEGIN
  SELECT registered_count INTO occupied FROM public.conference_registration_counts
  WHERE conference_id = NEW.id FOR UPDATE;
  IF NEW.max_participants > 0 AND NEW.max_participants < coalesce(occupied, 0) THEN
    RAISE EXCEPTION 'Sức chứa không được nhỏ hơn số người đã đăng ký' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reserve_conference_slot_trigger ON public.participants;
CREATE TRIGGER reserve_conference_slot_trigger BEFORE INSERT OR UPDATE OF conference_id ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.reserve_conference_slot();
DROP TRIGGER IF EXISTS release_conference_slot_trigger ON public.participants;
CREATE TRIGGER release_conference_slot_trigger AFTER DELETE ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.release_conference_slot();
DROP TRIGGER IF EXISTS validate_conference_capacity_trigger ON public.conferences;
CREATE TRIGGER validate_conference_capacity_trigger BEFORE UPDATE OF max_participants ON public.conferences
FOR EACH ROW EXECUTE FUNCTION public.validate_conference_capacity();
REVOKE ALL ON FUNCTION public.reserve_conference_slot(), public.release_conference_slot(), public.validate_conference_capacity() FROM PUBLIC, anon, authenticated;

-- This internal helper is shared by the picker and the write-time validation.
CREATE OR REPLACE FUNCTION public.is_certificate_eligible(conf_id uuid, recipient_id uuid, cert_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cert_type IN ('attendance', 'presentation') AND EXISTS (
    SELECT 1 FROM public.participants p WHERE p.conference_id = conf_id AND p.user_id = recipient_id AND p.attended
  ) AND (SELECT c.end_date FROM public.conferences c WHERE c.id = conf_id) <= now()
  AND (cert_type = 'attendance' OR EXISTS (
    SELECT 1 FROM public.sessions s JOIN public.papers p ON p.id = s.paper_id
    WHERE s.conference_id = conf_id AND p.conference_id = conf_id
      AND s.end_time <= now() AND p.status = 'accepted'
      AND (s.speaker_id = recipient_id OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id = p.id AND pa.user_id = recipient_id))
  ));
$$;
REVOKE ALL ON FUNCTION public.is_certificate_eligible(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_certificate_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Keep authorization errors consistent; eligibility must not reveal another
  -- conference's participant data to an unauthorized caller.
  IF auth.uid() IS NOT NULL AND NOT (public.is_admin() OR public.is_conference_organizer(NEW.conference_id)) THEN
    RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận cho hội thảo này' USING ERRCODE='42501';
  END IF;
  IF NOT public.is_certificate_eligible(NEW.conference_id, NEW.user_id, NEW.certificate_type) THEN
    RAISE EXCEPTION 'Người nhận chưa đủ điều kiện cấp chứng nhận: cần điểm danh; báo cáo cần phiên đã kết thúc và bài được chấp nhận' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_certificate_eligibility_trigger ON public.certificates;
CREATE TRIGGER validate_certificate_eligibility_trigger
BEFORE INSERT OR UPDATE OF conference_id, user_id, certificate_type ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.validate_certificate_eligibility();
REVOKE ALL ON FUNCTION public.validate_certificate_eligibility() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.certificate_eligible_recipients(conf_id uuid, cert_type text)
RETURNS TABLE(user_id uuid, full_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận cho hội thảo này' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.role FROM public.profiles p
  WHERE public.is_certificate_eligible(conf_id, p.id, cert_type)
    AND NOT EXISTS (SELECT 1 FROM public.certificates c WHERE c.conference_id = conf_id AND c.user_id = p.id AND c.certificate_type = cert_type)
  ORDER BY p.full_name, p.id;
END $$;
REVOKE ALL ON FUNCTION public.certificate_eligible_recipients(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certificate_eligible_recipients(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.certificate_recipient_status(conf_id uuid, cert_type text)
RETURNS TABLE(user_id uuid, full_name text, role text, eligible boolean, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.role,
    public.is_certificate_eligible(conf_id, p.id, cert_type),
    CASE WHEN EXISTS (SELECT 1 FROM public.certificates c WHERE c.conference_id = conf_id AND c.user_id = p.id AND c.certificate_type = cert_type) THEN 'Đã được cấp chứng nhận'
      WHEN NOT EXISTS (SELECT 1 FROM public.participants x WHERE x.conference_id = conf_id AND x.user_id = p.id) THEN 'Chưa đăng ký hội thảo'
      WHEN NOT EXISTS (SELECT 1 FROM public.participants x WHERE x.conference_id = conf_id AND x.user_id = p.id AND x.attended) THEN 'Chưa điểm danh'
      WHEN (SELECT c.end_date FROM public.conferences c WHERE c.id = conf_id) > now() THEN 'Hội thảo chưa kết thúc'
      ELSE 'Chưa đủ điều kiện theo loại chứng nhận' END
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL AND public.is_conference_organizer(conf_id)
  ORDER BY p.full_name, p.id;
$$;
REVOKE ALL ON FUNCTION public.certificate_recipient_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certificate_recipient_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_certificates_bulk(conf_id uuid, cert_type text, recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient_id uuid; issued_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận cho hội thảo này' USING ERRCODE='42501';
  END IF;
  FOREACH recipient_id IN ARRAY coalesce(recipient_ids, ARRAY[]::uuid[]) LOOP
    IF public.is_certificate_eligible(conf_id, recipient_id, cert_type)
      AND NOT EXISTS (SELECT 1 FROM public.certificates c WHERE c.conference_id = conf_id AND c.user_id = recipient_id AND c.certificate_type = cert_type) THEN
      INSERT INTO public.certificates(conference_id, user_id, certificate_type, issued_by, paper_id)
      VALUES (conf_id, recipient_id, cert_type, auth.uid(), CASE WHEN cert_type = 'presentation' THEN (
        SELECT p.id FROM public.papers p JOIN public.sessions s ON s.paper_id = p.id
        WHERE p.conference_id = conf_id AND p.status = 'accepted' AND s.end_time <= now()
          AND (s.speaker_id = recipient_id OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id = p.id AND pa.user_id = recipient_id))
        ORDER BY s.end_time DESC LIMIT 1) ELSE NULL END) ON CONFLICT DO NOTHING;
      IF FOUND THEN issued_count := issued_count + 1; END IF;
    END IF;
  END LOOP;
  RETURN issued_count;
END $$;
REVOKE ALL ON FUNCTION public.issue_certificates_bulk(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_certificates_bulk(uuid, text, uuid[]) TO authenticated;

-- Optional automatic mode: an admin can run this after/through a scheduled job.
CREATE OR REPLACE FUNCTION public.auto_issue_completed_certificates()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; u record; total integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Chỉ admin được chạy cấp chứng nhận tự động' USING ERRCODE='42501';
  END IF;
  FOR c IN SELECT id FROM public.conferences WHERE end_date <= now() AND status <> 'cancelled' LOOP
    FOR u IN SELECT p.user_id FROM public.participants p WHERE p.conference_id = c.id AND p.attended LOOP
      IF public.is_certificate_eligible(c.id, u.user_id, 'attendance') AND NOT EXISTS (
        SELECT 1 FROM public.certificates x WHERE x.conference_id = c.id AND x.user_id = u.user_id AND x.certificate_type = 'attendance') THEN
        INSERT INTO public.certificates(conference_id, user_id, certificate_type, issued_by)
        VALUES (c.id, u.user_id, 'attendance', auth.uid()) ON CONFLICT DO NOTHING;
        IF FOUND THEN total := total + 1; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.auto_issue_completed_certificates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_issue_completed_certificates() TO authenticated;

-- Run automatic issuance hourly when pg_cron is available in Supabase.
DO $$
DECLARE existing_job_id bigint;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'auto-issue-completed-certificates' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN PERFORM cron.unschedule(existing_job_id); END IF;
  PERFORM cron.schedule('auto-issue-completed-certificates', '0 * * * *',
    'SELECT public.auto_issue_completed_certificates()');
EXCEPTION WHEN undefined_file OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron is not enabled; run auto_issue_completed_certificates() manually or enable pg_cron.';
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
