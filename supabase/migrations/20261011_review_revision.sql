BEGIN;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.bump_review_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.revision=OLD.revision+1;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bump_review_revision ON public.reviews;
CREATE TRIGGER bump_review_revision BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.bump_review_revision();
REVOKE ALL ON FUNCTION public.bump_review_revision() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
