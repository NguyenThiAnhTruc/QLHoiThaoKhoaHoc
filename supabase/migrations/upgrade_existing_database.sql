-- Upgrade existing ConfManager database. No initializer or demo data.
-- Generated from versioned migrations; run the whole file in Supabase SQL Editor.
BEGIN;

-- SOURCE: conference_updates.sql
-- Cập nhật database đã có schema cơ bản. Không tạo lại tài khoản demo.
-- Database mới: chạy conference_management_supabase.sql trước file này.
-- BEGIN SECTION 20260923_role_permissions
-- Apply after the conference management schema and 20260922 migrations.
-- Defaults are not validation: an API caller can explicitly supply these fields.
DROP POLICY IF EXISTS papers_insert_own ON public.papers;
CREATE POLICY papers_insert_own ON public.papers FOR INSERT TO authenticated
WITH CHECK (
  submitted_by = auth.uid()
  AND status = 'submitted'
  AND current_version = 1
  AND public.get_current_user_role() IN ('author', 'admin')
  AND EXISTS (
    SELECT 1 FROM public.conferences c WHERE c.id = conference_id
      AND c.status = 'open'
      AND (c.submission_deadline IS NULL OR now() <= c.submission_deadline)
  )
);

DROP POLICY IF EXISTS participants_insert_own ON public.participants;
CREATE POLICY participants_insert_own ON public.participants FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid() AND attended = false
  AND public.can_register_for_conference(conference_id)
);

CREATE OR REPLACE FUNCTION public.managed_conferences()
RETURNS SETOF public.conferences
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.* FROM public.conferences c
  WHERE auth.uid() IS NOT NULL AND public.is_conference_organizer(c.id)
  ORDER BY c.title;
$$;
REVOKE ALL ON FUNCTION public.managed_conferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.managed_conferences() TO authenticated;

-- A SECURITY DEFINER helper avoids recursive RLS when checking the paper owner.
-- Keep blind identities private for all readers other than owners/coauthors/staff.
CREATE OR REPLACE FUNCTION public.must_hide_paper_identity(target_paper_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id AND c.blind_review
      AND p.submitted_by IS DISTINCT FROM auth.uid()
      AND NOT public.is_conference_organizer(p.conference_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.paper_authors pa
        WHERE pa.paper_id = p.id AND pa.user_id = auth.uid()
      )
  );
$$;
REVOKE ALL ON FUNCTION public.must_hide_paper_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.must_hide_paper_identity(uuid) TO authenticated;

-- Never expose an unmasked table row (including through nested API joins).
DROP POLICY IF EXISTS papers_select_own_or_reviewer_or_organizer ON public.papers;
CREATE POLICY papers_select_own_or_reviewer_or_organizer ON public.papers
FOR SELECT TO authenticated USING (
  public.can_read_paper(id) AND NOT public.must_hide_paper_identity(id)
);
DROP POLICY IF EXISTS papers_select_accepted ON public.papers;
CREATE POLICY papers_select_accepted ON public.papers FOR SELECT TO authenticated
USING (status = 'accepted' AND NOT public.must_hide_paper_identity(id));

-- PL/pgSQL deliberately prevents SQL inlining. Mask before returning rows, so
-- API filters and FK embedding cannot be used to test hidden owner/file values.
CREATE OR REPLACE FUNCTION public.read_papers()
RETURNS SETOF public.papers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE paper_row public.papers;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  FOR paper_row IN
    SELECT p.* FROM public.papers p
    WHERE p.status = 'accepted' OR public.can_read_paper(p.id)
  LOOP
    IF public.must_hide_paper_identity(paper_row.id) THEN
      paper_row.submitted_by := NULL;
      -- Existing storage paths contain the uploader UUID. Use an opaque handle;
      -- the authenticated download function returns bytes, never that path.
      paper_row.file_url := CASE WHEN coalesce(paper_row.file_url, '') = ''
        THEN '' ELSE 'blind:' || paper_row.id::text END;
    END IF;
    RETURN NEXT paper_row;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.read_papers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_papers() TO authenticated;

-- Historical versions contain uploader IDs and identifying object paths.
DROP POLICY IF EXISTS paper_versions_select_related ON public.paper_versions;
CREATE POLICY paper_versions_select_related ON public.paper_versions
FOR SELECT TO authenticated USING (
  public.can_read_paper(paper_id) AND NOT public.must_hide_paper_identity(paper_id)
);

-- Direct storage access already joins the RLS-protected papers/versions tables.
-- This extra guard documents and enforces the boundary for the accepted policy.
DROP POLICY IF EXISTS paper_files_select_accepted ON storage.objects;
CREATE POLICY paper_files_select_accepted ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'paper-files' AND EXISTS (
    SELECT 1 FROM public.papers p WHERE p.status = 'accepted'
      AND p.file_url = name AND NOT public.must_hide_paper_identity(p.id)
  )
);

NOTIFY pgrst, 'reload schema';
-- END SECTION 20260923_role_permissions

-- BEGIN SECTION 20260924_admin_management
CREATE OR REPLACE FUNCTION public.transfer_conference_ownership(
  conference_id uuid, new_owner_id uuid, expected_owner_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_owner uuid; owner_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Chỉ admin được chuyển chủ hội thảo' USING ERRCODE = '42501';
  END IF;
  SELECT organizer_id INTO current_owner FROM public.conferences
    WHERE id = conference_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hội thảo'; END IF;
  IF current_owner IS DISTINCT FROM expected_owner_id THEN
    RAISE EXCEPTION 'Chủ hội thảo đã thay đổi. Vui lòng tải lại';
  END IF;
  IF current_owner = new_owner_id THEN RAISE EXCEPTION 'Tài khoản đã là chủ hội thảo'; END IF;
  SELECT role INTO owner_role FROM public.profiles WHERE id = new_owner_id FOR UPDATE;
  IF NOT FOUND OR owner_role NOT IN ('admin', 'organizer') THEN
    RAISE EXCEPTION 'Chủ mới phải là admin hoặc ban tổ chức';
  END IF;
  UPDATE public.conferences SET organizer_id = new_owner_id WHERE id = conference_id;
  -- An owner does not also need a duplicate staff membership.
  DELETE FROM public.conference_staff AS staff
    WHERE staff.conference_id = transfer_conference_ownership.conference_id AND user_id = new_owner_id;
  PERFORM public.write_audit_log('conference.ownership_transferred', 'conference', conference_id,
    jsonb_build_object('previous_owner_id', current_owner, 'new_owner_id', new_owner_id));
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_conference_ownership(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_conference_ownership(uuid, uuid, uuid) TO authenticated;
-- END SECTION 20260924_admin_management

-- BEGIN SECTION 20260924_conference_images
INSERT INTO storage.buckets (id, name, public)
VALUES ('conference-images', 'conference-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "conference_images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_delete_authenticated" ON storage.objects;

CREATE POLICY "conference_images_select_public"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'conference-images');

CREATE POLICY "conference_images_insert_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'conference-images' AND owner = auth.uid());

CREATE POLICY "conference_images_update_authenticated"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'conference-images' AND owner = auth.uid())
WITH CHECK (bucket_id = 'conference-images' AND owner = auth.uid());

CREATE POLICY "conference_images_delete_authenticated"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'conference-images' AND owner = auth.uid());
-- END SECTION 20260924_conference_images

