-- Apply after conference_management_supabase.sql.
CREATE TABLE IF NOT EXISTS public.organizer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_requests_one_pending
  ON public.organizer_requests(user_id) WHERE status = 'pending';
ALTER TABLE public.organizer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizer_requests FROM anon, authenticated;
GRANT SELECT ON public.organizer_requests TO authenticated;
DROP POLICY IF EXISTS organizer_requests_read ON public.organizer_requests;
CREATE POLICY organizer_requests_read ON public.organizer_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.submit_organizer_request(request_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_role text;
BEGIN
  SELECT role INTO current_role FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF current_role IS NULL OR current_role NOT IN ('author', 'participant') THEN
    RAISE EXCEPTION 'Chỉ tác giả và người tham dự được gửi yêu cầu';
  END IF;
  IF request_reason IS NULL OR char_length(btrim(request_reason)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Lý do phải có từ 10 đến 2000 ký tự';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizer_requests WHERE user_id = auth.uid() AND status = 'pending') THEN
    RAISE EXCEPTION 'Bạn đã có yêu cầu đang chờ duyệt';
  END IF;
  INSERT INTO public.organizer_requests(user_id, reason) VALUES (auth.uid(), btrim(request_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_organizer_request(request_id uuid, approve boolean, decision_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row public.organizer_requests; target_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Chỉ admin được duyệt yêu cầu'; END IF;
  IF approve IS NULL THEN RAISE EXCEPTION 'Quyết định không hợp lệ'; END IF;
  IF char_length(coalesce(decision_note, '')) > 2000 THEN RAISE EXCEPTION 'Ghi chú quá dài'; END IF;
  IF NOT approve AND length(btrim(coalesce(decision_note, ''))) = 0 THEN RAISE EXCEPTION 'Vui lòng nhập lý do từ chối'; END IF;
  SELECT * INTO request_row FROM public.organizer_requests WHERE id = request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Yêu cầu không còn chờ duyệt'; END IF;
  IF request_row.user_id = auth.uid() THEN RAISE EXCEPTION 'Không thể tự duyệt yêu cầu'; END IF;
  SELECT role INTO target_role FROM public.profiles WHERE id = request_row.user_id FOR UPDATE;
  IF approve THEN
    IF target_role NOT IN ('author', 'participant', 'organizer') THEN RAISE EXCEPTION 'Vai trò tài khoản đã thay đổi, hãy từ chối yêu cầu'; END IF;
    UPDATE public.profiles SET role = 'organizer' WHERE id = request_row.user_id AND role <> 'organizer';
  END IF;
  UPDATE public.organizer_requests SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    review_note = btrim(coalesce(decision_note, '')), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_organizer_request(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_organizer_request(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_organizer_request(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_organizer_request(uuid, boolean, text) TO authenticated;
