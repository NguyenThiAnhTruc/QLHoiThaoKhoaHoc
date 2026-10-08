-- Cập nhật database đã có schema cơ bản. Không tạo lại tài khoản demo.
-- Database mới: chạy conference_management_supabase.sql trước file này.
-- BEGIN SECTION 20260923_role_permissions
-- Apply after the conference management schema and 20260922 migrations.
BEGIN;

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
COMMIT;
-- END SECTION 20260923_role_permissions

-- BEGIN SECTION 20260924_admin_management
BEGIN;

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

COMMIT;
-- END SECTION 20260924_admin_management

-- BEGIN SECTION 20260924_conference_images
BEGIN;

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

COMMIT;
-- END SECTION 20260924_conference_images

-- BEGIN SECTION 20260924_conference_times
BEGIN;
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
COMMIT;
-- END SECTION 20260924_conference_times

-- BEGIN SECTION 20260924_participant_checkin_time
BEGIN;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

UPDATE public.participants
SET checked_in_at = registered_at
WHERE attended = true AND checked_in_at IS NULL;

COMMIT;
-- END SECTION 20260924_participant_checkin_time

-- BEGIN SECTION 20260924_participant_checkin_actor
BEGIN;

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

COMMIT;
-- END SECTION 20260924_participant_checkin_actor

-- BEGIN SECTION 20260924_attendance_sessions
BEGIN;

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

COMMIT;
-- END SECTION 20260924_attendance_sessions

-- BEGIN SECTION 20260924_registration_certificates
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
EXCEPTION WHEN undefined_file OR insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_cron is not enabled; run auto_issue_completed_certificates() manually or enable pg_cron.';
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- END SECTION 20260924_registration_certificates

-- BEGIN SECTION 20260924_reporting
BEGIN;
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
COMMIT;
-- END SECTION 20260924_reporting

-- BEGIN SECTION 20260925_admin_messaging
-- Ensure administrators can read and reply to every internal conversation,
-- including conversations created before this migration.
BEGIN;

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
    ('admin', 'organizer', 'author', 'reviewer', 'participant') THEN
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
COMMIT;
-- END SECTION 20260925_admin_messaging

-- BEGIN SECTION 20260925_author_workflow
-- Apply after the existing conference schema and migrations.
BEGIN;

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
COMMIT;
-- END SECTION 20260925_author_workflow

-- BEGIN SECTION 20260925_participant_contact_email
-- Organizers need a contact address when managing registrations. Expose the
-- profile contact email through the safe directory view; auth emails remain
-- outside the public profiles schema.
BEGIN;
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
COMMIT;
-- END SECTION 20260925_participant_contact_email

-- BEGIN SECTION 20260925_reviewer_workflow
-- Apply after 20260925_author_workflow.sql.
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','organizer','author','reviewer','participant'));
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.reviewer_id AND role IN ('author','reviewer')) THEN
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
COMMIT;
-- END SECTION 20260925_reviewer_workflow

-- BEGIN SECTION 20260926_conference_field_backfill
-- Phân loại 10 hội thảo mẫu theo danh sách lĩnh vực/chủ đề của form.
-- Chạy sau các file seed. Có thể chạy lại, không thay đổi lịch hay trạng thái.
BEGIN;

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
COMMIT;
-- END SECTION 20260926_conference_field_backfill

-- BEGIN SECTION 20260927_author_conference_papers
-- Read papers for a conference through one authorized database path.
-- Authors can see their own/co-authored papers and accepted papers only.
BEGIN;

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
COMMIT;
-- END SECTION 20260927_author_conference_papers

-- BEGIN SECTION 20260927_reviewer_signup
-- Allow reviewer self-registration while keeping staff roles restricted.
BEGIN;

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
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('participant', 'author', 'reviewer')
        THEN NEW.raw_user_meta_data->>'role'
      ELSE 'participant'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMIT;
-- END SECTION 20260927_reviewer_signup

-- BEGIN SECTION 20260927_conference_paper_catalog
-- Metadata visible to signed-in visitors of a visible conference.
-- File paths, author identities and review results retain their existing access rules.
BEGIN;
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
COMMIT;
-- END SECTION 20260927_conference_paper_catalog

-- BEGIN SECTION 20261008_conference_topics
BEGIN;
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
COMMIT;
-- END SECTION 20261008_conference_topics

-- BEGIN SECTION 20261008_session_committees
BEGIN;
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
COMMIT;
-- END SECTION 20261008_session_committees

-- BEGIN SECTION 20261008_paper_author_participation
BEGIN;
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
COMMIT;
-- END SECTION 20261008_paper_author_participation

-- BEGIN SECTION 20261008_conference_funding
BEGIN;
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
COMMIT;
-- END SECTION 20261008_conference_funding

-- BEGIN SECTION 20261008_certificate_signatures
BEGIN;
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
COMMIT;
-- END SECTION 20261008_certificate_signatures