-- BEGIN SECTION 20260924_conference_times
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conferences' AND column_name='start_date' AND data_type='date') THEN
    ALTER TABLE public.conferences ALTER COLUMN start_date TYPE timestamptz USING start_date::timestamptz;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conferences' AND column_name='end_date' AND data_type='date') THEN
    ALTER TABLE public.conferences ALTER COLUMN end_date TYPE timestamptz USING (end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');
  END IF;
END $$;
ALTER TABLE public.conferences DROP CONSTRAINT IF EXISTS conferences_valid_date;
ALTER TABLE public.conferences ADD CONSTRAINT conferences_valid_date CHECK (end_date >= start_date);
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260924_conference_times

-- BEGIN SECTION 20260924_participant_checkin_time
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

UPDATE public.participants
SET checked_in_at = registered_at
WHERE attended = true AND checked_in_at IS NULL;
-- END SECTION 20260924_participant_checkin_time

-- BEGIN SECTION 20260924_participant_checkin_actor
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_participant_checkin_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.attended AND NOT COALESCE(OLD.attended, false) THEN
    NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    NEW.checked_in_by := COALESCE(auth.uid(), NEW.checked_in_by);
  ELSIF NOT NEW.attended THEN
    NEW.checked_in_at := NULL;
    NEW.checked_in_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_participant_checkin_metadata_trigger ON public.participants;
CREATE TRIGGER set_participant_checkin_metadata_trigger
BEFORE INSERT OR UPDATE OF attended, checked_in_at, checked_in_by ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.set_participant_checkin_metadata();

REVOKE ALL ON FUNCTION public.set_participant_checkin_metadata() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.check_in_self(attendance_code_input text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target public.participants; event_start timestamptz; event_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập để điểm danh'; END IF;
  SELECT p.* INTO target FROM public.participants p
    WHERE p.attendance_code = btrim(attendance_code_input) AND p.user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Mã điểm danh không hợp lệ'; END IF;
  IF target.attended THEN RETURN true; END IF;
  SELECT c.start_date, c.end_date INTO event_start, event_end
    FROM public.conferences c WHERE c.id = target.conference_id;
  IF now() < event_start OR now() > event_end THEN
    RAISE EXCEPTION 'Chỉ được điểm danh trong thời gian diễn ra hội thảo';
  END IF;
  UPDATE public.participants SET attended = true, checked_in_at = now(), checked_in_by = auth.uid()
    WHERE id = target.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_self(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_self(text) TO authenticated;
-- END SECTION 20260924_participant_checkin_actor

-- BEGIN SECTION 20260924_attendance_sessions
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_session_per_conference
  ON public.attendance_sessions(conference_id);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_sessions_read ON public.attendance_sessions;
CREATE POLICY attendance_sessions_read ON public.attendance_sessions FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_conference_organizer(conference_id)
    OR EXISTS (SELECT 1 FROM public.participants p WHERE p.conference_id = attendance_sessions.conference_id AND p.user_id = auth.uid()));
REVOKE ALL ON public.attendance_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attendance_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.create_attendance_session(
  target_conference_id uuid, session_starts_at timestamptz, session_ends_at timestamptz
) RETURNS public.attendance_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.attendance_sessions;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.is_conference_organizer(target_conference_id)) THEN
    RAISE EXCEPTION 'Chỉ admin hoặc ban tổ chức được tạo phiên điểm danh' USING ERRCODE = '42501';
  END IF;
  IF session_ends_at <= session_starts_at THEN RAISE EXCEPTION 'Thời gian phiên không hợp lệ'; END IF;
  INSERT INTO public.attendance_sessions(conference_id, starts_at, ends_at, created_by)
  VALUES (target_conference_id, session_starts_at, session_ends_at, auth.uid())
  ON CONFLICT (conference_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
  RETURNING * INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_attendance_session(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_self(attendance_code_input text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.participants; sess public.attendance_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập để điểm danh'; END IF;
  SELECT * INTO sess FROM public.attendance_sessions
    WHERE code = upper(btrim(attendance_code_input)) AND now() BETWEEN starts_at AND ends_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mã điểm danh không hợp lệ hoặc phiên đã đóng'; END IF;
  SELECT * INTO target FROM public.participants
    WHERE conference_id = sess.conference_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Bạn chưa đăng ký hội thảo này'; END IF;
  IF target.attended THEN RETURN true; END IF;
  UPDATE public.participants SET attended = true, checked_in_at = now(), checked_in_by = auth.uid()
    WHERE id = target.id AND NOT attended;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.check_in_self(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_self(text) TO authenticated;
-- END SECTION 20260924_attendance_sessions

-- BEGIN SECTION 20260924_registration_certificates
-- Apply after 20260923_role_permissions.sql. Existing certificates are retained.
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
EXCEPTION WHEN undefined_file OR insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_cron is not enabled; run auto_issue_completed_certificates() manually or enable pg_cron.';
END $$;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260924_registration_certificates

-- BEGIN SECTION 20260924_reporting
-- Reporting history is append-only from database triggers, readable by admins.
CREATE TABLE IF NOT EXISTS public.reporting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('tracking_started', 'registration_cancelled', 'camera_ready')),
  conference_id uuid REFERENCES public.conferences(id) ON DELETE CASCADE,
  paper_id uuid REFERENCES public.papers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS reporting_tracking_started ON public.reporting_events(event_type) WHERE event_type = 'tracking_started';
CREATE INDEX IF NOT EXISTS reporting_events_conference_date ON public.reporting_events(conference_id, occurred_at);
ALTER TABLE public.reporting_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reporting_events_admin ON public.reporting_events;
CREATE POLICY reporting_events_admin ON public.reporting_events FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.reporting_events FROM anon, authenticated;
GRANT SELECT ON public.reporting_events TO authenticated;
INSERT INTO public.reporting_events(event_type) VALUES ('tracking_started') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.track_registration_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A cascading deletion of a conference/account is not a cancellation.
  IF EXISTS(SELECT 1 FROM public.conferences WHERE id = OLD.conference_id)
    AND EXISTS(SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    INSERT INTO public.reporting_events(event_type, conference_id, user_id, details)
    VALUES ('registration_cancelled', OLD.conference_id, OLD.user_id,
      jsonb_build_object('registration_id', OLD.id, 'registered_at', OLD.registered_at, 'attended', OLD.attended));
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS track_registration_cancellation ON public.participants;
CREATE TRIGGER track_registration_cancellation AFTER DELETE ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.track_registration_cancellation();

CREATE OR REPLACE FUNCTION public.track_camera_ready_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paper_row public.papers;
BEGIN
  SELECT * INTO paper_row FROM public.papers WHERE id = NEW.paper_id;
  -- A new manuscript version uploaded after acceptance is the final submission.
  IF paper_row.status = 'accepted' THEN
    INSERT INTO public.reporting_events(event_type, conference_id, paper_id, user_id, details)
    VALUES ('camera_ready', paper_row.conference_id, NEW.paper_id, NEW.uploaded_by,
      jsonb_build_object('version_id', NEW.id, 'version_number', NEW.version_number));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_camera_ready_submission ON public.paper_versions;
CREATE TRIGGER track_camera_ready_submission AFTER INSERT ON public.paper_versions
FOR EACH ROW EXECUTE FUNCTION public.track_camera_ready_submission();
REVOKE ALL ON FUNCTION public.track_registration_cancellation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.track_camera_ready_submission() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260924_reporting

-- BEGIN SECTION 20260925_admin_messaging
-- Ensure administrators can read and reply to every internal conversation,
-- including conversations created before this migration.
CREATE OR REPLACE FUNCTION public.can_access_conversation(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = target_conversation_id
        AND cm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_send_conversation_message(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
    OR (public.can_access_conversation(target_conversation_id)
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = target_conversation_id AND c.conversation_type = 'support'
      ));
$$;

CREATE OR REPLACE FUNCTION public.send_admin_broadcast(
  conversation_subject text,
  message_body text,
  target_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_conversation_id uuid; recipient record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only administrators can send broadcasts'; END IF;
  IF char_length(trim(conversation_subject)) = 0 OR char_length(trim(message_body)) = 0 THEN
    RAISE EXCEPTION 'Subject and message are required';
  END IF;
  IF target_role IS NOT NULL AND target_role NOT IN
    ('admin', 'organizer', 'author', 'reviewer') THEN
    RAISE EXCEPTION 'Invalid recipient role';
  END IF;
  INSERT INTO public.conversations(subject, conversation_type, created_by)
  VALUES (trim(conversation_subject), 'broadcast', auth.uid())
  RETURNING id INTO new_conversation_id;
  FOR recipient IN
    SELECT id FROM public.profiles
    WHERE target_role IS NULL OR role = target_role
  LOOP
    INSERT INTO public.conversation_members(conversation_id, user_id)
    VALUES (new_conversation_id, recipient.id) ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.messages(conversation_id, sender_id, body)
  VALUES (new_conversation_id, auth.uid(), trim(message_body));
  RETURN new_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_admin_broadcast(text, text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260925_admin_messaging

-- BEGIN SECTION 20260925_author_workflow
-- Apply after the existing conference schema and migrations.
CREATE OR REPLACE FUNCTION public.can_edit_paper_submission(target_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id AND auth.uid() IS NOT NULL AND (
      public.is_conference_organizer(p.conference_id) OR (
        p.submitted_by = auth.uid()
        AND c.status NOT IN ('cancelled', 'completed')
        AND p.status <> 'rejected'
        AND CASE WHEN p.status IN ('accepted', 'revision_required')
          THEN c.camera_ready_deadline IS NULL OR now() <= c.camera_ready_deadline
          ELSE c.submission_deadline IS NULL OR now() <= c.submission_deadline END
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_paper_submission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_paper_submission(uuid) TO authenticated;

-- Serialize author/reviewer changes on the same parent row, including direct API writes.
CREATE OR REPLACE FUNCTION public.guard_paper_author_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_id uuid;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.paper_id ELSE NEW.paper_id END;
  PERFORM 1 FROM public.papers WHERE id = target_id FOR UPDATE;
  -- Permit cascades when the parent has already been deleted.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(target_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'UPDATE' AND NEW.paper_id <> OLD.paper_id THEN
      RAISE EXCEPTION 'Không thể chuyển đồng tác giả sang bài khác';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reviews WHERE paper_id = NEW.paper_id AND reviewer_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Người đang phản biện bài này không thể là đồng tác giả';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_author_change ON public.paper_authors;
CREATE TRIGGER guard_paper_author_change BEFORE INSERT OR UPDATE OR DELETE ON public.paper_authors
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_author_change();

CREATE OR REPLACE FUNCTION public.lock_review_paper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.papers WHERE id = NEW.paper_id FOR UPDATE;
  RETURN NEW;
END;
$$;
-- Trigger names sort alphabetically: lock before existing assignment validation.
DROP TRIGGER IF EXISTS a_lock_review_paper ON public.reviews;
CREATE TRIGGER a_lock_review_paper BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.lock_review_paper();

CREATE OR REPLACE FUNCTION public.guard_paper_submission_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(OLD.id)
    AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.abstract IS DISTINCT FROM OLD.abstract
      OR NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.file_url IS DISTINCT FROM OLD.file_url
      OR NEW.current_version IS DISTINCT FROM OLD.current_version) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_submission_update ON public.papers;
CREATE TRIGGER guard_paper_submission_update BEFORE UPDATE ON public.papers
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_submission_update();

CREATE OR REPLACE FUNCTION public.guard_paper_version_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.papers WHERE id = NEW.paper_id FOR UPDATE;
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(NEW.paper_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền nộp phiên bản hoặc đã hết hạn chỉnh sửa';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_version_insert ON public.paper_versions;
CREATE TRIGGER guard_paper_version_insert BEFORE INSERT ON public.paper_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_version_insert();

-- One transaction for paper metadata, authors and version history. Invoker keeps RLS active.
-- A client-generated UUID makes retrying a lost response safe for a new submission.
CREATE OR REPLACE FUNCTION public.save_paper_submission(
  target_paper_id uuid, target_conference_id uuid, paper_title text, paper_abstract text,
  paper_keywords text, paper_file text, author_ids uuid[], version_notes text,
  expected_updated_at timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE existing public.papers; next_version integer; previous_file text; conf public.conferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập'; END IF;
  IF length(btrim(coalesce(paper_title, ''))) = 0 OR length(btrim(coalesce(paper_abstract, ''))) = 0
    OR length(btrim(coalesce(paper_file, ''))) = 0 THEN
    RAISE EXCEPTION 'Vui lòng nhập tiêu đề, tóm tắt và file bài báo';
  END IF;
  SELECT * INTO conf FROM public.conferences WHERE id = target_conference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hội thảo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_paper_id::text, 0));
  SELECT * INTO existing FROM public.papers WHERE id = target_paper_id FOR UPDATE;
  IF FOUND THEN
    IF NOT public.can_edit_paper_submission(target_paper_id) THEN
      RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
    END IF;
    IF existing.conference_id <> target_conference_id THEN RAISE EXCEPTION 'Không thể đổi hội thảo của bài'; END IF;
    IF expected_updated_at IS NOT NULL AND existing.updated_at <> expected_updated_at THEN
      RAISE EXCEPTION 'Bài báo đã thay đổi. Hãy tải lại trang trước khi lưu';
    END IF;
    -- A retry of a create request must not overwrite another existing submission.
    IF expected_updated_at IS NULL AND (existing.submitted_by <> auth.uid()
      OR existing.title IS DISTINCT FROM btrim(paper_title)
      OR existing.abstract IS DISTINCT FROM btrim(paper_abstract)
      OR existing.file_url IS DISTINCT FROM btrim(paper_file)) THEN
      RAISE EXCEPTION 'Bài đã tồn tại. Hãy tải lại trang trước khi lưu';
    END IF;
  END IF;
  IF paper_file !~* '^https?://[^[:space:]]+$' THEN
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'paper-files'
      AND o.name = paper_file AND (o.owner = auth.uid() OR paper_file = existing.file_url)) THEN
      RAISE EXCEPTION 'File không hợp lệ hoặc bạn không có quyền sử dụng file này';
    END IF;
  ELSIF conf.blind_review THEN
    RAISE EXCEPTION 'Hội thảo phản biện ẩn danh yêu cầu tải lên file PDF';
  END IF;
  IF existing.id IS NULL THEN
    INSERT INTO public.papers (id, conference_id, title, abstract, keywords, file_url)
    VALUES (target_paper_id, target_conference_id, btrim(paper_title), btrim(paper_abstract), btrim(paper_keywords), btrim(paper_file));
  ELSE
    UPDATE public.papers SET title = btrim(paper_title), abstract = btrim(paper_abstract),
      keywords = btrim(paper_keywords), file_url = btrim(paper_file) WHERE id = target_paper_id;
  END IF;
  PERFORM public.replace_paper_authors(target_paper_id, author_ids);
  SELECT version_number, file_url INTO next_version, previous_file FROM public.paper_versions
    WHERE paper_id = target_paper_id ORDER BY version_number DESC LIMIT 1;
  IF previous_file IS DISTINCT FROM btrim(paper_file) THEN
    next_version := coalesce(next_version, 0) + 1;
    INSERT INTO public.paper_versions (paper_id, version_number, file_url, notes)
      VALUES (target_paper_id, next_version, btrim(paper_file), btrim(version_notes));
  END IF;
  UPDATE public.papers SET current_version = next_version WHERE id = target_paper_id;
  RETURN target_paper_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_paper_submission(uuid, uuid, text, text, text, text, uuid[], text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_paper_submission(uuid, uuid, text, text, text, text, uuid[], text, timestamptz) TO authenticated;

-- Published versions are immutable. Authors upload a new object for each revision.
CREATE OR REPLACE FUNCTION public.paper_file_is_referenced(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers WHERE file_url = object_name
    OR file_url LIKE '%/storage/v1/object/public/paper-files/' || object_name)
  OR EXISTS (SELECT 1 FROM public.paper_versions WHERE file_url = object_name
    OR file_url LIKE '%/storage/v1/object/public/paper-files/' || object_name);
$$;
REVOKE ALL ON FUNCTION public.paper_file_is_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paper_file_is_referenced(text) TO authenticated;
DROP POLICY IF EXISTS paper_files_protect_versions_update ON storage.objects;
CREATE POLICY paper_files_protect_versions_update ON storage.objects AS RESTRICTIVE
FOR UPDATE TO authenticated USING (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name))
WITH CHECK (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name));
DROP POLICY IF EXISTS paper_files_protect_versions_delete ON storage.objects;
CREATE POLICY paper_files_protect_versions_delete ON storage.objects AS RESTRICTIVE
FOR DELETE TO authenticated USING (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name));

CREATE OR REPLACE FUNCTION public.notify_paper_authors_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_id uuid; recipient uuid; heading text; body text; paper_title text;
BEGIN
  IF TG_TABLE_NAME = 'papers' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    target_id := NEW.id;
    heading := 'Cập nhật kết quả bài báo';
    body := CASE NEW.status WHEN 'accepted' THEN 'Đã chấp nhận'
      WHEN 'rejected' THEN 'Đã từ chối' WHEN 'revision_required' THEN 'Cần sửa đổi'
      WHEN 'under_review' THEN 'Đang phản biện' ELSE 'Đã nộp' END;
  ELSE
    IF NEW.status <> 'completed' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    target_id := NEW.paper_id;
    heading := 'Có kết quả phản biện mới';
    body := 'Một phản biện đã hoàn thành. Bạn có thể xem nhận xét tại trang chi tiết bài báo';
  END IF;
  SELECT title INTO paper_title FROM public.papers WHERE id = target_id;
  FOR recipient IN SELECT submitted_by FROM public.papers WHERE id = target_id
    UNION SELECT user_id FROM public.paper_authors WHERE paper_id = target_id
  LOOP
    PERFORM public.create_notification(recipient, heading, 'Bài báo "' || paper_title || '": ' || body, 'info', 'reviews');
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notify_paper_status ON public.papers;
CREATE TRIGGER notify_paper_status AFTER UPDATE OF status ON public.papers
FOR EACH ROW EXECUTE FUNCTION public.notify_paper_authors_result();
DROP TRIGGER IF EXISTS notify_paper_review_completed ON public.reviews;
CREATE TRIGGER notify_paper_review_completed AFTER UPDATE OF status ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.notify_paper_authors_result();

REVOKE ALL ON FUNCTION public.guard_paper_author_change(), public.lock_review_paper(),
  public.guard_paper_submission_update(), public.guard_paper_version_insert(), public.notify_paper_authors_result() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260925_author_workflow

-- BEGIN SECTION 20260925_participant_contact_email
-- Organizers need a contact address when managing registrations. Expose the
-- profile contact email through the safe directory view; auth emails remain
-- outside the public profiles schema.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';

-- Backfill existing profiles from Supabase Auth where possible. Future profile
-- edits can keep this contact value up to date without exposing auth.users.
UPDATE public.profiles p
SET contact_email = COALESCE(NULLIF(p.contact_email, ''), u.email, '')
FROM auth.users u
WHERE u.id = p.id AND COALESCE(p.contact_email, '') = '';

DROP VIEW IF EXISTS public.profile_directory;
CREATE VIEW public.profile_directory AS
SELECT id, full_name, role, organization, avatar_url, contact_email AS email,
       created_at, updated_at
FROM public.profiles;
REVOKE ALL ON public.profile_directory FROM PUBLIC;
GRANT SELECT ON public.profile_directory TO authenticated;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260925_participant_contact_email

-- BEGIN SECTION 20260925_reviewer_workflow
-- Apply after 20260925_author_workflow.sql.
UPDATE public.profiles SET role = 'author' WHERE role = 'participant';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','organizer','author','reviewer'));
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.reviewer_id AND role = 'reviewer') THEN
    RAISE EXCEPTION 'Tài khoản không đủ điều kiện phản biện';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS require_author_reviewer_trigger ON public.reviews;
CREATE TRIGGER require_author_reviewer_trigger BEFORE INSERT OR UPDATE OF reviewer_id ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.require_author_reviewer();
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('assigned','in_progress','completed','declined'));
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS response_at timestamptz;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.can_read_paper_review_results(target_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p WHERE p.id=target_paper_id AND (
      public.is_conference_organizer(p.conference_id) OR p.submitted_by=auth.uid()
      OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id=p.id AND pa.user_id=auth.uid())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_paper_review_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_paper_review_results(uuid) TO authenticated;
DROP POLICY IF EXISTS reviews_select_reviewer_or_author_or_organizer ON public.reviews;
CREATE POLICY reviews_select_reviewer_or_author_or_organizer ON public.reviews FOR SELECT TO authenticated
USING (reviewer_id=auth.uid() OR public.can_read_paper_review_results(paper_id));

CREATE OR REPLACE FUNCTION public.guard_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công mới phải chờ xác nhận'; END IF;
    NEW.response_at := NULL; NEW.decline_reason := '';
  ELSE
    IF NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id OR NEW.paper_id IS DISTINCT FROM OLD.paper_id THEN
      RAISE EXCEPTION 'Hãy xóa phân công cũ và tạo lời mời mới để đổi người phản biện';
    END IF;
    NEW.assigned_at := OLD.assigned_at;
    NEW.completed_at := OLD.completed_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status='assigned' AND NEW.status IN ('in_progress','declined') THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được nhận hoặc từ chối'; END IF;
        NEW.response_at := now();
        IF NEW.status='declined' AND length(btrim(NEW.decline_reason))=0 THEN RAISE EXCEPTION 'Vui lòng nhập lý do từ chối'; END IF;
        IF NEW.status='in_progress' THEN NEW.decline_reason := ''; END IF;
      ELSIF OLD.status='in_progress' AND NEW.status='completed' THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được gửi đánh giá'; END IF;
        NEW.completed_at := now();
        NEW.response_at := OLD.response_at; NEW.decline_reason := OLD.decline_reason;
      ELSE
        RAISE EXCEPTION 'Chuyển trạng thái phản biện không hợp lệ';
      END IF;
    ELSE
      NEW.response_at := OLD.response_at;
      NEW.decline_reason := OLD.decline_reason;
    END IF;
    IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Đánh giá đã hoàn thành không thể sửa'; END IF;
  END IF;
  IF NEW.status IN ('assigned','declined') AND (NEW.score IS NOT NULL OR NEW.recommendation IS NOT NULL
    OR length(btrim(coalesce(NEW.comments,'')))>0 OR NEW.originality_score IS NOT NULL
    OR NEW.relevance_score IS NOT NULL OR NEW.methodology_score IS NOT NULL OR NEW.presentation_score IS NOT NULL
    OR NEW.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Phải nhận phân công trước khi đánh giá';
  END IF;
  IF NEW.status='completed' AND (NEW.score IS NULL OR NEW.recommendation IS NULL OR length(btrim(coalesce(NEW.comments,'')))=0) THEN
    RAISE EXCEPTION 'Vui lòng nhập điểm, khuyến nghị và nhận xét';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_review_response ON public.reviews;
CREATE TRIGGER guard_review_response BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.guard_review_response();

CREATE OR REPLACE FUNCTION public.respond_review_assignment(target_review_id uuid, accept_assignment boolean, reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE target public.reviews;
BEGIN
  IF auth.uid() IS NULL OR accept_assignment IS NULL THEN RAISE EXCEPTION 'Yêu cầu không hợp lệ'; END IF;
  SELECT * INTO target FROM public.reviews WHERE id=target_review_id FOR UPDATE;
  IF NOT FOUND OR target.reviewer_id <> auth.uid() THEN RAISE EXCEPTION 'Bạn không có quyền phản hồi phân công này'; END IF;
  IF target.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công đã được phản hồi. Vui lòng tải lại'; END IF;
  UPDATE public.reviews SET status=CASE WHEN accept_assignment THEN 'in_progress' ELSE 'declined' END,
    decline_reason=CASE WHEN accept_assignment THEN '' ELSE btrim(coalesce(reason,'')) END WHERE id=target_review_id;
END; $$;
REVOKE ALL ON FUNCTION public.respond_review_assignment(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_review_assignment(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; conf uuid; paper_title text; reviewer_name text;
BEGIN
  IF OLD.status <> 'assigned' OR NEW.status NOT IN ('in_progress','declined') THEN RETURN NEW; END IF;
  SELECT conference_id,title INTO conf,paper_title FROM public.papers WHERE id=NEW.paper_id;
  SELECT full_name INTO reviewer_name FROM public.profiles WHERE id=NEW.reviewer_id;
  FOR recipient IN SELECT id FROM public.profiles WHERE role='admin'
    UNION SELECT organizer_id FROM public.conferences WHERE id=conf
    UNION SELECT user_id FROM public.conference_staff WHERE conference_id=conf
  LOOP
    PERFORM public.create_notification(recipient, CASE WHEN NEW.status='declined' THEN 'Phản biện từ chối phân công' ELSE 'Phản biện đã nhận phân công' END,
      coalesce(reviewer_name,'Người phản biện') || ' — ' || paper_title || CASE WHEN NEW.status='declined' THEN ': ' || NEW.decline_reason ELSE '' END,'info','reviews');
  END LOOP;
  PERFORM public.write_audit_log('review.' || NEW.status,'review',NEW.id,jsonb_build_object('paper_id',NEW.paper_id,'reason',NEW.decline_reason));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_review_response ON public.reviews;
CREATE TRIGGER notify_review_response AFTER UPDATE OF status ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_review_response();
REVOKE ALL ON FUNCTION public.guard_review_response(), public.notify_review_response() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260925_reviewer_workflow

-- BEGIN SECTION 20260926_conference_field_backfill
-- Phân loại 10 hội thảo mẫu theo danh sách lĩnh vực/chủ đề của form.
-- Chạy sau các file seed. Có thể chạy lại, không thay đổi lịch hay trạng thái.
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE public.conferences DROP CONSTRAINT IF EXISTS conferences_field_check;
ALTER TABLE public.conferences ADD CONSTRAINT conferences_field_check CHECK (
  field IS NULL OR field IN (
    'Công nghệ thông tin', 'Kỹ thuật', 'Khoa học tự nhiên', 'Y tế',
    'Nông nghiệp', 'Môi trường', 'Kinh tế', 'Kinh doanh',
    'Giáo dục', 'Luật', 'Khoa học xã hội', 'Du lịch'
  )
);
COMMENT ON COLUMN public.conferences.field IS 'Lĩnh vực chính của hội thảo';

UPDATE public.conferences AS conference
SET field = mapping.field,
    topics = mapping.topics
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu']),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Kỹ thuật phần mềm', 'Trí tuệ nhân tạo']),
  ('a1000000-0000-0000-0000-000000000001'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo']),
  ('a1000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo']),
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'Giáo dục',
    ARRAY['Công nghệ giáo dục', 'Phương pháp giảng dạy']),
  ('c0000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu']),
  ('c0000000-0000-0000-0000-000000000003'::uuid, 'Công nghệ thông tin',
    ARRAY['An toàn thông tin', 'Điện toán đám mây']),
  ('c0000000-0000-0000-0000-000000000004'::uuid, 'Công nghệ thông tin',
    ARRAY['IoT']),
  ('c0000000-0000-0000-0000-000000000005'::uuid, 'Công nghệ thông tin',
    ARRAY['Kỹ thuật phần mềm']),
  ('c0000000-0000-0000-0000-000000000006'::uuid, 'Kỹ thuật',
    ARRAY['Robot', 'Tự động hóa'])
) AS mapping(id, field, topics)
WHERE conference.id = mapping.id
  AND (conference.field IS DISTINCT FROM mapping.field
    OR conference.topics IS DISTINCT FROM mapping.topics);

NOTIFY pgrst, 'reload schema';
-- END SECTION 20260926_conference_field_backfill

-- BEGIN SECTION 20260927_author_conference_papers
-- Read papers for a conference through one authorized database path.
-- Authors can see their own/co-authored papers and accepted papers only.
CREATE OR REPLACE FUNCTION public.read_conference_papers(target_conference_id uuid)
RETURNS SETOF public.papers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paper_row public.papers;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  FOR paper_row IN
    SELECT p.*
    FROM public.papers AS p
    WHERE p.conference_id = target_conference_id
      AND (p.status = 'accepted' OR public.can_read_paper(p.id))
  LOOP
    IF public.must_hide_paper_identity(paper_row.id) THEN
      paper_row.submitted_by := NULL;
      paper_row.file_url := CASE WHEN coalesce(paper_row.file_url, '') = ''
        THEN '' ELSE 'blind:' || paper_row.id::text END;
    END IF;
    RETURN NEXT paper_row;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.read_conference_papers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_conference_papers(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- END SECTION 20260927_author_conference_papers

-- BEGIN SECTION 20260927_reviewer_signup
-- Allow reviewer self-registration while keeping staff roles restricted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'author'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
-- END SECTION 20260927_reviewer_signup

-- BEGIN SECTION 20260927_conference_paper_catalog
-- Metadata visible to signed-in visitors of a visible conference.
-- File paths, author identities and review results retain their existing access rules.
CREATE OR REPLACE FUNCTION public.conference_paper_catalog(target_conference_id uuid)
RETURNS TABLE (
  id uuid, title text, abstract text, status text,
  created_at timestamptz, can_open boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.title, p.abstract, p.status, p.created_at,
    (p.status = 'accepted' OR public.can_read_paper(p.id))
  FROM public.papers p
  JOIN public.conferences c ON c.id = p.conference_id
  WHERE auth.uid() IS NOT NULL
    AND c.id = target_conference_id
    AND (c.status <> 'draft' OR public.is_conference_organizer(c.id))
  ORDER BY p.created_at DESC, p.id;
$$;
REVOKE ALL ON FUNCTION public.conference_paper_catalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conference_paper_catalog(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20260927_conference_paper_catalog

-- BEGIN SECTION 20261008_conference_topics
CREATE TABLE IF NOT EXISTS public.conference_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conference_id, name)
);
CREATE TABLE IF NOT EXISTS public.paper_topics (
  paper_id uuid NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.conference_topics(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, topic_id)
);
INSERT INTO public.conference_topics(conference_id, name)
SELECT c.id, btrim(legacy.topic)
FROM public.conferences c
CROSS JOIN LATERAL unnest(coalesce(c.topics, ARRAY[]::text[])) AS legacy(topic)
WHERE btrim(legacy.topic) <> ''
ON CONFLICT (conference_id, name) DO NOTHING;
ALTER TABLE public.conference_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conference_topics_read ON public.conference_topics;
CREATE POLICY conference_topics_read ON public.conference_topics FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conferences c WHERE c.id = conference_id
    AND (c.status <> 'draft' OR public.is_conference_organizer(c.id)))
);
DROP POLICY IF EXISTS conference_topics_manage ON public.conference_topics;
CREATE POLICY conference_topics_manage ON public.conference_topics FOR ALL TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id));
DROP POLICY IF EXISTS paper_topics_read ON public.paper_topics;
CREATE POLICY paper_topics_read ON public.paper_topics FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.papers p WHERE p.id = paper_id AND public.can_read_paper(p.id))
  OR EXISTS (SELECT 1 FROM public.conference_topics t WHERE t.id = topic_id AND public.is_conference_organizer(t.conference_id))
);
DROP POLICY IF EXISTS paper_topics_manage ON public.paper_topics;
CREATE POLICY paper_topics_manage ON public.paper_topics FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.papers p WHERE p.id = paper_id
  AND (p.submitted_by = auth.uid() OR public.is_conference_organizer(p.conference_id))))
