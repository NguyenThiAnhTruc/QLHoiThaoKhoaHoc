-- Preserve existing assignments as history; only authors can be assigned or
-- submit further review updates. Existing conflict-of-interest checks remain.
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.reviewer_id AND role = 'author') THEN
    RAISE EXCEPTION 'Chỉ tài khoản Tác giả được phân công và thực hiện phản biện';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_author_reviewer_trigger ON public.reviews;
CREATE TRIGGER require_author_reviewer_trigger
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.require_author_reviewer();
