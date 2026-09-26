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