WITH CHECK (EXISTS (SELECT 1 FROM public.papers p
  JOIN public.conference_topics t ON t.conference_id = p.conference_id
  WHERE p.id = paper_id AND t.id = topic_id
    AND (p.submitted_by = auth.uid() OR public.is_conference_organizer(p.conference_id))));
CREATE INDEX IF NOT EXISTS idx_conference_topics_conference ON public.conference_topics(conference_id);
CREATE INDEX IF NOT EXISTS idx_paper_topics_topic ON public.paper_topics(topic_id);
NOTIFY pgrst, 'reload schema';
-- END SECTION 20261008_conference_topics

-- BEGIN SECTION 20261008_session_committees
CREATE TABLE IF NOT EXISTS public.conference_committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  room text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conference_id, name)
);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS committee_id uuid REFERENCES public.conference_committees(id) ON DELETE SET NULL;
ALTER TABLE public.conference_committees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conference_committees_read ON public.conference_committees;
CREATE POLICY conference_committees_read ON public.conference_committees FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conferences c WHERE c.id = conference_id
    AND (c.status <> 'draft' OR public.is_conference_organizer(c.id)))
);
DROP POLICY IF EXISTS conference_committees_manage ON public.conference_committees;
CREATE POLICY conference_committees_manage ON public.conference_committees FOR ALL TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id));
CREATE INDEX IF NOT EXISTS idx_conference_committees_conference ON public.conference_committees(conference_id);
CREATE INDEX IF NOT EXISTS idx_sessions_committee ON public.sessions(committee_id);
NOTIFY pgrst, 'reload schema';
-- END SECTION 20261008_session_committees

