-- Apply after conference_updates.sql and the 20260927 status patch.
-- No demo accounts or conference data are deleted.
BEGIN;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS require_accepted_paper boolean NOT NULL DEFAULT false;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS problem_statement text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS objectives text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS author_group text NOT NULL DEFAULT '';
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS corresponding_author_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS author_participation_status text NOT NULL DEFAULT 'participating';
ALTER TABLE public.papers DROP CONSTRAINT IF EXISTS papers_author_participation_check;
ALTER TABLE public.papers ADD CONSTRAINT papers_author_participation_check CHECK(author_participation_status IN ('participating','not_participating'));
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES public.sessions(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sessions_parent_idx ON public.sessions(parent_session_id);
ALTER TABLE public.conference_topics ALTER COLUMN created_by SET DEFAULT auth.uid();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conference_topics,public.paper_topics,public.conference_committees,public.conference_funds,public.fee_payments TO authenticated;
DROP POLICY IF EXISTS paper_authors_update_paper_owner ON public.paper_authors;
CREATE POLICY paper_authors_update_paper_owner ON public.paper_authors FOR UPDATE TO authenticated
USING(public.can_edit_paper_submission(paper_id)) WITH CHECK(public.can_edit_paper_submission(paper_id));
DROP POLICY IF EXISTS paper_topics_manage ON public.paper_topics;
CREATE POLICY paper_topics_manage ON public.paper_topics FOR ALL TO authenticated
USING(public.can_edit_paper_submission(paper_id)) WITH CHECK(public.can_edit_paper_submission(paper_id)
  AND EXISTS(SELECT 1 FROM public.papers p JOIN public.conference_topics t ON t.conference_id=p.conference_id WHERE p.id=paper_id AND t.id=topic_id));
CREATE OR REPLACE FUNCTION public.guard_paper_submission_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(OLD.id)
    AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.abstract IS DISTINCT FROM OLD.abstract
      OR NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.file_url IS DISTINCT FROM OLD.file_url
      OR NEW.current_version IS DISTINCT FROM OLD.current_version
      OR NEW.problem_statement IS DISTINCT FROM OLD.problem_statement OR NEW.objectives IS DISTINCT FROM OLD.objectives
      OR NEW.author_group IS DISTINCT FROM OLD.author_group OR NEW.corresponding_author_id IS DISTINCT FROM OLD.corresponding_author_id
      OR NEW.author_participation_status IS DISTINCT FROM OLD.author_participation_status) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.is_session_author(target_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sessions s JOIN public.papers p ON p.id=s.paper_id
    WHERE (s.id=target_session_id OR s.parent_session_id=target_session_id)
      AND (s.speaker_id=auth.uid() OR p.submitted_by=auth.uid()
        OR EXISTS(SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid())));
