-- Chạy trực tiếp file này trong Supabase SQL Editor.
-- Tạo 10 tài khoản phản biện. Mật khẩu chung: Demo@123456
BEGIN;

CREATE TEMP TABLE reviewer_account_seed ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'reviewer01@confmanager.com', 'Nguyễn Minh An'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'reviewer02@confmanager.com', 'Trần Gia Bình'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'reviewer03@confmanager.com', 'Lê Ngọc Chi'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'reviewer04@confmanager.com', 'Phạm Quốc Duy'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'reviewer05@confmanager.com', 'Hoàng Thu Hà'),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'reviewer06@confmanager.com', 'Võ Đức Huy'),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'reviewer07@confmanager.com', 'Đặng Ngọc Lan'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'reviewer08@confmanager.com', 'Bùi Hoàng Minh'),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'reviewer09@confmanager.com', 'Đỗ Quốc Nam'),
  ('10000000-0000-0000-0000-000000000010'::uuid, 'reviewer10@confmanager.com', 'Hồ Thu Trang')
) AS reviewer(id, email, full_name);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000'::uuid,
  id, 'authenticated', 'authenticated', email,
  crypt('Demo@123456', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name, 'role', 'reviewer'),
  now(), now(), '', '', '', ''
FROM reviewer_account_seed
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  email_confirmed_at = EXCLUDED.email_confirmed_at,
  raw_app_meta_data = EXCLUDED.raw_app_meta_data,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  updated_at = now();

INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
SELECT
  id, id, email,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
FROM reviewer_account_seed
ON CONFLICT (provider, provider_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

INSERT INTO public.profiles (id, full_name, role, organization)
SELECT id, full_name, 'reviewer', 'Hội đồng phản biện'
FROM reviewer_account_seed
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  organization = EXCLUDED.organization,
  updated_at = now();

COMMIT;

-- Kết quả phải trả về 10 dòng.
SELECT profile.id, profile.full_name, profile.role, account.email
FROM public.profiles AS profile
JOIN auth.users AS account ON account.id = profile.id
WHERE profile.id::text LIKE '10000000-0000-0000-0000-%'
ORDER BY account.email;