-- BEGIN SECTION 20261008_paper_author_participation
ALTER TABLE public.paper_authors
  ADD COLUMN IF NOT EXISTS participation_status text NOT NULL DEFAULT 'participating';
ALTER TABLE public.paper_authors
  DROP CONSTRAINT IF EXISTS paper_authors_participation_status_check;
ALTER TABLE public.paper_authors
  ADD CONSTRAINT paper_authors_participation_status_check
  CHECK (participation_status IN ('participating', 'not_participating'));
DROP POLICY IF EXISTS paper_authors_update_paper_owner ON public.paper_authors;
CREATE POLICY paper_authors_update_paper_owner ON public.paper_authors
FOR UPDATE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.papers p WHERE p.id = paper_id AND p.submitted_by = auth.uid()
)) WITH CHECK (EXISTS (
  SELECT 1 FROM public.papers p WHERE p.id = paper_id AND p.submitted_by = auth.uid()
));
NOTIFY pgrst, 'reload schema';
-- END SECTION 20261008_paper_author_participation

-- BEGIN SECTION 20261008_conference_funding
CREATE TABLE IF NOT EXISTS public.conference_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES public.conference_funds(id) ON DELETE CASCADE,
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  purpose text NOT NULL DEFAULT '',
  proof_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conference_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conference_funds_read ON public.conference_funds;
CREATE POLICY conference_funds_read ON public.conference_funds FOR SELECT TO authenticated USING (
  public.is_conference_organizer(conference_id) OR EXISTS (
    SELECT 1 FROM public.conferences c WHERE c.id = conference_id AND c.status <> 'draft'
  )
);
DROP POLICY IF EXISTS conference_funds_manage ON public.conference_funds;
CREATE POLICY conference_funds_manage ON public.conference_funds FOR ALL TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS fee_payments_read ON public.fee_payments;
CREATE POLICY fee_payments_read ON public.fee_payments FOR SELECT TO authenticated USING (
  payer_id = auth.uid() OR public.is_conference_organizer(conference_id)
);
DROP POLICY IF EXISTS fee_payments_insert ON public.fee_payments;
CREATE POLICY fee_payments_insert ON public.fee_payments FOR INSERT TO authenticated WITH CHECK (
  payer_id = auth.uid() AND status = 'pending'
  AND EXISTS (SELECT 1 FROM public.conference_funds f WHERE f.id = fund_id AND f.conference_id = conference_id)
);
DROP POLICY IF EXISTS fee_payments_review ON public.fee_payments;
CREATE POLICY fee_payments_review ON public.fee_payments FOR UPDATE TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id));
CREATE INDEX IF NOT EXISTS idx_conference_funds_conference ON public.conference_funds(conference_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_conference ON public.fee_payments(conference_id);
NOTIFY pgrst, 'reload schema';
-- END SECTION 20261008_conference_funding

-- BEGIN SECTION 20261008_certificate_signatures
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS signature_hash text;
CREATE OR REPLACE FUNCTION public.set_certificate_signature_hash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.signature_hash := md5(concat_ws('|', NEW.certificate_number, NEW.conference_id::text,
    NEW.user_id::text, NEW.certificate_type, coalesce(NEW.paper_id::text, '')));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS set_certificate_signature_hash_trigger ON public.certificates;
CREATE TRIGGER set_certificate_signature_hash_trigger
BEFORE INSERT OR UPDATE OF certificate_number, conference_id, user_id, certificate_type, paper_id
ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.set_certificate_signature_hash();
UPDATE public.certificates SET signature_hash = md5(concat_ws('|', certificate_number,
  conference_id::text, user_id::text, certificate_type, coalesce(paper_id::text, '')))
WHERE signature_hash IS NULL;
REVOKE ALL ON FUNCTION public.set_certificate_signature_hash() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
-- END SECTION 20261008_certificate_signatures


-- SOURCE: 20260927_paper_status_consistency.sql
-- Giữ trạng thái bài báo đồng bộ với dữ liệu phản biện.
-- Có thể chạy lại an toàn trên database hiện có.

-- Sửa dữ liệu cũ: không được có kết quả nếu chưa có phản biện hoàn tất.
UPDATE public.papers AS paper
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id
      AND review.status IN ('assigned', 'in_progress', 'completed')
  ) THEN 'under_review'
  ELSE 'submitted'
END
WHERE paper.status IN ('accepted', 'rejected', 'revision_required')
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id AND review.status = 'completed'
  );

UPDATE public.papers AS paper
SET status = 'submitted'
WHERE paper.status = 'under_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id
      AND review.status IN ('assigned', 'in_progress', 'completed')
  );

CREATE OR REPLACE FUNCTION public.guard_paper_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_conference_organizer(OLD.conference_id) THEN
    RAISE EXCEPTION 'Chỉ ban tổ chức được thay đổi trạng thái bài báo';
  END IF;

  IF OLD.status IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Bài báo đã có quyết định cuối cùng';
  END IF;

  IF NEW.status = 'under_review' AND NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE paper_id = OLD.id AND status IN ('assigned', 'in_progress', 'completed')
  ) THEN
    RAISE EXCEPTION 'Cần phân công ít nhất một người phản biện trước';
  END IF;

  IF NEW.status IN ('accepted', 'rejected', 'revision_required') AND NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE paper_id = OLD.id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Cần ít nhất một phản biện hoàn thành trước khi ra kết quả';
  END IF;

  IF NOT (
    (OLD.status = 'submitted' AND NEW.status = 'under_review')
    OR (OLD.status = 'under_review' AND NEW.status IN ('accepted', 'rejected', 'revision_required'))
    OR (OLD.status = 'revision_required' AND NEW.status = 'under_review')
  ) THEN
    RAISE EXCEPTION 'Chuyển trạng thái bài báo không hợp lệ';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_paper_status_transition ON public.papers;
CREATE TRIGGER guard_paper_status_transition
BEFORE UPDATE OF status ON public.papers
FOR EACH ROW
EXECUTE FUNCTION public.guard_paper_status_transition();

CREATE OR REPLACE FUNCTION public.start_paper_review_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.papers
  SET status = 'under_review'
  WHERE id = NEW.paper_id AND status = 'submitted';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS start_paper_review_on_assignment ON public.reviews;
CREATE TRIGGER start_paper_review_on_assignment
AFTER INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.start_paper_review_on_assignment();

REVOKE ALL ON FUNCTION public.guard_paper_status_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_paper_review_on_assignment() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';


-- SOURCE: 20260927_disable_blind_review.sql
-- Tắt hoàn toàn chế độ phản biện ẩn danh nhưng giữ cột cũ để tương thích.

UPDATE public.conferences
SET blind_review = false
WHERE blind_review;

CREATE OR REPLACE FUNCTION public.disable_blind_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.blind_review := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS disable_blind_review ON public.conferences;
CREATE TRIGGER disable_blind_review
BEFORE INSERT OR UPDATE OF blind_review ON public.conferences
FOR EACH ROW
EXECUTE FUNCTION public.disable_blind_review();

