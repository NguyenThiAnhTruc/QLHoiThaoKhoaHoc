-- Issue one presentation certificate per paper group to its registered representative.
BEGIN;

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

COMMIT;
