-- Keep conference registrations; retire only the participant account role.
BEGIN;

UPDATE public.profiles SET role = 'author' WHERE role = 'participant';
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'author';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'organizer', 'author', 'reviewer'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'author'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'author');

CREATE OR REPLACE FUNCTION public.submit_organizer_request(request_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_role text;
BEGIN
  SELECT role INTO current_role FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF current_role IS NULL OR current_role <> 'author' THEN
    RAISE EXCEPTION 'Chỉ tác giả được gửi yêu cầu';
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
    IF target_role NOT IN ('author', 'organizer') THEN RAISE EXCEPTION 'Vai trò tài khoản đã thay đổi, hãy từ chối yêu cầu'; END IF;
    UPDATE public.profiles SET role = 'organizer' WHERE id = request_row.user_id AND role <> 'organizer';
  END IF;
  UPDATE public.organizer_requests SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    review_note = btrim(coalesce(decision_note)), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = request_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