-- Hàm cũ vẫn tồn tại để các policy đã triển khai không bị lỗi, nhưng không
-- còn che tác giả hoặc đường dẫn file.
CREATE OR REPLACE FUNCTION public.must_hide_paper_identity(target_paper_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT false;
$$;

REVOKE ALL ON FUNCTION public.disable_blind_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.must_hide_paper_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.must_hide_paper_identity(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- SOURCE: 20261008_complete_workflows.sql
-- Apply after conference_updates.sql and the 20260927 status patch.
-- No demo accounts or conference data are deleted.

ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS require_accepted_paper boolean NOT NULL DEFAULT false;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS problem_statement text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS objectives text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS author_group text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS corresponding_author_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS author_participation_status text NOT NULL DEFAULT 'participating';
ALTER TABLE public.papers DROP CONSTRAINT IF EXISTS papers_author_participation_check;
ALTER TABLE public.papers ADD CONSTRAINT papers_author_participation_check CHECK(author_participation_status IN ('participating','not_participating'));
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES public.sessions(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sessions_parent_idx ON public.sessions(parent_session_id);
ALTER TABLE public.conference_topics ALTER COLUMN created_by SET DEFAULT auth.uid();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conference_topics,public.paper_topics,public.conference_committees,public.conference_funds,public.fee_payments TO authenticated;
DROP POLICY IF EXISTS paper_authors_update_paper_owner ON public.paper_authors;
CREATE POLICY paper_authors_update_paper_owner ON public.paper_authors FOR UPDATE TO authenticated
USING(public.can_edit_paper_submission(paper_id)) WITH CHECK(public.can_edit_paper_submission(paper_id));
DROP POLICY IF EXISTS paper_topics_manage ON public.paper_topics;
CREATE POLICY paper_topics_manage ON public.paper_topics FOR ALL TO authenticated
USING(public.can_edit_paper_submission(paper_id)) WITH CHECK(public.can_edit_paper_submission(paper_id)
  AND EXISTS(SELECT 1 FROM public.papers p JOIN public.conference_topics t ON t.conference_id=p.conference_id WHERE p.id=paper_id AND t.id=topic_id));
CREATE OR REPLACE FUNCTION public.guard_paper_submission_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(OLD.id)
    AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.abstract IS DISTINCT FROM OLD.abstract
      OR NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.file_url IS DISTINCT FROM OLD.file_url
      OR NEW.current_version IS DISTINCT FROM OLD.current_version
      OR NEW.problem_statement IS DISTINCT FROM OLD.problem_statement OR NEW.objectives IS DISTINCT FROM OLD.objectives
      OR NEW.author_group IS DISTINCT FROM OLD.author_group OR NEW.corresponding_author_id IS DISTINCT FROM OLD.corresponding_author_id
      OR NEW.author_participation_status IS DISTINCT FROM OLD.author_participation_status) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.is_session_author(target_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sessions s JOIN public.papers p ON p.id=s.paper_id
    WHERE (s.id=target_session_id OR s.parent_session_id=target_session_id)
      AND (s.speaker_id=auth.uid() OR p.submitted_by=auth.uid()
        OR EXISTS(SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid())));
$$;
REVOKE ALL ON FUNCTION public.is_session_author(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_session_author(uuid) TO authenticated;
DROP POLICY IF EXISTS sessions_select_author ON public.sessions;
CREATE POLICY sessions_select_author ON public.sessions FOR SELECT TO authenticated USING(public.is_session_author(id));

-- Keep all submission details in the same transaction; retain the original RPC
-- for older clients, but the new UI uses this complete operation.
CREATE OR REPLACE FUNCTION public.save_complete_paper_submission(
  target_paper_id uuid, target_conference_id uuid, paper_title text, paper_abstract text,
  paper_keywords text, paper_file text, author_ids uuid[], version_notes text,
  expected_updated_at timestamptz, topic_ids uuid[], participation jsonb,
  problem text, goals text, group_name text, main_author_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE saved uuid; member_id uuid; submitter uuid;
BEGIN
  IF btrim(coalesce(paper_keywords,'')) = '' THEN RAISE EXCEPTION 'Vui lòng nhập từ khóa'; END IF;
  IF main_author_id IS NULL OR NOT (main_author_id = coalesce((SELECT submitted_by FROM public.papers WHERE id=target_paper_id),auth.uid()) OR main_author_id = ANY(coalesce(author_ids, ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION 'Tác giả chính phải thuộc nhóm tác giả';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(topic_ids,ARRAY[]::uuid[])) x(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.conference_topics t WHERE t.id=x.id AND t.conference_id=target_conference_id)) THEN
    RAISE EXCEPTION 'Chủ đề không thuộc hội thảo';
  END IF;
  saved := public.save_paper_submission(target_paper_id,target_conference_id,paper_title,paper_abstract,
    paper_keywords,paper_file,author_ids,version_notes,expected_updated_at);
  SELECT submitted_by INTO submitter FROM public.papers WHERE id=saved;
  UPDATE public.papers SET problem_statement=btrim(coalesce(problem,'')), objectives=btrim(coalesce(goals,'')),
    author_group=btrim(coalesce(group_name,'')), corresponding_author_id=main_author_id,
    author_participation_status=coalesce(participation->>submitter::text,'participating') WHERE id=saved;
  DELETE FROM public.paper_topics WHERE paper_id=saved;
  INSERT INTO public.paper_topics(paper_id,topic_id) SELECT saved,id FROM unnest(coalesce(topic_ids,ARRAY[]::uuid[])) x(id) GROUP BY id;
  FOREACH member_id IN ARRAY coalesce(author_ids,ARRAY[]::uuid[]) LOOP
    IF coalesce(participation->>member_id::text,'participating') NOT IN ('participating','not_participating') THEN
      RAISE EXCEPTION 'Trạng thái tham gia không hợp lệ';
    END IF;
    UPDATE public.paper_authors SET participation_status=coalesce(participation->>member_id::text,'participating')
      WHERE paper_id=saved AND user_id=member_id;
  END LOOP;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_complete_paper_submission(uuid,uuid,text,text,text,text,uuid[],text,timestamptz,uuid[],jsonb,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_complete_paper_submission(uuid,uuid,text,text,text,text,uuid[],text,timestamptz,uuid[],jsonb,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_paper_status_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE enabled boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.is_conference_organizer(OLD.conference_id) THEN RAISE EXCEPTION 'Chỉ ban tổ chức được thay đổi trạng thái bài báo'; END IF;
  IF OLD.status IN ('accepted','rejected') THEN RAISE EXCEPTION 'Bài báo đã có quyết định cuối cùng'; END IF;
  SELECT review_enabled INTO enabled FROM public.conferences WHERE id=OLD.conference_id;
  IF NOT enabled THEN
    IF NEW.status NOT IN ('accepted','rejected','revision_required') THEN RAISE EXCEPTION 'Hội thảo không sử dụng phản biện'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status='under_review' AND NOT EXISTS (SELECT 1 FROM public.reviews WHERE paper_id=OLD.id AND status IN ('assigned','in_progress','completed')) THEN
    RAISE EXCEPTION 'Cần phân công ít nhất một người phản biện trước'; END IF;
  IF NEW.status IN ('accepted','rejected','revision_required') AND NOT EXISTS (SELECT 1 FROM public.reviews WHERE paper_id=OLD.id AND status='completed') THEN
    RAISE EXCEPTION 'Cần ít nhất một phản biện hoàn thành trước khi ra kết quả'; END IF;
  IF NOT ((OLD.status='submitted' AND NEW.status='under_review') OR
    (OLD.status='under_review' AND NEW.status IN ('accepted','rejected','revision_required')) OR
    (OLD.status='revision_required' AND NEW.status='under_review')) THEN RAISE EXCEPTION 'Chuyển trạng thái bài báo không hợp lệ'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_paper_status_transition ON public.papers;
CREATE TRIGGER guard_paper_status_transition BEFORE UPDATE OF status ON public.papers FOR EACH ROW EXECUTE FUNCTION public.guard_paper_status_transition();
CREATE OR REPLACE FUNCTION public.require_review_enabled() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id WHERE p.id=NEW.paper_id AND c.review_enabled) THEN
    RAISE EXCEPTION 'Hội thảo đã tắt phản biện'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS require_review_enabled ON public.reviews;
CREATE TRIGGER require_review_enabled BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.require_review_enabled();

-- Authors may be required to have an accepted submission before registration.
CREATE OR REPLACE FUNCTION public.can_register_for_conference(conf_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conferences c WHERE c.id=conf_id AND c.status='open'
    AND (c.registration_deadline IS NULL OR now()<=c.registration_deadline)
    AND (c.max_participants=0 OR (SELECT count(*) FROM public.participants p WHERE p.conference_id=c.id)<c.max_participants)
    AND (NOT c.require_accepted_paper OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='author')
      OR EXISTS (SELECT 1 FROM public.papers p WHERE p.conference_id=c.id AND p.status='accepted'
        AND ((p.submitted_by=auth.uid() AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid() AND a.participation_status='participating')))));
$$;

-- A session can contain parallel reporting slots, each with its own committee,
-- room and paper. Prevent cycles, cross-conference links and invalid timing.
CREATE OR REPLACE FUNCTION public.validate_session_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent public.sessions; conf public.conferences;
BEGIN
  SELECT * INTO conf FROM public.conferences WHERE id=NEW.conference_id;
  IF NEW.end_time<=NEW.start_time OR NEW.start_time<conf.start_date OR NEW.end_time>conf.end_date THEN
    RAISE EXCEPTION 'Phiên phải nằm trong thời gian hội thảo và kết thúc sau khi bắt đầu'; END IF;
  IF NEW.committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conference_committees WHERE id=NEW.committee_id AND conference_id=NEW.conference_id) THEN
    RAISE EXCEPTION 'Tiểu ban không thuộc hội thảo'; END IF;
  IF NEW.paper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.papers WHERE id=NEW.paper_id AND conference_id=NEW.conference_id AND status='accepted') THEN
    RAISE EXCEPTION 'Chỉ phân lịch cho bài được chấp nhận của hội thảo'; END IF;
  IF NEW.parent_session_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sessions WHERE id=NEW.parent_session_id;
    IF parent.id IS NULL OR parent.id=NEW.id OR parent.parent_session_id IS NOT NULL OR parent.conference_id<>NEW.conference_id
      OR NEW.start_time<parent.start_time OR NEW.end_time>parent.end_time THEN RAISE EXCEPTION 'Phiên báo cáo phải nằm trong phiên chung của cùng hội thảo'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.parent_session_id=NEW.id
    AND (NEW.parent_session_id IS NOT NULL OR s.conference_id<>NEW.conference_id OR s.start_time<NEW.start_time OR s.end_time>NEW.end_time)) THEN
    RAISE EXCEPTION 'Thay đổi làm phiên báo cáo nằm ngoài phiên chung'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_session_links ON public.sessions;
CREATE TRIGGER validate_session_links BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.validate_session_links();

-- Presentation certificates are unique per paper, attendance per conference.
ALTER TABLE public.certificates DROP CONSTRAINT IF EXISTS certificates_conference_id_user_id_certificate_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_attendance_unique ON public.certificates(conference_id,user_id,certificate_type) WHERE certificate_type='attendance';
CREATE UNIQUE INDEX IF NOT EXISTS certificates_presentation_unique ON public.certificates(conference_id,user_id,paper_id) WHERE certificate_type='presentation' AND paper_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(conf_id uuid, recipient_id uuid, target_paper_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id
    WHERE p.id=target_paper_id AND p.conference_id=conf_id AND p.status='accepted' AND c.end_date<=now()
    AND ((p.submitted_by=recipient_id AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=recipient_id AND a.participation_status='participating'))
    AND EXISTS (SELECT 1 FROM public.participants a WHERE a.conference_id=conf_id AND a.user_id=recipient_id AND a.attended)
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.conference_id=conf_id AND s.paper_id=p.id AND s.end_time<=now()));
$$;
CREATE OR REPLACE FUNCTION public.validate_certificate_eligibility() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_conference_organizer(NEW.conference_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  IF (NEW.certificate_type='presentation' AND NOT public.is_paper_certificate_eligible(NEW.conference_id,NEW.user_id,NEW.paper_id))
    OR (NEW.certificate_type='attendance' AND (NEW.paper_id IS NOT NULL OR NOT public.is_certificate_eligible(NEW.conference_id,NEW.user_id,'attendance'))) THEN
    RAISE EXCEPTION 'Người nhận chưa đủ điều kiện cấp chứng nhận cho bài báo/hội thảo này' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_certificate_eligibility_trigger ON public.certificates;
CREATE TRIGGER validate_certificate_eligibility_trigger BEFORE INSERT OR UPDATE OF conference_id,user_id,certificate_type,paper_id ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.validate_certificate_eligibility();
CREATE OR REPLACE FUNCTION public.paper_certificate_recipients(conf_id uuid, target_paper_id uuid)
RETURNS TABLE(user_id uuid,full_name text,role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.role FROM public.profiles p
    WHERE public.is_paper_certificate_eligible(conf_id,p.id,target_paper_id)
    AND NOT EXISTS (SELECT 1 FROM public.certificates c WHERE c.conference_id=conf_id AND c.user_id=p.id AND c.certificate_type='presentation' AND c.paper_id=target_paper_id)
    ORDER BY p.full_name,p.id;
END $$;
CREATE OR REPLACE FUNCTION public.issue_paper_certificates(conf_id uuid,target_paper_id uuid,recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; issued integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  FOREACH recipient IN ARRAY coalesce(recipient_ids,ARRAY[]::uuid[]) LOOP
    IF NOT public.is_paper_certificate_eligible(conf_id,recipient,target_paper_id) THEN RAISE EXCEPTION 'Người nhận không đủ điều kiện cho bài đã chọn'; END IF;
    INSERT INTO public.certificates(conference_id,user_id,certificate_type,issued_by,paper_id)
      VALUES(conf_id,recipient,'presentation',auth.uid(),target_paper_id) ON CONFLICT DO NOTHING;
    IF FOUND THEN issued:=issued+1; END IF;
  END LOOP;
  RETURN issued;
END $$;
REVOKE ALL ON FUNCTION public.is_paper_certificate_eligible(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_certificate_recipients(uuid,uuid),public.issue_paper_certificates(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.paper_certificate_recipients(uuid,uuid),public.issue_paper_certificates(uuid,uuid,uuid[]) TO authenticated;

-- Receipts are private; only their owner and the conference organizer can read.
INSERT INTO storage.buckets(id,name,public) VALUES('fee-proofs','fee-proofs',false) ON CONFLICT(id) DO UPDATE SET public=false;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit=10485760, allowed_mime_types=ARRAY[''application/pdf'',''image/jpeg'',''image/png'',''image/webp''] WHERE id=''fee-proofs''';
  END IF;
END $$;
DROP POLICY IF EXISTS fee_proofs_insert ON storage.objects;
CREATE POLICY fee_proofs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='fee-proofs' AND split_part(name,'/',1)=auth.uid()::text
  AND EXISTS(SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2) AND c.status<>'draft'));
DROP POLICY IF EXISTS fee_proofs_read ON storage.objects;
CREATE POLICY fee_proofs_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='fee-proofs' AND (split_part(name,'/',1)=auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2) AND public.is_conference_organizer(c.id))));
CREATE OR REPLACE FUNCTION public.validate_fee_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.conference_funds f WHERE f.id=NEW.fund_id AND f.conference_id=NEW.conference_id) THEN RAISE EXCEPTION 'Quỹ phí không thuộc hội thảo'; END IF;
  IF btrim(NEW.proof_url)='' THEN RAISE EXCEPTION 'Vui lòng nộp minh chứng'; END IF;
  IF NEW.proof_url !~* '^https?://[^[:space:]]+$' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='fee-proofs' AND o.name=NEW.proof_url
    AND split_part(o.name,'/',1)=NEW.payer_id::text AND split_part(o.name,'/',2)=NEW.conference_id::text) THEN RAISE EXCEPTION 'Minh chứng không hợp lệ'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.fund_id<>OLD.fund_id OR NEW.conference_id<>OLD.conference_id OR NEW.payer_id<>OLD.payer_id OR NEW.amount<>OLD.amount OR NEW.proof_url<>OLD.proof_url THEN
      RAISE EXCEPTION 'Không thể thay đổi khoản nộp khi duyệt'; END IF;
    NEW.reviewed_by:=auth.uid(); NEW.reviewed_at:=now();
  ELSIF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'Khoản nộp mới phải chờ duyệt'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_fee_payment ON public.fee_payments;
CREATE TRIGGER validate_fee_payment BEFORE INSERT OR UPDATE ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION public.validate_fee_payment();
REVOKE ALL ON FUNCTION public.validate_session_links(),public.validate_fee_payment(),public.require_review_enabled() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';


-- SOURCE: 20261008_seminar_experience.sql
-- Apply after 20261008_complete_workflows.sql. Safe to reapply.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'general';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_difficulty_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_difficulty_check CHECK(difficulty IN ('general','beginner','advanced'));
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS resource_deadline timestamptz;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS auto_certificates boolean NOT NULL DEFAULT false;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS auto_surveys boolean NOT NULL DEFAULT false;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS attendance_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS pdf_path text;

CREATE OR REPLACE FUNCTION public.can_upload_session_documents(target_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.sessions s
    LEFT JOIN public.papers p ON p.id=s.paper_id WHERE s.id=target_session_id AND (
      public.is_conference_organizer(s.conference_id) OR (
        now() <= coalesce(s.resource_deadline,s.start_time)
        AND (s.speaker_id=auth.uid() OR (p.status='accepted' AND (
          p.submitted_by=auth.uid() OR EXISTS(SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid() AND a.participation_status='participating')))))));
$$;
REVOKE ALL ON FUNCTION public.can_upload_session_documents(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_upload_session_documents(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.conference_resources(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE, uploader_id uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL CHECK(btrim(title)<>''), kind text NOT NULL CHECK(kind IN ('slides','reading','proceedings')),
  visibility text NOT NULL DEFAULT 'checked_in' CHECK(visibility IN ('public','registered','checked_in')),
  file_path text NOT NULL UNIQUE, version_number integer NOT NULL DEFAULT 1 CHECK(version_number>0), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conference_resources ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conference_resources TO authenticated;
CREATE OR REPLACE FUNCTION public.can_download_resource(target_resource_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.conference_resources r JOIN public.conferences c ON c.id=r.conference_id
    WHERE r.id=target_resource_id AND (
      (r.visibility='public' AND c.status<>'draft') OR (auth.uid() IS NOT NULL AND (
        r.uploader_id=auth.uid() OR public.is_conference_organizer(r.conference_id)
        OR EXISTS(SELECT 1 FROM public.participants p WHERE p.conference_id=r.conference_id AND p.user_id=auth.uid()
          AND (r.visibility='registered' OR (r.visibility='checked_in' AND p.attended)))))));
$$;
REVOKE ALL ON FUNCTION public.can_download_resource(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_download_resource(uuid) TO anon,authenticated;
DROP POLICY IF EXISTS resources_catalog ON public.conference_resources;
CREATE POLICY resources_catalog ON public.conference_resources FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.conferences c WHERE c.id=conference_id AND (c.status<>'draft' OR public.is_conference_organizer(c.id))));
DROP POLICY IF EXISTS resources_insert ON public.conference_resources;
CREATE POLICY resources_insert ON public.conference_resources FOR INSERT TO authenticated WITH CHECK(uploader_id=auth.uid()
  AND (public.is_conference_organizer(conference_id) OR (session_id IS NOT NULL AND public.can_upload_session_documents(session_id))));
DROP POLICY IF EXISTS resources_delete ON public.conference_resources;
CREATE POLICY resources_delete ON public.conference_resources FOR DELETE TO authenticated USING(public.is_conference_organizer(conference_id));
DROP POLICY IF EXISTS resources_update ON public.conference_resources;
CREATE POLICY resources_update ON public.conference_resources FOR UPDATE TO authenticated USING(public.is_conference_organizer(conference_id)) WITH CHECK(public.is_conference_organizer(conference_id));
CREATE OR REPLACE FUNCTION public.validate_resource() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.file_path<>OLD.file_path OR NEW.conference_id<>OLD.conference_id OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.uploader_id<>OLD.uploader_id OR NEW.version_number<>OLD.version_number THEN
      RAISE EXCEPTION 'Đăng phiên bản mới để thay đổi file hoặc phiên'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=NEW.session_id AND s.conference_id=NEW.conference_id) THEN
    RAISE EXCEPTION 'Phiên không thuộc hội thảo'; END IF;
  IF NEW.kind='slides' AND NEW.session_id IS NULL THEN RAISE EXCEPTION 'Slide phải gắn với phiên báo cáo'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_conference_organizer(NEW.conference_id) AND NEW.kind='proceedings' THEN RAISE EXCEPTION 'Chỉ ban tổ chức đăng kỷ yếu'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='conference-resources' AND o.name=NEW.file_path
    AND split_part(o.name,'/',1)=NEW.uploader_id::text AND split_part(o.name,'/',2)=NEW.conference_id::text) THEN RAISE EXCEPTION 'File tài liệu không hợp lệ'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.conference_id::text||coalesce(NEW.session_id::text,'')||NEW.title,0));
  SELECT coalesce(max(version_number),0)+1 INTO NEW.version_number FROM public.conference_resources r
    WHERE r.conference_id=NEW.conference_id AND r.session_id IS NOT DISTINCT FROM NEW.session_id AND r.title=NEW.title;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_resource ON public.conference_resources;
CREATE TRIGGER validate_resource BEFORE INSERT OR UPDATE ON public.conference_resources FOR EACH ROW EXECUTE FUNCTION public.validate_resource();
CREATE INDEX IF NOT EXISTS resources_conference_idx ON public.conference_resources(conference_id,session_id);
INSERT INTO storage.buckets(id,name,public) VALUES('conference-resources','conference-resources',false),('certificate-pdfs','certificate-pdfs',false) ON CONFLICT(id) DO UPDATE SET public=false;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit=26214400,allowed_mime_types=ARRAY[''application/pdf'',''application/vnd.ms-powerpoint'',''application/vnd.openxmlformats-officedocument.presentationml.presentation''] WHERE id=''conference-resources''';
  END IF;
END $$;
DROP POLICY IF EXISTS resource_files_insert ON storage.objects;
CREATE POLICY resource_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='conference-resources'
  AND split_part(name,'/',1)=auth.uid()::text AND EXISTS(SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2)
    AND (public.is_conference_organizer(c.id) OR EXISTS(SELECT 1 FROM public.sessions s WHERE s.conference_id=c.id AND public.can_upload_session_documents(s.id)))));
DROP POLICY IF EXISTS resource_files_read ON storage.objects;
CREATE POLICY resource_files_read ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='conference-resources'
  AND EXISTS(SELECT 1 FROM public.conference_resources r WHERE r.file_path=name AND public.can_download_resource(r.id)));
DROP POLICY IF EXISTS certificate_pdf_read ON storage.objects;
CREATE POLICY certificate_pdf_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='certificate-pdfs'
  AND EXISTS(SELECT 1 FROM public.certificates c WHERE c.pdf_path=name AND (c.user_id=auth.uid() OR public.is_conference_organizer(c.conference_id))));

-- Session entry/exit is measured separately from conference-level check-in.
CREATE TABLE IF NOT EXISTS public.session_attendance(
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(), checked_out_at timestamptz, PRIMARY KEY(session_id,user_id),
  CHECK(checked_out_at IS NULL OR checked_out_at>=checked_in_at)
);
CREATE TABLE IF NOT EXISTS public.session_checkin_codes(
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT upper(replace(gen_random_uuid()::text,'-',''))
);
ALTER TABLE public.session_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_checkin_codes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.session_attendance,public.session_checkin_codes TO authenticated;
DROP POLICY IF EXISTS attendance_read ON public.session_attendance;
CREATE POLICY attendance_read ON public.session_attendance FOR SELECT TO authenticated USING(user_id=auth.uid()
  OR EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=session_id AND public.is_conference_organizer(s.conference_id)));
DROP POLICY IF EXISTS session_codes_read ON public.session_checkin_codes;
CREATE POLICY session_codes_read ON public.session_checkin_codes FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=session_id AND public.is_conference_organizer(s.conference_id)));
CREATE OR REPLACE FUNCTION public.create_session_checkin_code(target_session_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=target_session_id AND public.is_conference_organizer(s.conference_id)) THEN RAISE EXCEPTION 'Bạn không có quyền tạo mã điểm danh'; END IF;
  INSERT INTO public.session_checkin_codes(session_id) VALUES(target_session_id) ON CONFLICT(session_id) DO NOTHING;
  SELECT code INTO result FROM public.session_checkin_codes WHERE session_id=target_session_id; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.record_session_attendance(target_session_id uuid,checkin_code text,leaving boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sessions; attendance public.session_attendance;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id=target_session_id;
  IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.session_checkin_codes c WHERE c.session_id=s.id AND c.code=upper(btrim(checkin_code))) THEN RAISE EXCEPTION 'Mã điểm danh phiên không hợp lệ'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.participants p WHERE p.conference_id=s.conference_id AND p.user_id=auth.uid() AND p.attended) THEN RAISE EXCEPTION 'Cần đăng ký và điểm danh hội thảo trước'; END IF;
  IF now()<s.start_time-interval '15 minutes' OR now()>s.end_time+interval '30 minutes' THEN RAISE EXCEPTION 'Ngoài thời gian điểm danh phiên'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  SELECT * INTO attendance FROM public.session_attendance WHERE session_id=s.id AND user_id=auth.uid() FOR UPDATE;
  IF leaving THEN
    IF attendance.user_id IS NULL THEN RAISE EXCEPTION 'Bạn chưa check-in phiên này'; END IF;
    IF attendance.checked_out_at IS NULL THEN UPDATE public.session_attendance SET checked_out_at=now() WHERE session_id=s.id AND user_id=auth.uid(); END IF;
  ELSE
    IF attendance.user_id IS NOT NULL THEN RETURN; END IF;
    IF now()>=s.end_time THEN RAISE EXCEPTION 'Phiên đã kết thúc'; END IF;
    IF EXISTS(SELECT 1 FROM public.session_attendance a JOIN public.sessions previous ON previous.id=a.session_id WHERE a.user_id=auth.uid() AND a.checked_out_at IS NULL AND previous.end_time>now()) THEN RAISE EXCEPTION 'Hãy check-out phiên đang tham dự trước'; END IF;
    INSERT INTO public.session_attendance(session_id,user_id) VALUES(s.id,auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_session_checkin_code(uuid),public.record_session_attendance(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_session_checkin_code(uuid),public.record_session_attendance(uuid,text,boolean) TO authenticated;

CREATE TABLE IF NOT EXISTS public.session_feedback(
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  speaker_rating integer NOT NULL CHECK(speaker_rating BETWEEN 1 AND 5),content_rating integer NOT NULL CHECK(content_rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,user_id)
);
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.session_feedback TO authenticated;
DROP POLICY IF EXISTS feedback_read ON public.session_feedback;
CREATE POLICY feedback_read ON public.session_feedback FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS feedback_insert ON public.session_feedback;
CREATE POLICY feedback_insert ON public.session_feedback FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id WHERE a.session_id=session_feedback.session_id AND a.user_id=auth.uid() AND s.end_time<=now()));
CREATE OR REPLACE FUNCTION public.session_feedback_summary(target_session_id uuid)
RETURNS TABLE(responses bigint,speaker_average numeric,content_average numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=target_session_id AND public.is_conference_organizer(s.conference_id)) THEN RAISE EXCEPTION 'Bạn không có quyền xem báo cáo khảo sát'; END IF;
  RETURN QUERY SELECT count(*),round(avg(speaker_rating),2),round(avg(content_rating),2) FROM public.session_feedback WHERE session_id=target_session_id;
