-- A presentation certificate requires registration, not check-in.
BEGIN;

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

COMMIT;
