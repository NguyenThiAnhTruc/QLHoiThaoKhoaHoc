-- Apply after 20260925_author_workflow.sql.
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','organizer','author','reviewer','participant'));
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.reviewer_id AND role IN ('author','reviewer')) THEN
    RAISE EXCEPTION 'Tài khoản không đủ điều kiện phản biện';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS require_author_reviewer_trigger ON public.reviews;
CREATE TRIGGER require_author_reviewer_trigger BEFORE INSERT OR UPDATE OF reviewer_id ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.require_author_reviewer();
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('assigned','in_progress','completed','declined'));
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS response_at timestamptz;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.can_read_paper_review_results(target_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p WHERE p.id=target_paper_id AND (
      public.is_conference_organizer(p.conference_id) OR p.submitted_by=auth.uid()
      OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id=p.id AND pa.user_id=auth.uid())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_paper_review_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_paper_review_results(uuid) TO authenticated;
DROP POLICY IF EXISTS reviews_select_reviewer_or_author_or_organizer ON public.reviews;
CREATE POLICY reviews_select_reviewer_or_author_or_organizer ON public.reviews FOR SELECT TO authenticated
USING (reviewer_id=auth.uid() OR public.can_read_paper_review_results(paper_id));

CREATE OR REPLACE FUNCTION public.guard_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công mới phải chờ xác nhận'; END IF;
    NEW.response_at := NULL; NEW.decline_reason := '';
  ELSE
    IF NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id OR NEW.paper_id IS DISTINCT FROM OLD.paper_id THEN
      RAISE EXCEPTION 'Hãy xóa phân công cũ và tạo lời mời mới để đổi người phản biện';
    END IF;
    NEW.assigned_at := OLD.assigned_at;
    NEW.completed_at := OLD.completed_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status='assigned' AND NEW.status IN ('in_progress','declined') THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được nhận hoặc từ chối'; END IF;
        NEW.response_at := now();
        IF NEW.status='declined' AND length(btrim(NEW.decline_reason))=0 THEN RAISE EXCEPTION 'Vui lòng nhập lý do từ chối'; END IF;
        IF NEW.status='in_progress' THEN NEW.decline_reason := ''; END IF;
      ELSIF OLD.status='in_progress' AND NEW.status='completed' THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được gửi đánh giá'; END IF;
        NEW.completed_at := now();
        NEW.response_at := OLD.response_at; NEW.decline_reason := OLD.decline_reason;
      ELSE
        RAISE EXCEPTION 'Chuyển trạng thái phản biện không hợp lệ';
      END IF;
    ELSE
      NEW.response_at := OLD.response_at;
      NEW.decline_reason := OLD.decline_reason;
    END IF;
    IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Đánh giá đã hoàn thành không thể sửa'; END IF;
  END IF;
  IF NEW.status IN ('assigned','declined') AND (NEW.score IS NOT NULL OR NEW.recommendation IS NOT NULL
    OR length(btrim(coalesce(NEW.comments,'')))>0 OR NEW.originality_score IS NOT NULL
    OR NEW.relevance_score IS NOT NULL OR NEW.methodology_score IS NOT NULL OR NEW.presentation_score IS NOT NULL
    OR NEW.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Phải nhận phân công trước khi đánh giá';
  END IF;
  IF NEW.status='completed' AND (NEW.score IS NULL OR NEW.recommendation IS NULL OR length(btrim(coalesce(NEW.comments,'')))=0) THEN
    RAISE EXCEPTION 'Vui lòng nhập điểm, khuyến nghị và nhận xét';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_review_response ON public.reviews;
CREATE TRIGGER guard_review_response BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.guard_review_response();

CREATE OR REPLACE FUNCTION public.respond_review_assignment(target_review_id uuid, accept_assignment boolean, reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE target public.reviews;
BEGIN
  IF auth.uid() IS NULL OR accept_assignment IS NULL THEN RAISE EXCEPTION 'Yêu cầu không hợp lệ'; END IF;
  SELECT * INTO target FROM public.reviews WHERE id=target_review_id FOR UPDATE;
  IF NOT FOUND OR target.reviewer_id <> auth.uid() THEN RAISE EXCEPTION 'Bạn không có quyền phản hồi phân công này'; END IF;
  IF target.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công đã được phản hồi. Vui lòng tải lại'; END IF;
  UPDATE public.reviews SET status=CASE WHEN accept_assignment THEN 'in_progress' ELSE 'declined' END,
    decline_reason=CASE WHEN accept_assignment THEN '' ELSE btrim(coalesce(reason,'')) END WHERE id=target_review_id;
END; $$;
REVOKE ALL ON FUNCTION public.respond_review_assignment(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_review_assignment(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; conf uuid; paper_title text; reviewer_name text;
BEGIN
  IF OLD.status <> 'assigned' OR NEW.status NOT IN ('in_progress','declined') THEN RETURN NEW; END IF;
  SELECT conference_id,title INTO conf,paper_title FROM public.papers WHERE id=NEW.paper_id;
  SELECT full_name INTO reviewer_name FROM public.profiles WHERE id=NEW.reviewer_id;
  FOR recipient IN SELECT id FROM public.profiles WHERE role='admin'
    UNION SELECT organizer_id FROM public.conferences WHERE id=conf
    UNION SELECT user_id FROM public.conference_staff WHERE conference_id=conf
  LOOP
    PERFORM public.create_notification(recipient, CASE WHEN NEW.status='declined' THEN 'Phản biện từ chối phân công' ELSE 'Phản biện đã nhận phân công' END,
      coalesce(reviewer_name,'Người phản biện') || ' — ' || paper_title || CASE WHEN NEW.status='declined' THEN ': ' || NEW.decline_reason ELSE '' END,'info','reviews');
  END LOOP;
  PERFORM public.write_audit_log('review.' || NEW.status,'review',NEW.id,jsonb_build_object('paper_id',NEW.paper_id,'reason',NEW.decline_reason));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_review_response ON public.reviews;
CREATE TRIGGER notify_review_response AFTER UPDATE OF status ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_review_response();
REVOKE ALL ON FUNCTION public.guard_review_response(), public.notify_review_response() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
COMMIT;