END $$;
REVOKE ALL ON FUNCTION public.session_feedback_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.session_feedback_summary(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.post_seminar_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,certificate_id uuid REFERENCES public.certificates(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('certificate','survey')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,locked_at timestamptz,last_error text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS post_certificate_unique ON public.post_seminar_jobs(certificate_id) WHERE kind='certificate';
CREATE UNIQUE INDEX IF NOT EXISTS post_survey_unique ON public.post_seminar_jobs(session_id,user_id) WHERE kind='survey';
ALTER TABLE public.post_seminar_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_seminar_jobs TO authenticated;
DROP POLICY IF EXISTS post_jobs_read ON public.post_seminar_jobs;
CREATE POLICY post_jobs_read ON public.post_seminar_jobs FOR SELECT TO authenticated USING(public.is_conference_organizer(conference_id));
GRANT ALL ON public.post_seminar_jobs TO service_role;

-- Merge overlapping measured intervals so parallel sessions never double hours.
CREATE OR REPLACE FUNCTION public.measured_attendance_minutes(conf_id uuid,recipient_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH intervals AS (
    SELECT greatest(a.checked_in_at,s.start_time) a,least(a.checked_out_at,s.end_time) b
    FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id
    WHERE s.conference_id=conf_id AND a.user_id=recipient_id AND a.checked_out_at IS NOT NULL
  ), valid AS (SELECT * FROM intervals WHERE b>a), ordered AS (
    SELECT *,max(b) OVER(ORDER BY a,b ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end FROM valid
  ), grouped AS(SELECT *,sum(CASE WHEN prior_end IS NULL OR a>prior_end THEN 1 ELSE 0 END) OVER(ORDER BY a,b) group_id FROM ordered),
  merged AS(SELECT min(a) a,max(b) b FROM grouped GROUP BY group_id)
  SELECT coalesce(floor(sum(extract(epoch FROM b-a))/60),0)::integer FROM merged;
$$;
REVOKE ALL ON FUNCTION public.measured_attendance_minutes(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.enqueue_post_seminar_jobs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE queued integer;
BEGIN
  INSERT INTO public.certificates(conference_id,user_id,certificate_type,attendance_minutes)
  SELECT c.id,p.user_id,'attendance',public.measured_attendance_minutes(c.id,p.user_id)
    FROM public.conferences c JOIN public.participants p ON p.conference_id=c.id AND p.attended
    WHERE c.auto_certificates AND c.end_date<=now() AND c.status<>'cancelled' ON CONFLICT DO NOTHING;
  UPDATE public.certificates cert SET attendance_minutes=public.measured_attendance_minutes(cert.conference_id,cert.user_id)
    FROM public.conferences c WHERE c.id=cert.conference_id AND c.auto_certificates AND cert.certificate_type='attendance' AND cert.pdf_path IS NULL;
  INSERT INTO public.post_seminar_jobs(conference_id,user_id,certificate_id,kind)
    SELECT cert.conference_id,cert.user_id,cert.id,'certificate' FROM public.certificates cert JOIN public.conferences c ON c.id=cert.conference_id
    JOIN public.participants p ON p.conference_id=cert.conference_id AND p.user_id=cert.user_id AND p.attended
    WHERE c.auto_certificates AND c.end_date<=now() AND c.status<>'cancelled' AND cert.certificate_type='attendance' ON CONFLICT DO NOTHING;
  INSERT INTO public.post_seminar_jobs(conference_id,user_id,session_id,kind)
    SELECT s.conference_id,a.user_id,s.id,'survey' FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id JOIN public.conferences c ON c.id=s.conference_id
    WHERE c.auto_surveys AND c.status<>'cancelled' AND s.end_time<=now() AND NOT EXISTS(SELECT 1 FROM public.session_feedback f WHERE f.session_id=s.id AND f.user_id=a.user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS queued=ROW_COUNT; RETURN queued;
END $$;
CREATE OR REPLACE FUNCTION public.claim_post_seminar_jobs(batch_size integer DEFAULT 10) RETURNS SETOF public.post_seminar_jobs
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.post_seminar_jobs j SET status='processing',locked_at=now(),attempts=attempts+1
  WHERE j.id IN(SELECT id FROM public.post_seminar_jobs WHERE attempts<5 AND
    (status IN ('pending','failed') OR (status='processing' AND locked_at<now()-interval '10 minutes'))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(batch_size,25))) RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.enqueue_post_seminar_jobs(),public.claim_post_seminar_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_seminar_jobs(),public.claim_post_seminar_jobs(integer),public.measured_attendance_minutes(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validate_resource() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';


-- SOURCE: 20261009_remove_participant_role.sql
-- Keep conference registrations; retire only the participant account role.
UPDATE public.profiles SET role = 'author' WHERE role = 'participant';
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'author';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'organizer', 'author', 'reviewer'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'author'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'author');

CREATE OR REPLACE FUNCTION public.submit_organizer_request(request_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_role text;
BEGIN
  SELECT role INTO current_role FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF current_role IS NULL OR current_role <> 'author' THEN
    RAISE EXCEPTION 'Chỉ tác giả được gửi yêu cầu';
  END IF;
  IF request_reason IS NULL OR char_length(btrim(request_reason)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Lý do phải có từ 10 đến 2000 ký tự';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizer_requests WHERE user_id = auth.uid() AND status = 'pending') THEN
    RAISE EXCEPTION 'Bạn đã có yêu cầu đang chờ duyệt';
  END IF;
  INSERT INTO public.organizer_requests(user_id, reason) VALUES (auth.uid(), btrim(request_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_organizer_request(request_id uuid, approve boolean, decision_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row public.organizer_requests; target_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Chỉ admin được duyệt yêu cầu'; END IF;
  IF approve IS NULL THEN RAISE EXCEPTION 'Quyết định không hợp lệ'; END IF;
  IF char_length(coalesce(decision_note, '')) > 2000 THEN RAISE EXCEPTION 'Ghi chú quá dài'; END IF;
  IF NOT approve AND length(btrim(coalesce(decision_note, ''))) = 0 THEN RAISE EXCEPTION 'Vui lòng nhập lý do từ chối'; END IF;
  SELECT * INTO request_row FROM public.organizer_requests WHERE id = request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Yêu cầu không còn chờ duyệt'; END IF;
  IF request_row.user_id = auth.uid() THEN RAISE EXCEPTION 'Không thể tự duyệt yêu cầu'; END IF;
  SELECT role INTO target_role FROM public.profiles WHERE id = request_row.user_id FOR UPDATE;
  IF approve THEN
    IF target_role NOT IN ('author', 'organizer') THEN RAISE EXCEPTION 'Vai trò tài khoản đã thay đổi, hãy từ chối yêu cầu'; END IF;
    UPDATE public.profiles SET role = 'organizer' WHERE id = request_row.user_id AND role <> 'organizer';
  END IF;
  UPDATE public.organizer_requests SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    review_note = btrim(coalesce(decision_note)), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = request_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- SOURCE: 20261009_certificate_consistency.sql
-- Apply after 20261008_seminar_experience.sql. Existing certificates are retained.

CREATE OR REPLACE FUNCTION public.is_certificate_eligible(conf_id uuid, recipient_id uuid, cert_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cert_type IN ('attendance', 'presentation') AND EXISTS (
    SELECT 1 FROM public.participants p WHERE p.conference_id = conf_id AND p.user_id = recipient_id AND p.attended
  ) AND EXISTS (SELECT 1 FROM public.conferences c WHERE c.id=conf_id AND c.end_date<=now() AND c.status<>'cancelled')
  AND (cert_type = 'attendance' OR EXISTS (
    SELECT 1 FROM public.sessions s JOIN public.papers p ON p.id = s.paper_id
    WHERE s.conference_id = conf_id AND p.conference_id = conf_id
      AND s.end_time <= now() AND p.status = 'accepted'
      AND (s.speaker_id = recipient_id OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id = p.id AND pa.user_id = recipient_id))
  ));
$$;
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(conf_id uuid, recipient_id uuid, target_paper_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id
    WHERE p.id=target_paper_id AND p.conference_id=conf_id AND p.status='accepted' AND c.end_date<=now() AND c.status<>'cancelled'
    AND ((p.submitted_by=recipient_id AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=recipient_id AND a.participation_status='participating'))
    AND EXISTS (SELECT 1 FROM public.participants a WHERE a.conference_id=conf_id AND a.user_id=recipient_id AND a.attended)
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.conference_id=conf_id AND s.paper_id=p.id AND s.end_time<=now()));
$$;
CREATE OR REPLACE FUNCTION public.issue_certificates_bulk(conf_id uuid, cert_type text, recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE issued integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501';
  END IF;
  IF cert_type IS DISTINCT FROM 'attendance' THEN
    RAISE EXCEPTION 'Chứng nhận báo cáo phải chọn bài báo cụ thể' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(recipient_ids,ARRAY[]::uuid[])) r
    WHERE r IS NULL OR NOT public.is_certificate_eligible(conf_id,r,'attendance')) THEN
    RAISE EXCEPTION 'Danh sách có người chưa đủ điều kiện; chưa cấp chứng nhận nào' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.certificates(conference_id,user_id,certificate_type,issued_by,attendance_minutes)
    SELECT conf_id,r,'attendance',auth.uid(),public.measured_attendance_minutes(conf_id,r)
    FROM (SELECT DISTINCT unnest(coalesce(recipient_ids,ARRAY[]::uuid[])) r) recipients
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS issued=ROW_COUNT;
  RETURN issued;
END $$;
REVOKE ALL ON FUNCTION public.issue_certificates_bulk(uuid,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_certificates_bulk(uuid,text,uuid[]) TO authenticated;


-- SOURCE: 20261010_email_delivery_safety.sql

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


-- SOURCE: 20261010_orphan_upload_cleanup.sql

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


-- SOURCE: 20261104_certificate_confirmation_workflow.sql
-- Two-step certificate workflow:
-- organizer creates a certificate record, the recipient confirms its details,
-- then the organizer approves and publishes it.
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

-- SOURCE: 20261105_fee_payment_integrity.sql
-- Keep fee payment reviews one-way and prevent direct API updates from
-- reopening or changing an already reviewed payment.
CREATE OR REPLACE FUNCTION public.validate_fee_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NEW.payer_id <> auth.uid() THEN
      RAISE EXCEPTION 'Người nộp không hợp lệ';
    END IF;
    IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Khoản nộp mới phải chờ duyệt';
    END IF;
  ELSE
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected') THEN
      RAISE EXCEPTION 'Khoản nộp chỉ được chuyển từ chờ duyệt sang đã chấp nhận hoặc từ chối';
    END IF;
    IF NEW.fund_id <> OLD.fund_id
      OR NEW.conference_id <> OLD.conference_id
      OR NEW.payer_id <> OLD.payer_id
      OR NEW.amount <> OLD.amount
      OR NEW.proof_url <> OLD.proof_url
      OR NEW.purpose <> OLD.purpose THEN
      RAISE EXCEPTION 'Không thể thay đổi nội dung khoản nộp khi duyệt';
    END IF;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conference_funds f
    WHERE f.id = NEW.fund_id
      AND f.conference_id = NEW.conference_id
  ) THEN
    RAISE EXCEPTION 'Quỹ phí không thuộc hội thảo';
  END IF;
  IF btrim(NEW.proof_url) = '' THEN
    RAISE EXCEPTION 'Vui lòng nộp minh chứng';
  END IF;
  IF NEW.proof_url !~* '^https?://[^[:space:]]+$'
    AND NOT EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'fee-proofs'
        AND o.name = NEW.proof_url
        AND split_part(o.name, '/', 1) = NEW.payer_id::text
        AND split_part(o.name, '/', 2) = NEW.conference_id::text
    ) THEN
    RAISE EXCEPTION 'Minh chứng không hợp lệ';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_fee_payment ON public.fee_payments;
CREATE TRIGGER validate_fee_payment
BEFORE INSERT OR UPDATE ON public.fee_payments
FOR EACH ROW EXECUTE FUNCTION public.validate_fee_payment();

REVOKE ALL ON FUNCTION public.validate_fee_payment() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- SOURCE: 20261105_session_roles_and_types.sql
-- Model conference sessions explicitly as opening, reporting, or closing sessions.
ALTER TABLE public.conference_committees
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.conference_topics(id) ON DELETE SET NULL;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'reporting'
    CHECK (session_type IN ('opening', 'reporting', 'closing')),
  ADD COLUMN IF NOT EXISTS chair_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secretary_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conference_committees_topic ON public.conference_committees(topic_id);

CREATE OR REPLACE FUNCTION public.validate_session_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  committee_conference uuid;
BEGIN
  IF NEW.committee_id IS NOT NULL THEN
    SELECT conference_id INTO committee_conference
    FROM public.conference_committees
    WHERE id = NEW.committee_id;
    IF committee_conference IS NULL OR committee_conference <> NEW.conference_id THEN
      RAISE EXCEPTION 'Tiểu ban không thuộc hội thảo';
    END IF;
  END IF;

  IF NEW.session_type <> 'reporting' AND (NEW.committee_id IS NOT NULL OR NEW.paper_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Chỉ phiên báo cáo mới có tiểu ban hoặc bài báo';
  END IF;

  IF NEW.paper_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = NEW.paper_id
      AND p.conference_id = NEW.conference_id
      AND p.status = 'accepted'
      AND (
        NEW.committee_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.paper_topics pt
          JOIN public.conference_committees cc ON cc.id = NEW.committee_id
          WHERE pt.paper_id = p.id
            AND cc.topic_id = pt.topic_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Bài báo phải được chấp nhận và thuộc chủ đề của tiểu ban';
  END IF;

  IF NEW.speaker_id IS NOT NULL AND NEW.paper_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.papers p
      WHERE p.id = NEW.paper_id
        AND (
          p.submitted_by = NEW.speaker_id
          OR EXISTS (
            SELECT 1
            FROM public.paper_authors pa
            WHERE pa.paper_id = NEW.paper_id AND pa.user_id = NEW.speaker_id
          )
        )
    ) THEN
    RAISE EXCEPTION 'Báo cáo viên phải là tác giả của bài báo';
  END IF;

  IF NEW.chair_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conferences c
    WHERE c.id = NEW.conference_id AND c.organizer_id = NEW.chair_id
    UNION ALL
    SELECT 1 FROM public.conference_staff cs
    WHERE cs.conference_id = NEW.conference_id AND cs.user_id = NEW.chair_id
  ) THEN
    RAISE EXCEPTION 'Chủ trì phải thuộc ban tổ chức hoặc ban thư ký';
  END IF;
  IF NEW.secretary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conferences c
    WHERE c.id = NEW.conference_id AND c.organizer_id = NEW.secretary_id
    UNION ALL
    SELECT 1 FROM public.conference_staff cs
    WHERE cs.conference_id = NEW.conference_id AND cs.user_id = NEW.secretary_id
  ) THEN
    RAISE EXCEPTION 'Thư ký phải thuộc ban tổ chức hoặc ban thư ký';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_session_assignment ON public.sessions;
CREATE TRIGGER validate_session_assignment
BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.validate_session_assignment();

NOTIFY pgrst, 'reload schema';

-- SOURCE: 20261112_paper_submission_rpc_access.sql
-- Restore the authenticated RPC grant for existing databases.
-- This does not change data or bypass row-level security.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_complete_paper_submission(
  uuid, uuid, text, text, text, text, uuid[], text, timestamptz,
  uuid[], jsonb, text, text, text, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- SOURCE: 20261113_presentation_certificate_registration.sql
-- A presentation certificate requires registration, not check-in.
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(
  conf_id uuid,
  recipient_id uuid,
  target_paper_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id
      AND p.conference_id = conf_id
      AND p.status = 'accepted'
      AND c.end_date <= now()
      AND c.status <> 'cancelled'
      AND (
        (p.submitted_by = recipient_id AND p.author_participation_status = 'participating')
        OR EXISTS (
          SELECT 1
          FROM public.paper_authors a
          WHERE a.paper_id = p.id
            AND a.user_id = recipient_id
            AND a.participation_status = 'participating'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.participants a
        WHERE a.conference_id = conf_id
          AND a.user_id = recipient_id
      )
      AND EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.conference_id = conf_id
          AND s.paper_id = p.id
          AND s.end_time <= now()
      )
  );
$$;

-- SOURCE: 20261113_paper_group_certificate.sql
-- Issue one presentation certificate per paper group to its registered representative.
CREATE OR REPLACE FUNCTION public.paper_certificate_representative(
  conf_id uuid,
  target_paper_id uuid
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    WHEN p.corresponding_author_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.participants a
        WHERE a.conference_id = conf_id
          AND a.user_id = p.corresponding_author_id
      )
      THEN p.corresponding_author_id
    WHEN p.submitted_by IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.participants a
        WHERE a.conference_id = conf_id
          AND a.user_id = p.submitted_by
      )
      THEN p.submitted_by
    ELSE NULL
  END
  FROM public.papers p
  WHERE p.id = target_paper_id
    AND p.conference_id = conf_id;
$$;

CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(
  conf_id uuid,
  recipient_id uuid,
  target_paper_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id
      AND p.conference_id = conf_id
      AND p.status = 'accepted'
      AND c.end_date <= now()
      AND c.status <> 'cancelled'
      AND public.paper_certificate_representative(conf_id, target_paper_id) = recipient_id
  );
$$;

CREATE OR REPLACE FUNCTION public.paper_certificate_recipients(
  conf_id uuid,
  target_paper_id uuid
) RETURNS TABLE(user_id uuid, full_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.id, p.full_name, p.role
  FROM public.profiles p
  WHERE p.id = public.paper_certificate_representative(conf_id, target_paper_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.certificates c
      WHERE c.conference_id = conf_id
        AND c.user_id = p.id
        AND c.certificate_type = 'presentation'
        AND c.paper_id = target_paper_id
    )
  ORDER BY p.full_name, p.id;
$$;

REVOKE ALL ON FUNCTION public.paper_certificate_representative(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paper_certificate_representative(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.paper_certificate_recipients(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paper_certificate_recipients(uuid, uuid) TO authenticated;

-- SOURCE: 20261113_paper_individual_certificates.sql
-- Issue one presentation certificate to every participating author in the paper group.
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(
  conf_id uuid,
  recipient_id uuid,
  target_paper_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id
      AND p.conference_id = conf_id
      AND p.status = 'accepted'
      AND c.end_date <= now()
      AND c.status <> 'cancelled'
      AND (
        (p.submitted_by = recipient_id AND p.author_participation_status = 'participating')
        OR EXISTS (
          SELECT 1
          FROM public.paper_authors a
          WHERE a.paper_id = p.id
            AND a.user_id = recipient_id
            AND a.participation_status = 'participating'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.conference_id = conf_id
          AND s.paper_id = p.id
          AND s.end_time <= now()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.paper_certificate_recipients(
  conf_id uuid,
  target_paper_id uuid
) RETURNS TABLE(user_id uuid, full_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.id, p.full_name, p.role
  FROM public.profiles p
  WHERE public.is_paper_certificate_eligible(conf_id, p.id, target_paper_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.certificates c
      WHERE c.conference_id = conf_id
        AND c.user_id = p.id
        AND c.certificate_type = 'presentation'
        AND c.paper_id = target_paper_id
    )
  ORDER BY p.full_name, p.id;
$$;

CREATE OR REPLACE FUNCTION public.issue_paper_certificates(
  conf_id uuid,
  target_paper_id uuid,
  recipient_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE issued integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền tạo hồ sơ chứng nhận' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.paper_certificate_recipients(conf_id, target_paper_id)
  ) THEN
    RAISE EXCEPTION 'Nhóm tác giả chưa có thành viên đủ điều kiện';
  END IF;

  INSERT INTO public.certificates(
    conference_id, user_id, certificate_type, issued_by, paper_id, workflow_status
  )
  SELECT conf_id, r.user_id, 'presentation', auth.uid(), target_paper_id, 'pending_confirmation'
  FROM public.paper_certificate_recipients(conf_id, target_paper_id) r
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS issued = ROW_COUNT;
  RETURN issued;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- SOURCE: 20261113_session_upload_window.sql
-- Lock speaker uploads once the conference has started; organizers may still update resources.
CREATE OR REPLACE FUNCTION public.can_upload_session_documents(target_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.sessions s
    JOIN public.conferences c ON c.id = s.conference_id
    LEFT JOIN public.papers p ON p.id = s.paper_id
    WHERE s.id = target_session_id
      AND (
        public.is_conference_organizer(s.conference_id)
        OR (
          now() < c.start_date
          AND now() <= coalesce(s.resource_deadline, s.start_time)
          AND (
            s.speaker_id = auth.uid()
            OR (
              p.status = 'accepted'
              AND (
                p.submitted_by = auth.uid()
                OR EXISTS (
                  SELECT 1
                  FROM public.paper_authors a
                  WHERE a.paper_id = p.id
                    AND a.user_id = auth.uid()
                    AND a.participation_status = 'participating'
                )
              )
            )
          )
        )
      )
  );
$$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload schema';
COMMIT;
