BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_conference_ownership(
  conference_id uuid, new_owner_id uuid, expected_owner_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_owner uuid; owner_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Chỉ admin được chuyển chủ hội thảo' USING ERRCODE = '42501';
  END IF;
  SELECT organizer_id INTO current_owner FROM public.conferences
    WHERE id = conference_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hội thảo'; END IF;
  IF current_owner IS DISTINCT FROM expected_owner_id THEN
    RAISE EXCEPTION 'Chủ hội thảo đã thay đổi. Vui lòng tải lại';
  END IF;
  IF current_owner = new_owner_id THEN RAISE EXCEPTION 'Tài khoản đã là chủ hội thảo'; END IF;
  SELECT role INTO owner_role FROM public.profiles WHERE id = new_owner_id FOR UPDATE;
  IF NOT FOUND OR owner_role NOT IN ('admin', 'organizer') THEN
    RAISE EXCEPTION 'Chủ mới phải là admin hoặc ban tổ chức';
  END IF;
  UPDATE public.conferences SET organizer_id = new_owner_id WHERE id = conference_id;
  -- An owner does not also need a duplicate staff membership.
  DELETE FROM public.conference_staff AS staff
    WHERE staff.conference_id = transfer_conference_ownership.conference_id AND user_id = new_owner_id;
  PERFORM public.write_audit_log('conference.ownership_transferred', 'conference', conference_id,
    jsonb_build_object('previous_owner_id', current_owner, 'new_owner_id', new_owner_id));
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_conference_ownership(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_conference_ownership(uuid, uuid, uuid) TO authenticated;

COMMIT;
