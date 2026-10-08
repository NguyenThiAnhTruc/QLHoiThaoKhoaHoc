-- Apply after 20261008_complete_workflows.sql. Safe to reapply.
BEGIN;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'general';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_difficulty_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_difficulty_check CHECK(difficulty IN ('general','beginner','advanced'));
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS resource_deadline timestamptz;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS auto_certificates boolean NOT NULL DEFAULT false;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS auto_surveys boolean NOT NULL DEFAULT false;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS attendance_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS pdf_path text;

CREATE OR REPLACE FUNCTION public.can_upload_session_documents(target_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.sessions s
    LEFT JOIN public.papers p ON p.id=s.paper_id WHERE s.id=target_session_id AND (
      public.is_conference_organizer(s.conference_id) OR (
        now() <= coalesce(s.resource_deadline,s.start_time)
        AND (s.speaker_id=auth.uid() OR (p.status='accepted' AND (
          p.submitted_by=auth.uid() OR EXISTS(SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid() AND a.participation_status='participating')))))));
$$;
REVOKE ALL ON FUNCTION public.can_upload_session_documents(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_upload_session_documents(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.conference_resources(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE, uploader_id uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL CHECK(btrim(title)<>''), kind text NOT NULL CHECK(kind IN ('slides','reading','proceedings')),
  visibility text NOT NULL DEFAULT 'checked_in' CHECK(visibility IN ('public','registered','checked_in')),
  file_path text NOT NULL UNIQUE, version_number integer NOT NULL DEFAULT 1 CHECK(version_number>0), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conference_resources ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conference_resources TO authenticated;
CREATE OR REPLACE FUNCTION public.can_download_resource(target_resource_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.conference_resources r JOIN public.conferences c ON c.id=r.conference_id
    WHERE r.id=target_resource_id AND (
      (r.visibility='public' AND c.status<>'draft') OR (auth.uid() IS NOT NULL AND (
        r.uploader_id=auth.uid() OR public.is_conference_organizer(r.conference_id)
        OR EXISTS(SELECT 1 FROM public.participants p WHERE p.conference_id=r.conference_id AND p.user_id=auth.uid()
          AND (r.visibility='registered' OR (r.visibility='checked_in' AND p.attended)))))));
$$;
REVOKE ALL ON FUNCTION public.can_download_resource(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_download_resource(uuid) TO anon,authenticated;
DROP POLICY IF EXISTS resources_catalog ON public.conference_resources;
CREATE POLICY resources_catalog ON public.conference_resources FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.conferences c WHERE c.id=conference_id AND (c.status<>'draft' OR public.is_conference_organizer(c.id))));
DROP POLICY IF EXISTS resources_insert ON public.conference_resources;
CREATE POLICY resources_insert ON public.conference_resources FOR INSERT TO authenticated WITH CHECK(uploader_id=auth.uid()
  AND (public.is_conference_organizer(conference_id) OR (session_id IS NOT NULL AND public.can_upload_session_documents(session_id))));
DROP POLICY IF EXISTS resources_delete ON public.conference_resources;
CREATE POLICY resources_delete ON public.conference_resources FOR DELETE TO authenticated USING(public.is_conference_organizer(conference_id));
DROP POLICY IF EXISTS resources_update ON public.conference_resources;
CREATE POLICY resources_update ON public.conference_resources FOR UPDATE TO authenticated USING(public.is_conference_organizer(conference_id)) WITH CHECK(public.is_conference_organizer(conference_id));
CREATE OR REPLACE FUNCTION public.validate_resource() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.file_path<>OLD.file_path OR NEW.conference_id<>OLD.conference_id OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.uploader_id<>OLD.uploader_id OR NEW.version_number<>OLD.version_number THEN
      RAISE EXCEPTION 'Đăng phiên bản mới để thay đổi file hoặc phiên'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=NEW.session_id AND s.conference_id=NEW.conference_id) THEN
    RAISE EXCEPTION 'Phiên không thuộc hội thảo'; END IF;
  IF NEW.kind='slides' AND NEW.session_id IS NULL THEN RAISE EXCEPTION 'Slide phải gắn với phiên báo cáo'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_conference_organizer(NEW.conference_id) AND NEW.kind='proceedings' THEN RAISE EXCEPTION 'Chỉ ban tổ chức đăng kỷ yếu'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='conference-resources' AND o.name=NEW.file_path
    AND split_part(o.name,'/',1)=NEW.uploader_id::text AND split_part(o.name,'/',2)=NEW.conference_id::text) THEN RAISE EXCEPTION 'File tài liệu không hợp lệ'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.conference_id::text||coalesce(NEW.session_id::text,'')||NEW.title,0));
  SELECT coalesce(max(version_number),0)+1 INTO NEW.version_number FROM public.conference_resources r
    WHERE r.conference_id=NEW.conference_id AND r.session_id IS NOT DISTINCT FROM NEW.session_id AND r.title=NEW.title;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_resource ON public.conference_resources;
