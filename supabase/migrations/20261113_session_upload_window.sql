-- Lock speaker uploads once the conference has started; organizers may still update resources.
BEGIN;

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
COMMIT;
