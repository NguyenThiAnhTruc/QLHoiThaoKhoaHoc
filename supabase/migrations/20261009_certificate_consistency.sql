-- Apply after 20261008_seminar_experience.sql. Existing certificates are retained.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_certificate_eligible(conf_id uuid, recipient_id uuid, cert_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cert_type IN ('attendance', 'presentation') AND EXISTS (
    SELECT 1 FROM public.participants p WHERE p.conference_id = conf_id AND p.user_id = recipient_id AND p.attended
  ) AND EXISTS (SELECT 1 FROM public.conferences c WHERE c.id=conf_id AND c.end_date<=now() AND c.status<>'cancelled')
  AND (cert_type = 'attendance' OR EXISTS (
    SELECT 1 FROM public.sessions s JOIN public.papers p ON p.id = s.paper_id
    WHERE s.conference_id = conf_id AND p.conference_id = conf_id
      AND s.end_time <= now() AND p.status = 'accepted'
      AND (s.speaker_id = recipient_id OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id = p.id AND pa.user_id = recipient_id))
  ));
$$;
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(conf_id uuid, recipient_id uuid, target_paper_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id
    WHERE p.id=target_paper_id AND p.conference_id=conf_id AND p.status='accepted' AND c.end_date<=now() AND c.status<>'cancelled'
    AND ((p.submitted_by=recipient_id AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=recipient_id AND a.participation_status='participating'))
    AND EXISTS (SELECT 1 FROM public.participants a WHERE a.conference_id=conf_id AND a.user_id=recipient_id AND a.attended)
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.conference_id=conf_id AND s.paper_id=p.id AND s.end_time<=now()));
$$;
CREATE OR REPLACE FUNCTION public.issue_certificates_bulk(conf_id uuid, cert_type text, recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE issued integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501';
  END IF;
  IF cert_type IS DISTINCT FROM 'attendance' THEN
    RAISE EXCEPTION 'Chứng nhận báo cáo phải chọn bài báo cụ thể' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(recipient_ids,ARRAY[]::uuid[])) r
    WHERE r IS NULL OR NOT public.is_certificate_eligible(conf_id,r,'attendance')) THEN
    RAISE EXCEPTION 'Danh sách có người chưa đủ điều kiện; chưa cấp chứng nhận nào' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.certificates(conference_id,user_id,certificate_type,issued_by,attendance_minutes)
    SELECT conf_id,r,'attendance',auth.uid(),public.measured_attendance_minutes(conf_id,r)
    FROM (SELECT DISTINCT unnest(coalesce(recipient_ids,ARRAY[]::uuid[])) r) recipients
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS issued=ROW_COUNT;
  RETURN issued;
END $$;
REVOKE ALL ON FUNCTION public.issue_certificates_bulk(uuid,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_certificates_bulk(uuid,text,uuid[]) TO authenticated;
COMMIT;
