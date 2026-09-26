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
