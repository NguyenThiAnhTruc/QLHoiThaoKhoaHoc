-- Two-step certificate workflow:
-- organizer creates a certificate record, the recipient confirms its details,
-- then the organizer approves and publishes it.
BEGIN;

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'issued',
  ADD COLUMN IF NOT EXISTS confirmed_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS confirmed_organization text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text NOT NULL DEFAULT '';

UPDATE public.certificates
SET workflow_status = 'issued'
WHERE workflow_status IS NULL OR workflow_status = '';

ALTER TABLE public.certificates DROP CONSTRAINT IF EXISTS certificates_workflow_status_check;
ALTER TABLE public.certificates ADD CONSTRAINT certificates_workflow_status_check
  CHECK (workflow_status IN ('pending_confirmation', 'submitted', 'issued', 'needs_changes', 'revoked'));

CREATE OR REPLACE FUNCTION public.issue_certificates_bulk(conf_id uuid, cert_type text, recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE issued integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền tạo hồ sơ chứng nhận' USING ERRCODE = '42501';
  END IF;
  IF cert_type IS DISTINCT FROM 'attendance' THEN
    RAISE EXCEPTION 'Chứng nhận báo cáo phải chọn bài báo cụ thể' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(recipient_ids, ARRAY[]::uuid[])) r
    WHERE r IS NULL OR NOT public.is_certificate_eligible(conf_id, r, 'attendance')
  ) THEN
    RAISE EXCEPTION 'Danh sách có người chưa đủ điều kiện; chưa tạo hồ sơ nào' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.certificates(conference_id, user_id, certificate_type, issued_by, attendance_minutes, workflow_status)
    SELECT conf_id, r, 'attendance', auth.uid(), public.measured_attendance_minutes(conf_id, r), 'pending_confirmation'
    FROM (SELECT DISTINCT unnest(coalesce(recipient_ids, ARRAY[]::uuid[])) r) recipients
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS issued = ROW_COUNT;
  RETURN issued;
END $$;

CREATE OR REPLACE FUNCTION public.issue_paper_certificates(conf_id uuid, target_paper_id uuid, recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient uuid; issued integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền tạo hồ sơ chứng nhận' USING ERRCODE = '42501';
  END IF;
  FOREACH recipient IN ARRAY coalesce(recipient_ids, ARRAY[]::uuid[]) LOOP
    IF NOT public.is_paper_certificate_eligible(conf_id, recipient, target_paper_id) THEN
      RAISE EXCEPTION 'Người nhận không đủ điều kiện cho bài đã chọn';
    END IF;
    INSERT INTO public.certificates(conference_id, user_id, certificate_type, issued_by, paper_id, workflow_status)
      VALUES(conf_id, recipient, 'presentation', auth.uid(), target_paper_id, 'pending_confirmation')
      ON CONFLICT DO NOTHING;
    IF FOUND THEN issued := issued + 1; END IF;
  END LOOP;
  RETURN issued;
END $$;

CREATE INDEX IF NOT EXISTS certificates_workflow_status_idx
  ON public.certificates(workflow_status, conference_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'certificates'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.certificates';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.default_certificate_confirmation_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workflow_status = 'issued' AND NEW.issued_by IS NULL THEN
    NEW.workflow_status := 'pending_confirmation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS default_certificate_confirmation_status ON public.certificates;
CREATE TRIGGER default_certificate_confirmation_status
BEFORE INSERT ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.default_certificate_confirmation_status();

CREATE OR REPLACE FUNCTION public.mark_certificate_revoked()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN NEW.workflow_status := 'revoked'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mark_certificate_revoked ON public.certificates;
CREATE TRIGGER mark_certificate_revoked
BEFORE UPDATE OF revoked_at ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.mark_certificate_revoked();

CREATE OR REPLACE FUNCTION public.verify_certificate(lookup_number text)
RETURNS TABLE(certificate_number text, certificate_type text, issued_at timestamptz, recipient_name text, recipient_organization text, conference_title text, conference_start_date date, conference_end_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.certificate_number, c.certificate_type, c.issued_at,
    coalesce(nullif(c.confirmed_name, ''), p.full_name),
    coalesce(nullif(c.confirmed_organization, ''), p.organization),
    e.title, (e.start_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    (e.end_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  FROM public.certificates c
  JOIN public.profiles p ON p.id = c.user_id
  JOIN public.conferences e ON e.id = c.conference_id
  WHERE c.certificate_number = lookup_number
    AND c.workflow_status = 'issued' AND c.revoked_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.verify_certificate(token uuid)
RETURNS TABLE(certificate_number text, conference_title text, certificate_type text, issued_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.certificate_number, e.title, c.certificate_type, c.issued_at, c.revoked_at
  FROM public.certificates c
  JOIN public.conferences e ON e.id = c.conference_id
  WHERE c.verification_token = token AND c.workflow_status = 'issued';
$$;

DROP POLICY IF EXISTS certificates_update_confirmation ON public.certificates;

CREATE OR REPLACE FUNCTION public.submit_certificate_confirmation(
  target_certificate_id uuid,
  recipient_name text,
  recipient_organization text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recipient_name text := $2;
  v_recipient_organization text := $3;
BEGIN
  IF length(btrim(coalesce(v_recipient_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Họ tên xác nhận không hợp lệ';
  END IF;
  UPDATE public.certificates
  SET confirmed_name = btrim(v_recipient_name),
      confirmed_organization = btrim(coalesce(v_recipient_organization, '')),
      workflow_status = 'submitted',
      submitted_at = now(),
      review_notes = ''
  WHERE id = target_certificate_id
    AND user_id = auth.uid()
    AND revoked_at IS NULL
    AND workflow_status IN ('pending_confirmation', 'needs_changes', 'issued');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chứng nhận không tồn tại, không thuộc tài khoản này hoặc không còn chờ xác nhận';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_certificate_confirmation(
  target_certificate_id uuid,
  approval_note text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.certificates c
    WHERE c.id = target_certificate_id AND public.is_conference_organizer(c.conference_id)
  ) THEN
    RAISE EXCEPTION 'Bạn không có quyền duyệt chứng nhận' USING ERRCODE = '42501';
  END IF;
  UPDATE public.certificates
  SET workflow_status = 'issued',
      issued_by = auth.uid(),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = btrim(coalesce(approval_note, ''))
  WHERE id = target_certificate_id AND workflow_status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Chứng nhận chưa được tác giả gửi xác nhận'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.request_certificate_changes(
  target_certificate_id uuid,
  change_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.certificates c
    WHERE c.id = target_certificate_id AND public.is_conference_organizer(c.conference_id)
  ) THEN
    RAISE EXCEPTION 'Bạn không có quyền yêu cầu chỉnh sửa chứng nhận' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(change_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do yêu cầu chỉnh sửa';
  END IF;
  UPDATE public.certificates
  SET workflow_status = 'needs_changes',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = btrim(change_note)
  WHERE id = target_certificate_id AND workflow_status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Chứng nhận chưa được tác giả gửi xác nhận'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.submit_certificate_confirmation(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_certificate_confirmation(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_certificate_changes(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_certificate_confirmation(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_certificate_confirmation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_certificate_changes(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