$$;
REVOKE ALL ON FUNCTION public.is_session_author(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_session_author(uuid) TO authenticated;
DROP POLICY IF EXISTS sessions_select_author ON public.sessions;
CREATE POLICY sessions_select_author ON public.sessions FOR SELECT TO authenticated USING(public.is_session_author(id));

-- Keep all submission details in the same transaction; retain the original RPC
-- for older clients, but the new UI uses this complete operation.
CREATE OR REPLACE FUNCTION public.save_complete_paper_submission(
  target_paper_id uuid, target_conference_id uuid, paper_title text, paper_abstract text,
  paper_keywords text, paper_file text, author_ids uuid[], version_notes text,
  expected_updated_at timestamptz, topic_ids uuid[], participation jsonb,
  problem text, goals text, group_name text, main_author_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE saved uuid; member_id uuid; submitter uuid;
BEGIN
  IF btrim(coalesce(paper_keywords,'')) = '' THEN RAISE EXCEPTION 'Vui lòng nhập từ khóa'; END IF;
  IF main_author_id IS NULL OR NOT (main_author_id = coalesce((SELECT submitted_by FROM public.papers WHERE id=target_paper_id),auth.uid()) OR main_author_id = ANY(coalesce(author_ids, ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION 'Tác giả chính phải thuộc nhóm tác giả';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(topic_ids,ARRAY[]::uuid[])) x(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.conference_topics t WHERE t.id=x.id AND t.conference_id=target_conference_id)) THEN
    RAISE EXCEPTION 'Chủ đề không thuộc hội thảo';
  END IF;
  saved := public.save_paper_submission(target_paper_id,target_conference_id,paper_title,paper_abstract,
    paper_keywords,paper_file,author_ids,version_notes,expected_updated_at);
  SELECT submitted_by INTO submitter FROM public.papers WHERE id=saved;
  UPDATE public.papers SET problem_statement=btrim(coalesce(problem,'')), objectives=btrim(coalesce(goals,'')),
    author_group=btrim(coalesce(group_name,'')), corresponding_author_id=main_author_id,
    author_participation_status=coalesce(participation->>submitter::text,'participating') WHERE id=saved;
  DELETE FROM public.paper_topics WHERE paper_id=saved;
  INSERT INTO public.paper_topics(paper_id,topic_id) SELECT saved,id FROM unnest(coalesce(topic_ids,ARRAY[]::uuid[])) x(id) GROUP BY id;
  FOREACH member_id IN ARRAY coalesce(author_ids,ARRAY[]::uuid[]) LOOP
    IF coalesce(participation->>member_id::text,'participating') NOT IN ('participating','not_participating') THEN
      RAISE EXCEPTION 'Trạng thái tham gia không hợp lệ';
    END IF;
    UPDATE public.paper_authors SET participation_status=coalesce(participation->>member_id::text,'participating')
      WHERE paper_id=saved AND user_id=member_id;
  END LOOP;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_complete_paper_submission(uuid,uuid,text,text,text,text,uuid[],text,timestamptz,uuid[],jsonb,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_complete_paper_submission(uuid,uuid,text,text,text,text,uuid[],text,timestamptz,uuid[],jsonb,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_paper_status_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE enabled boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.is_conference_organizer(OLD.conference_id) THEN RAISE EXCEPTION 'Chỉ ban tổ chức được thay đổi trạng thái bài báo'; END IF;
  IF OLD.status IN ('accepted','rejected') THEN RAISE EXCEPTION 'Bài báo đã có quyết định cuối cùng'; END IF;
  SELECT review_enabled INTO enabled FROM public.conferences WHERE id=OLD.conference_id;
  IF NOT enabled THEN
    IF NEW.status NOT IN ('accepted','rejected','revision_required') THEN RAISE EXCEPTION 'Hội thảo không sử dụng phản biện'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status='under_review' AND NOT EXISTS (SELECT 1 FROM public.reviews WHERE paper_id=OLD.id AND status IN ('assigned','in_progress','completed')) THEN
    RAISE EXCEPTION 'Cần phân công ít nhất một người phản biện trước'; END IF;
  IF NEW.status IN ('accepted','rejected','revision_required') AND NOT EXISTS (SELECT 1 FROM public.reviews WHERE paper_id=OLD.id AND status='completed') THEN
    RAISE EXCEPTION 'Cần ít nhất một phản biện hoàn thành trước khi ra kết quả'; END IF;
  IF NOT ((OLD.status='submitted' AND NEW.status='under_review') OR
    (OLD.status='under_review' AND NEW.status IN ('accepted','rejected','revision_required')) OR
    (OLD.status='revision_required' AND NEW.status='under_review')) THEN RAISE EXCEPTION 'Chuyển trạng thái bài báo không hợp lệ'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_paper_status_transition ON public.papers;
CREATE TRIGGER guard_paper_status_transition BEFORE UPDATE OF status ON public.papers FOR EACH ROW EXECUTE FUNCTION public.guard_paper_status_transition();
CREATE OR REPLACE FUNCTION public.require_review_enabled() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id WHERE p.id=NEW.paper_id AND c.review_enabled) THEN
    RAISE EXCEPTION 'Hội thảo đã tắt phản biện'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS require_review_enabled ON public.reviews;
CREATE TRIGGER require_review_enabled BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.require_review_enabled();

-- Authors may be required to have an accepted submission before registration.
CREATE OR REPLACE FUNCTION public.can_register_for_conference(conf_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conferences c WHERE c.id=conf_id AND c.status='open'
    AND (c.registration_deadline IS NULL OR now()<=c.registration_deadline)
    AND (c.max_participants=0 OR (SELECT count(*) FROM public.participants p WHERE p.conference_id=c.id)<c.max_participants)
    AND (NOT c.require_accepted_paper OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='author')
      OR EXISTS (SELECT 1 FROM public.papers p WHERE p.conference_id=c.id AND p.status='accepted'
        AND ((p.submitted_by=auth.uid() AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=auth.uid() AND a.participation_status='participating')))));
$$;

-- A session can contain parallel reporting slots, each with its own committee,
-- room and paper. Prevent cycles, cross-conference links and invalid timing.
CREATE OR REPLACE FUNCTION public.validate_session_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent public.sessions; conf public.conferences;
BEGIN
  SELECT * INTO conf FROM public.conferences WHERE id=NEW.conference_id;
  IF NEW.end_time<=NEW.start_time OR NEW.start_time<conf.start_date OR NEW.end_time>conf.end_date THEN
    RAISE EXCEPTION 'Phiên phải nằm trong thời gian hội thảo và kết thúc sau khi bắt đầu'; END IF;
  IF NEW.committee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conference_committees WHERE id=NEW.committee_id AND conference_id=NEW.conference_id) THEN
    RAISE EXCEPTION 'Tiểu ban không thuộc hội thảo'; END IF;
  IF NEW.paper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.papers WHERE id=NEW.paper_id AND conference_id=NEW.conference_id AND status='accepted') THEN
    RAISE EXCEPTION 'Chỉ phân lịch cho bài được chấp nhận của hội thảo'; END IF;
  IF NEW.parent_session_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sessions WHERE id=NEW.parent_session_id;
    IF parent.id IS NULL OR parent.id=NEW.id OR parent.parent_session_id IS NOT NULL OR parent.conference_id<>NEW.conference_id
      OR NEW.start_time<parent.start_time OR NEW.end_time>parent.end_time THEN RAISE EXCEPTION 'Phiên báo cáo phải nằm trong phiên chung của cùng hội thảo'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.parent_session_id=NEW.id
    AND (NEW.parent_session_id IS NOT NULL OR s.conference_id<>NEW.conference_id OR s.start_time<NEW.start_time OR s.end_time>NEW.end_time)) THEN
    RAISE EXCEPTION 'Thay đổi làm phiên báo cáo nằm ngoài phiên chung'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_session_links ON public.sessions;
