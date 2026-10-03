-- Tắt hoàn toàn chế độ phản biện ẩn danh nhưng giữ cột cũ để tương thích.
BEGIN;

UPDATE public.conferences
SET blind_review = false
WHERE blind_review;

CREATE OR REPLACE FUNCTION public.disable_blind_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.blind_review := false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS disable_blind_review ON public.conferences;
CREATE TRIGGER disable_blind_review
BEFORE INSERT OR UPDATE OF blind_review ON public.conferences
FOR EACH ROW
EXECUTE FUNCTION public.disable_blind_review();

-- Hàm cũ vẫn tồn tại để các policy đã triển khai không bị lỗi, nhưng không
-- còn che tác giả hoặc đường dẫn file.
CREATE OR REPLACE FUNCTION public.must_hide_paper_identity(target_paper_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT false;
$$;

REVOKE ALL ON FUNCTION public.disable_blind_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.must_hide_paper_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.must_hide_paper_identity(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
