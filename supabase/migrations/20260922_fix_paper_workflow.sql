CREATE OR REPLACE FUNCTION public.protect_paper_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow database migrations / SQL Editor maintenance.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Organizer/admin may manage paper workflow.
  IF public.is_conference_organizer(OLD.conference_id)
    AND public.is_conference_organizer(NEW.conference_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.abstract IS DISTINCT FROM OLD.abstract
    OR NEW.keywords IS DISTINCT FROM OLD.keywords
    OR NEW.file_url IS DISTINCT FROM OLD.file_url THEN
    IF EXISTS (
      SELECT 1
      FROM public.conferences c
      WHERE c.id = OLD.conference_id
        AND (
          (
            OLD.status IN ('accepted', 'revision_required')
            AND c.camera_ready_deadline IS NOT NULL
            AND now() > c.camera_ready_deadline
          )
          OR (
            OLD.status NOT IN ('accepted', 'revision_required')
            AND c.submission_deadline IS NOT NULL
            AND now() > c.submission_deadline
          )
        )
    ) THEN
      RAISE EXCEPTION 'The deadline for updating this paper has passed';
    END IF;
  END IF;

  -- Authors cannot move a paper to another conference.
  IF NEW.conference_id IS DISTINCT FROM OLD.conference_id THEN
    RAISE EXCEPTION 'Authors cannot change the conference of a paper';
  END IF;

  -- Authors cannot change the paper owner.
  IF NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
    RAISE EXCEPTION 'Authors cannot change the paper owner';
  END IF;

  -- Authors cannot change paper status.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Authors cannot change paper status';
  END IF;

  RETURN NEW;
END;
$$;
