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