CREATE TRIGGER validate_session_links BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.validate_session_links();

-- Presentation certificates are unique per paper, attendance per conference.
ALTER TABLE public.certificates DROP CONSTRAINT IF EXISTS certificates_conference_id_user_id_certificate_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_attendance_unique ON public.certificates(conference_id,user_id,certificate_type) WHERE certificate_type='attendance';
CREATE UNIQUE INDEX IF NOT EXISTS certificates_presentation_unique ON public.certificates(conference_id,user_id,paper_id) WHERE certificate_type='presentation' AND paper_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.is_paper_certificate_eligible(conf_id uuid, recipient_id uuid, target_paper_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id=p.conference_id
    WHERE p.id=target_paper_id AND p.conference_id=conf_id AND p.status='accepted' AND c.end_date<=now()
    AND ((p.submitted_by=recipient_id AND p.author_participation_status='participating') OR EXISTS (SELECT 1 FROM public.paper_authors a WHERE a.paper_id=p.id AND a.user_id=recipient_id AND a.participation_status='participating'))
    AND EXISTS (SELECT 1 FROM public.participants a WHERE a.conference_id=conf_id AND a.user_id=recipient_id AND a.attended)
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.conference_id=conf_id AND s.paper_id=p.id AND s.end_time<=now()));
$$;
CREATE OR REPLACE FUNCTION public.validate_certificate_eligibility() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_conference_organizer(NEW.conference_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  IF (NEW.certificate_type='presentation' AND NOT public.is_paper_certificate_eligible(NEW.conference_id,NEW.user_id,NEW.paper_id))
    OR (NEW.certificate_type='attendance' AND (NEW.paper_id IS NOT NULL OR NOT public.is_certificate_eligible(NEW.conference_id,NEW.user_id,'attendance'))) THEN
    RAISE EXCEPTION 'Người nhận chưa đủ điều kiện cấp chứng nhận cho bài báo/hội thảo này' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_certificate_eligibility_trigger ON public.certificates;
CREATE TRIGGER validate_certificate_eligibility_trigger BEFORE INSERT OR UPDATE OF conference_id,user_id,certificate_type,paper_id ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.validate_certificate_eligibility();
CREATE OR REPLACE FUNCTION public.paper_certificate_recipients(conf_id uuid, target_paper_id uuid)
RETURNS TABLE(user_id uuid,full_name text,role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.role FROM public.profiles p
    WHERE public.is_paper_certificate_eligible(conf_id,p.id,target_paper_id)
    AND NOT EXISTS (SELECT 1 FROM public.certificates c WHERE c.conference_id=conf_id AND c.user_id=p.id AND c.certificate_type='presentation' AND c.paper_id=target_paper_id)
    ORDER BY p.full_name,p.id;
END $$;
CREATE OR REPLACE FUNCTION public.issue_paper_certificates(conf_id uuid,target_paper_id uuid,recipient_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; issued integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_conference_organizer(conf_id) THEN RAISE EXCEPTION 'Bạn không có quyền cấp chứng nhận' USING ERRCODE='42501'; END IF;
  FOREACH recipient IN ARRAY coalesce(recipient_ids,ARRAY[]::uuid[]) LOOP
    IF NOT public.is_paper_certificate_eligible(conf_id,recipient,target_paper_id) THEN RAISE EXCEPTION 'Người nhận không đủ điều kiện cho bài đã chọn'; END IF;
    INSERT INTO public.certificates(conference_id,user_id,certificate_type,issued_by,paper_id)
      VALUES(conf_id,recipient,'presentation',auth.uid(),target_paper_id) ON CONFLICT DO NOTHING;
    IF FOUND THEN issued:=issued+1; END IF;
  END LOOP;
  RETURN issued;
END $$;
REVOKE ALL ON FUNCTION public.is_paper_certificate_eligible(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.paper_certificate_recipients(uuid,uuid),public.issue_paper_certificates(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.paper_certificate_recipients(uuid,uuid),public.issue_paper_certificates(uuid,uuid,uuid[]) TO authenticated;

-- Receipts are private; only their owner and the conference organizer can read.
INSERT INTO storage.buckets(id,name,public) VALUES('fee-proofs','fee-proofs',false) ON CONFLICT(id) DO UPDATE SET public=false;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit=10485760, allowed_mime_types=ARRAY[''application/pdf'',''image/jpeg'',''image/png'',''image/webp''] WHERE id=''fee-proofs''';
  END IF;
END $$;
DROP POLICY IF EXISTS fee_proofs_insert ON storage.objects;
CREATE POLICY fee_proofs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='fee-proofs' AND split_part(name,'/',1)=auth.uid()::text
  AND EXISTS(SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2) AND c.status<>'draft'));
DROP POLICY IF EXISTS fee_proofs_read ON storage.objects;
CREATE POLICY fee_proofs_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='fee-proofs' AND (split_part(name,'/',1)=auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.conferences c WHERE c.id::text=split_part(name,'/',2) AND public.is_conference_organizer(c.id))));
CREATE OR REPLACE FUNCTION public.validate_fee_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.conference_funds f WHERE f.id=NEW.fund_id AND f.conference_id=NEW.conference_id) THEN RAISE EXCEPTION 'Quỹ phí không thuộc hội thảo'; END IF;
  IF btrim(NEW.proof_url)='' THEN RAISE EXCEPTION 'Vui lòng nộp minh chứng'; END IF;
  IF NEW.proof_url !~* '^https?://[^[:space:]]+$' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='fee-proofs' AND o.name=NEW.proof_url
    AND split_part(o.name,'/',1)=NEW.payer_id::text AND split_part(o.name,'/',2)=NEW.conference_id::text) THEN RAISE EXCEPTION 'Minh chứng không hợp lệ'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.fund_id<>OLD.fund_id OR NEW.conference_id<>OLD.conference_id OR NEW.payer_id<>OLD.payer_id OR NEW.amount<>OLD.amount OR NEW.proof_url<>OLD.proof_url THEN
      RAISE EXCEPTION 'Không thể thay đổi khoản nộp khi duyệt'; END IF;
    NEW.reviewed_by:=auth.uid(); NEW.reviewed_at:=now();
  ELSIF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN RAISE EXCEPTION 'Khoản nộp mới phải chờ duyệt'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_fee_payment ON public.fee_payments;
CREATE TRIGGER validate_fee_payment BEFORE INSERT OR UPDATE ON public.fee_payments FOR EACH ROW EXECUTE FUNCTION public.validate_fee_payment();
REVOKE ALL ON FUNCTION public.validate_session_links(),public.validate_fee_payment(),public.require_review_enabled() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
