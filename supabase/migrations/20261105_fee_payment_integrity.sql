-- Keep fee payment reviews one-way and prevent direct API updates from
-- reopening or changing an already reviewed payment.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_fee_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NEW.payer_id <> auth.uid() THEN
      RAISE EXCEPTION 'Người nộp không hợp lệ';
    END IF;
    IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Khoản nộp mới phải chờ duyệt';
    END IF;
  ELSE
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected') THEN
      RAISE EXCEPTION 'Khoản nộp chỉ được chuyển từ chờ duyệt sang đã chấp nhận hoặc từ chối';
    END IF;
    IF NEW.fund_id <> OLD.fund_id
      OR NEW.conference_id <> OLD.conference_id
      OR NEW.payer_id <> OLD.payer_id
      OR NEW.amount <> OLD.amount
      OR NEW.proof_url <> OLD.proof_url
      OR NEW.purpose <> OLD.purpose THEN
      RAISE EXCEPTION 'Không thể thay đổi nội dung khoản nộp khi duyệt';
    END IF;
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conference_funds f
    WHERE f.id = NEW.fund_id
      AND f.conference_id = NEW.conference_id
  ) THEN
    RAISE EXCEPTION 'Quỹ phí không thuộc hội thảo';
  END IF;
  IF btrim(NEW.proof_url) = '' THEN
    RAISE EXCEPTION 'Vui lòng nộp minh chứng';
  END IF;
  IF NEW.proof_url !~* '^https?://[^[:space:]]+$'
    AND NOT EXISTS (
      SELECT 1
      FROM storage.objects o
      WHERE o.bucket_id = 'fee-proofs'
        AND o.name = NEW.proof_url
        AND split_part(o.name, '/', 1) = NEW.payer_id::text
        AND split_part(o.name, '/', 2) = NEW.conference_id::text
    ) THEN
    RAISE EXCEPTION 'Minh chứng không hợp lệ';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_fee_payment ON public.fee_payments;
CREATE TRIGGER validate_fee_payment
BEFORE INSERT OR UPDATE ON public.fee_payments
FOR EACH ROW EXECUTE FUNCTION public.validate_fee_payment();

REVOKE ALL ON FUNCTION public.validate_fee_payment() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
