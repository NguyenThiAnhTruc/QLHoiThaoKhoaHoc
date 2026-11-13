-- Model conference sessions explicitly as opening, reporting, or closing sessions.
BEGIN;

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
COMMIT;
