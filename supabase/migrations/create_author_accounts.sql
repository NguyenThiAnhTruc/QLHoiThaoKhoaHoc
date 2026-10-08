-- Chạy trực tiếp file này trong Supabase SQL Editor.
-- Tạo 7 tài khoản tác giả. Mật khẩu chung: Demo@123456
BEGIN;

CREATE TEMP TABLE author_account_seed ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, 'author01@confmanager.com', 'Nguyễn Hoàng Anh'),
  ('11000000-0000-0000-0000-000000000002'::uuid, 'author02@confmanager.com', 'Trần Minh Đức'),
  ('11000000-0000-0000-0000-000000000003'::uuid, 'author03@confmanager.com', 'Lê Thu Trang'),
  ('11000000-0000-0000-0000-000000000004'::uuid, 'author04@confmanager.com', 'Phạm Gia Huy'),
  ('11000000-0000-0000-0000-000000000005'::uuid, 'author05@confmanager.com', 'Võ Ngọc Mai'),
  ('11000000-0000-0000-0000-000000000006'::uuid, 'author06@confmanager.com', 'Đặng Quốc Khánh'),
  ('11000000-0000-0000-0000-000000000007'::uuid, 'author07@confmanager.com', 'Bùi Thanh Tâm')
) AS author(id, email, full_name);

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
  jsonb_build_object('full_name', full_name, 'role', 'author'),
  now(), now(), '', '', '', ''
FROM author_account_seed
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
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
FROM author_account_seed
ON CONFLICT (provider, provider_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

INSERT INTO public.profiles (id, full_name, role, organization)
SELECT id, full_name, 'author', 'Nhóm tác giả nghiên cứu'
FROM author_account_seed
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  organization = EXCLUDED.organization,
  updated_at = now();

COMMIT;

-- Kết quả phải trả về 7 dòng.
SELECT profile.id, profile.full_name, profile.role, account.email
FROM public.profiles AS profile
JOIN auth.users AS account ON account.id = profile.id
WHERE profile.id::text LIKE '11000000-0000-0000-0000-%'
ORDER BY account.email;