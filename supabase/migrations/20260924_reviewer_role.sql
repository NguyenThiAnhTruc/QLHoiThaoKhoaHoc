BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'organizer', 'reviewer', 'author', 'participant'));

CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.reviewer_id AND role IN ('author', 'reviewer')) THEN
    RAISE EXCEPTION 'Reviewer account is not eligible';
  END IF;
  RETURN NEW;
END $$;

-- Seed reviewer profiles for auth users that have already been created.
INSERT INTO public.profiles (id, full_name, role, organization)
SELECT v.id, v.full_name, 'reviewer', 'ConfManager Review Board'
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'Minh An'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'Gia Bình'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'Ngọc Chi'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'Quốc Duy'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'Thu Hà'),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'Đức Huy'),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'Ngọc Lan'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'Hoàng Minh'),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'Quốc Nam'),
  ('10000000-0000-0000-0000-000000000010'::uuid, 'Thu Trang')
) AS v(id, full_name)
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.id)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'reviewer', organization = EXCLUDED.organization;

-- Reviewer accounts can only access assignments granted in public.reviews;
-- existing review assignment policies remain the source of authorization.
NOTIFY pgrst, 'reload schema';
COMMIT;