CREATE TRIGGER validate_resource BEFORE INSERT OR UPDATE ON public.conference_resources FOR EACH ROW EXECUTE FUNCTION public.validate_resource();
CREATE INDEX IF NOT EXISTS resources_conference_idx ON public.conference_resources(conference_id,session_id);
INSERT INTO storage.buckets(id,name,public) VALUES('conference-resources','conference-resources',false),('certificate-pdfs','certificate-pdfs',false) ON CONFLICT(id) DO UPDATE SET public=false;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit=26214400,allowed_mime_types=ARRAY[''application/pdf'',''application/vnd.ms-powerpoint'',''application/vnd.openxmlformats-officedocument.presentationml.presentation''] WHERE id=''conference-resources''';
  END IF;
END $$;
DROP POLICY IF EXISTS resource_files_insert ON storage.objects;
CREATE POLICY resource_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='conference-resources'
  AND split_part(name,'/',1)=auth.uid()::text AND EXISTS(SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2)
    AND (public.is_conference_organizer(c.id) OR EXISTS(SELECT 1 FROM public.sessions s WHERE s.conference_id=c.id AND public.can_upload_session_documents(s.id)))));
DROP POLICY IF EXISTS resource_files_read ON storage.objects;
CREATE POLICY resource_files_read ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='conference-resources'
  AND EXISTS(SELECT 1 FROM public.conference_resources r WHERE r.file_path=name AND public.can_download_resource(r.id)));
DROP POLICY IF EXISTS certificate_pdf_read ON storage.objects;
CREATE POLICY certificate_pdf_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='certificate-pdfs'
  AND EXISTS(SELECT 1 FROM public.certificates c WHERE c.pdf_path=name AND (c.user_id=auth.uid() OR public.is_conference_organizer(c.conference_id))));

-- Session entry/exit is measured separately from conference-level check-in.
CREATE TABLE IF NOT EXISTS public.session_attendance(
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(), checked_out_at timestamptz, PRIMARY KEY(session_id,user_id),
  CHECK(checked_out_at IS NULL OR checked_out_at>=checked_in_at)
);
CREATE TABLE IF NOT EXISTS public.session_checkin_codes(
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT upper(replace(gen_random_uuid()::text,'-',''))
);
ALTER TABLE public.session_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_checkin_codes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.session_attendance,public.session_checkin_codes TO authenticated;
DROP POLICY IF EXISTS attendance_read ON public.session_attendance;
CREATE POLICY attendance_read ON public.session_attendance FOR SELECT TO authenticated USING(user_id=auth.uid()
  OR EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=session_id AND public.is_conference_organizer(s.conference_id)));
DROP POLICY IF EXISTS session_codes_read ON public.session_checkin_codes;
CREATE POLICY session_codes_read ON public.session_checkin_codes FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=session_id AND public.is_conference_organizer(s.conference_id)));
CREATE OR REPLACE FUNCTION public.create_session_checkin_code(target_session_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=target_session_id AND public.is_conference_organizer(s.conference_id)) THEN RAISE EXCEPTION 'Bạn không có quyền tạo mã điểm danh'; END IF;
  INSERT INTO public.session_checkin_codes(session_id) VALUES(target_session_id) ON CONFLICT(session_id) DO NOTHING;
  SELECT code INTO result FROM public.session_checkin_codes WHERE session_id=target_session_id; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.record_session_attendance(target_session_id uuid,checkin_code text,leaving boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.sessions; attendance public.session_attendance;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id=target_session_id;
  IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.session_checkin_codes c WHERE c.session_id=s.id AND c.code=upper(btrim(checkin_code))) THEN RAISE EXCEPTION 'Mã điểm danh phiên không hợp lệ'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.participants p WHERE p.conference_id=s.conference_id AND p.user_id=auth.uid() AND p.attended) THEN RAISE EXCEPTION 'Cần đăng ký và điểm danh hội thảo trước'; END IF;
  IF now()<s.start_time-interval '15 minutes' OR now()>s.end_time+interval '30 minutes' THEN RAISE EXCEPTION 'Ngoài thời gian điểm danh phiên'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  SELECT * INTO attendance FROM public.session_attendance WHERE session_id=s.id AND user_id=auth.uid() FOR UPDATE;
  IF leaving THEN
    IF attendance.user_id IS NULL THEN RAISE EXCEPTION 'Bạn chưa check-in phiên này'; END IF;
    IF attendance.checked_out_at IS NULL THEN UPDATE public.session_attendance SET checked_out_at=now() WHERE session_id=s.id AND user_id=auth.uid(); END IF;
  ELSE
    IF attendance.user_id IS NOT NULL THEN RETURN; END IF;
    IF now()>=s.end_time THEN RAISE EXCEPTION 'Phiên đã kết thúc'; END IF;
    IF EXISTS(SELECT 1 FROM public.session_attendance a JOIN public.sessions previous ON previous.id=a.session_id WHERE a.user_id=auth.uid() AND a.checked_out_at IS NULL AND previous.end_time>now()) THEN RAISE EXCEPTION 'Hãy check-out phiên đang tham dự trước'; END IF;
    INSERT INTO public.session_attendance(session_id,user_id) VALUES(s.id,auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_session_checkin_code(uuid),public.record_session_attendance(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_session_checkin_code(uuid),public.record_session_attendance(uuid,text,boolean) TO authenticated;

CREATE TABLE IF NOT EXISTS public.session_feedback(
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  speaker_rating integer NOT NULL CHECK(speaker_rating BETWEEN 1 AND 5),content_rating integer NOT NULL CHECK(content_rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,user_id)
);
ALTER TABLE public.session_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.session_feedback TO authenticated;
DROP POLICY IF EXISTS feedback_read ON public.session_feedback;
CREATE POLICY feedback_read ON public.session_feedback FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS feedback_insert ON public.session_feedback;
CREATE POLICY feedback_insert ON public.session_feedback FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id WHERE a.session_id=session_feedback.session_id AND a.user_id=auth.uid() AND s.end_time<=now()));
CREATE OR REPLACE FUNCTION public.session_feedback_summary(target_session_id uuid)
RETURNS TABLE(responses bigint,speaker_average numeric,content_average numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.sessions s WHERE s.id=target_session_id AND public.is_conference_organizer(s.conference_id)) THEN RAISE EXCEPTION 'Bạn không có quyền xem báo cáo khảo sát'; END IF;
  RETURN QUERY SELECT count(*),round(avg(speaker_rating),2),round(avg(content_rating),2) FROM public.session_feedback WHERE session_id=target_session_id;
END $$;
REVOKE ALL ON FUNCTION public.session_feedback_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.session_feedback_summary(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.post_seminar_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,certificate_id uuid REFERENCES public.certificates(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('certificate','survey')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,locked_at timestamptz,last_error text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS post_certificate_unique ON public.post_seminar_jobs(certificate_id) WHERE kind='certificate';
CREATE UNIQUE INDEX IF NOT EXISTS post_survey_unique ON public.post_seminar_jobs(session_id,user_id) WHERE kind='survey';
ALTER TABLE public.post_seminar_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_seminar_jobs TO authenticated;
DROP POLICY IF EXISTS post_jobs_read ON public.post_seminar_jobs;
CREATE POLICY post_jobs_read ON public.post_seminar_jobs FOR SELECT TO authenticated USING(public.is_conference_organizer(conference_id));
GRANT ALL ON public.post_seminar_jobs TO service_role;

-- Merge overlapping measured intervals so parallel sessions never double hours.
CREATE OR REPLACE FUNCTION public.measured_attendance_minutes(conf_id uuid,recipient_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH intervals AS (
    SELECT greatest(a.checked_in_at,s.start_time) a,least(a.checked_out_at,s.end_time) b
    FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id
    WHERE s.conference_id=conf_id AND a.user_id=recipient_id AND a.checked_out_at IS NOT NULL
  ), valid AS (SELECT * FROM intervals WHERE b>a), ordered AS (
    SELECT *,max(b) OVER(ORDER BY a,b ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end FROM valid
  ), grouped AS(SELECT *,sum(CASE WHEN prior_end IS NULL OR a>prior_end THEN 1 ELSE 0 END) OVER(ORDER BY a,b) group_id FROM ordered),
  merged AS(SELECT min(a) a,max(b) b FROM grouped GROUP BY group_id)
  SELECT coalesce(floor(sum(extract(epoch FROM b-a))/60),0)::integer FROM merged;
$$;
REVOKE ALL ON FUNCTION public.measured_attendance_minutes(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.enqueue_post_seminar_jobs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE queued integer;
BEGIN
  INSERT INTO public.certificates(conference_id,user_id,certificate_type,attendance_minutes)
  SELECT c.id,p.user_id,'attendance',public.measured_attendance_minutes(c.id,p.user_id)
    FROM public.conferences c JOIN public.participants p ON p.conference_id=c.id AND p.attended
    WHERE c.auto_certificates AND c.end_date<=now() AND c.status<>'cancelled' ON CONFLICT DO NOTHING;
  UPDATE public.certificates cert SET attendance_minutes=public.measured_attendance_minutes(cert.conference_id,cert.user_id)
    FROM public.conferences c WHERE c.id=cert.conference_id AND c.auto_certificates AND cert.certificate_type='attendance' AND cert.pdf_path IS NULL;
  INSERT INTO public.post_seminar_jobs(conference_id,user_id,certificate_id,kind)
    SELECT cert.conference_id,cert.user_id,cert.id,'certificate' FROM public.certificates cert JOIN public.conferences c ON c.id=cert.conference_id
    JOIN public.participants p ON p.conference_id=cert.conference_id AND p.user_id=cert.user_id AND p.attended
    WHERE c.auto_certificates AND c.end_date<=now() AND c.status<>'cancelled' AND cert.certificate_type='attendance' ON CONFLICT DO NOTHING;
  INSERT INTO public.post_seminar_jobs(conference_id,user_id,session_id,kind)
    SELECT s.conference_id,a.user_id,s.id,'survey' FROM public.session_attendance a JOIN public.sessions s ON s.id=a.session_id JOIN public.conferences c ON c.id=s.conference_id
    WHERE c.auto_surveys AND c.status<>'cancelled' AND s.end_time<=now() AND NOT EXISTS(SELECT 1 FROM public.session_feedback f WHERE f.session_id=s.id AND f.user_id=a.user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS queued=ROW_COUNT; RETURN queued;
END $$;
CREATE OR REPLACE FUNCTION public.claim_post_seminar_jobs(batch_size integer DEFAULT 10) RETURNS SETOF public.post_seminar_jobs
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.post_seminar_jobs j SET status='processing',locked_at=now(),attempts=attempts+1
  WHERE j.id IN(SELECT id FROM public.post_seminar_jobs WHERE attempts<5 AND
    (status IN ('pending','failed') OR (status='processing' AND locked_at<now()-interval '10 minutes'))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(batch_size,25))) RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.enqueue_post_seminar_jobs(),public.claim_post_seminar_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_seminar_jobs(),public.claim_post_seminar_jobs(integer),public.measured_attendance_minutes(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validate_resource() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
