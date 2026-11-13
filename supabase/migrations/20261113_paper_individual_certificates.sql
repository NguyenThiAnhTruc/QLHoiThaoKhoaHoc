-- Issue one presentation certificate to every participating author in the paper group.
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
COMMIT;
