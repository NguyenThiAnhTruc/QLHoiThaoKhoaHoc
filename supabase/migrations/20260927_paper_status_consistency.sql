-- Giữ trạng thái bài báo đồng bộ với dữ liệu phản biện.
-- Có thể chạy lại an toàn trên database hiện có.
BEGIN;

-- Sửa dữ liệu cũ: không được có kết quả nếu chưa có phản biện hoàn tất.
UPDATE public.papers AS paper
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id
      AND review.status IN ('assigned', 'in_progress', 'completed')
  ) THEN 'under_review'
  ELSE 'submitted'
END
WHERE paper.status IN ('accepted', 'rejected', 'revision_required')
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id AND review.status = 'completed'
  );

UPDATE public.papers AS paper
SET status = 'submitted'
WHERE paper.status = 'under_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews AS review
    WHERE review.paper_id = paper.id
      AND review.status IN ('assigned', 'in_progress', 'completed')
  );

CREATE OR REPLACE FUNCTION public.guard_paper_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_conference_organizer(OLD.conference_id) THEN
    RAISE EXCEPTION 'Chỉ ban tổ chức được thay đổi trạng thái bài báo';
  END IF;

  IF OLD.status IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Bài báo đã có quyết định cuối cùng';
  END IF;

  IF NEW.status = 'under_review' AND NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE paper_id = OLD.id AND status IN ('assigned', 'in_progress', 'completed')
  ) THEN
    RAISE EXCEPTION 'Cần phân công ít nhất một người phản biện trước';
  END IF;

  IF NEW.status IN ('accepted', 'rejected', 'revision_required') AND NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE paper_id = OLD.id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Cần ít nhất một phản biện hoàn thành trước khi ra kết quả';
  END IF;

  IF NOT (
    (OLD.status = 'submitted' AND NEW.status = 'under_review')
    OR (OLD.status = 'under_review' AND NEW.status IN ('accepted', 'rejected', 'revision_required'))
    OR (OLD.status = 'revision_required' AND NEW.status = 'under_review')
  ) THEN
    RAISE EXCEPTION 'Chuyển trạng thái bài báo không hợp lệ';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_paper_status_transition ON public.papers;
CREATE TRIGGER guard_paper_status_transition
BEFORE UPDATE OF status ON public.papers
FOR EACH ROW
EXECUTE FUNCTION public.guard_paper_status_transition();

CREATE OR REPLACE FUNCTION public.start_paper_review_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.papers
  SET status = 'under_review'
  WHERE id = NEW.paper_id AND status = 'submitted';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS start_paper_review_on_assignment ON public.reviews;
CREATE TRIGGER start_paper_review_on_assignment
AFTER INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.start_paper_review_on_assignment();

REVOKE ALL ON FUNCTION public.guard_paper_status_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_paper_review_on_assignment() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
COMMIT;
