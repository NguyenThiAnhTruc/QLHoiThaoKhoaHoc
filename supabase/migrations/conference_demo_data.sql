-- DỮ LIỆU MẪU TÙY CHỌN: chạy sau conference_updates.sql.
-- Gồm 22 hội thảo; khối multidisciplinary_demo thêm 12 hội thảo và 24 bài báo giả lập.
-- Có cập nhật tài khoản demo và đặt lại lịch/trạng thái các hội thảo mẫu.
-- BEGIN SECTION 20260924_rename_accounts
-- Run this file in Supabase SQL Editor for an existing database.
-- Preserve account IDs, passwords, roles and related data.
BEGIN;

UPDATE auth.users
SET email = replace(email, '@confmanager.demo', '@confmanager.com'),
    raw_user_meta_data = jsonb_set(
      coalesce(raw_user_meta_data, '{}'::jsonb),
      '{full_name}',
      to_jsonb(regexp_replace(coalesce(raw_user_meta_data->>'full_name', ''), ' Demo$', ''))
    ),
    updated_at = now()
WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);

UPDATE auth.identities AS identity
SET provider_id = replace(identity.provider_id, '@confmanager.demo', '@confmanager.com'),
    identity_data = jsonb_set(identity.identity_data, '{email}', to_jsonb(account.email)),
    updated_at = now()
FROM auth.users AS account
WHERE identity.user_id = account.id
  AND identity.provider = 'email'
  AND account.id IN (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005'
  );

UPDATE public.profiles
SET full_name = regexp_replace(full_name, ' Demo$', '')
WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);

UPDATE public.conferences
SET contact_email = 'organizer@confmanager.com',
    contact_name = regexp_replace(contact_name, ' Demo$', '')
WHERE contact_email IN ('organizer@confmanager.demo', 'organizer@confmanager.com');

COMMIT;
-- END SECTION 20260924_rename_accounts

-- BEGIN SECTION real_profile_names
-- Thay tên vai trò/tên trống bằng tên người tự nhiên; giữ nguyên tài khoản và quyền.
BEGIN;

UPDATE public.profiles AS profile
SET full_name = mapping.full_name,
    updated_at = now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Nguyễn Minh Quân'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'Trần Thu Hà'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'Lê Hoàng Nam'),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'Phạm Ngọc Lan'),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'Võ Gia Hân')
) AS mapping(id, full_name)
WHERE profile.id = mapping.id
  AND profile.full_name IS DISTINCT FROM mapping.full_name;

WITH name_pool AS (
  SELECT ARRAY[
    'Nguyễn Đức Anh', 'Trần Minh Châu', 'Lê Quang Duy', 'Phạm Thu Giang',
    'Hoàng Gia Huy', 'Võ Khánh Linh', 'Đặng Nhật Minh', 'Bùi Thảo My',
    'Đỗ Hải Nam', 'Hồ Bảo Ngọc', 'Ngô Minh Phúc', 'Dương Thanh Tâm',
    'Lý Quốc Thịnh', 'Mai Ngọc Trâm', 'Tạ Anh Tuấn', 'Cao Phương Uyên',
    'Trịnh Hoài An', 'Phan Gia Bảo', 'Vũ Ngọc Diệp', 'Đinh Thanh Hà',
    'Nguyễn Tuấn Kiệt', 'Trần Mỹ Linh', 'Lê Thành Long', 'Phạm Quỳnh Mai',
    'Hoàng Hữu Nghĩa', 'Võ Kim Oanh', 'Đặng Đức Phát', 'Bùi Như Quỳnh',
    'Đỗ Minh Tân', 'Hồ Thùy Trang'
  ]::text[] AS names
),
unnamed_profiles AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
  FROM public.profiles
  WHERE btrim(coalesce(full_name, '')) = ''
),
generated_names AS (
  SELECT unnamed_profiles.id,
    name_pool.names[((unnamed_profiles.position - 1) % cardinality(name_pool.names)) + 1] AS full_name
  FROM unnamed_profiles CROSS JOIN name_pool
)
UPDATE public.profiles AS profile
SET full_name = generated_names.full_name,
    updated_at = now()
FROM generated_names
WHERE profile.id = generated_names.id;

UPDATE auth.users AS account
SET raw_user_meta_data = jsonb_set(
      coalesce(account.raw_user_meta_data, '{}'::jsonb),
      '{full_name}', to_jsonb(profile.full_name)
    ),
    updated_at = now()
FROM public.profiles AS profile
WHERE profile.id = account.id
  AND coalesce(account.raw_user_meta_data->>'full_name', '') IS DISTINCT FROM profile.full_name;

COMMIT;
-- END SECTION real_profile_names

-- BEGIN SECTION reviewer_accounts
-- Tài khoản phản biện mẫu. Mật khẩu chung: Demo@123456
BEGIN;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000'::uuid,
  reviewer.id, 'authenticated', 'authenticated', reviewer.email,
  crypt('Demo@123456', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', reviewer.full_name, 'role', 'reviewer'),
  now(), now(), '', '', '', ''
FROM (VALUES
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
) AS reviewer(id, email, full_name)
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
  reviewer.id, reviewer.id, reviewer.email,
  jsonb_build_object(
    'sub', reviewer.id::text,
    'email', reviewer.email,
    'email_verified', true
  ),
  'email', now(), now(), now()
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'reviewer01@confmanager.com'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'reviewer02@confmanager.com'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'reviewer03@confmanager.com'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'reviewer04@confmanager.com'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'reviewer05@confmanager.com'),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'reviewer06@confmanager.com'),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'reviewer07@confmanager.com'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'reviewer08@confmanager.com'),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'reviewer09@confmanager.com'),
  ('10000000-0000-0000-0000-000000000010'::uuid, 'reviewer10@confmanager.com')
) AS reviewer(id, email)
ON CONFLICT (provider, provider_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  identity_data = EXCLUDED.identity_data,
  updated_at = now();

COMMIT;
-- END SECTION reviewer_accounts

-- BEGIN SECTION 20260924_reviewer_role
BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'organizer', 'reviewer', 'author'));

CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.reviewer_id AND role = 'reviewer') THEN
    RAISE EXCEPTION 'Reviewer account is not eligible';
  END IF;
  RETURN NEW;
END $$;

-- Seed reviewer profiles for auth users that have already been created.
INSERT INTO public.profiles (id, full_name, role, organization)
SELECT v.id, v.full_name, 'reviewer', 'ConfManager Review Board'
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'Nguyễn Minh An'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'Trần Gia Bình'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'Lê Ngọc Chi'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'Phạm Quốc Duy'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'Hoàng Thu Hà'),
  ('10000000-0000-0000-0000-000000000006'::uuid, 'Võ Đức Huy'),
  ('10000000-0000-0000-0000-000000000007'::uuid, 'Đặng Ngọc Lan'),
  ('10000000-0000-0000-0000-000000000008'::uuid, 'Bùi Hoàng Minh'),
  ('10000000-0000-0000-0000-000000000009'::uuid, 'Đỗ Quốc Nam'),
  ('10000000-0000-0000-0000-000000000010'::uuid, 'Hồ Thu Trang')
) AS v(id, full_name)
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.id)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'reviewer', organization = EXCLUDED.organization;

-- Reviewer accounts can only access assignments granted in public.reviews;
-- existing review assignment policies remain the source of authorization.
NOTIFY pgrst, 'reload schema';
COMMIT;
-- END SECTION 20260924_reviewer_role

-- BEGIN SECTION 20260924_real_conferences_seed
-- Verified public conference seed data. Run after the base schema and the
-- conference-times migration. Existing rows with these IDs are updated safely.
-- Sources:
-- IEEE QAI 2026: https://ai.ieee.org/events/
-- AIAT 2026: https://aiat.org/
BEGIN;

DO $$
DECLARE admin_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = admin_id) THEN
    RAISE EXCEPTION 'Admin seed account % is missing; create an admin before loading conference fixtures', admin_id;
  END IF;

  INSERT INTO public.conferences (
    id, title, description, start_date, end_date, location, status,
    organizer_id, max_participants, topics, event_format, is_featured,
    is_schedule_public, contact_name, contact_email, contact_phone,
    submission_deadline, review_deadline, registration_deadline, camera_ready_deadline
  ) VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    '2026 IEEE 2nd International Conference on Quantum Artificial Intelligence (QAI)',
    'Hội thảo quốc tế IEEE về trí tuệ nhân tạo lượng tử và các ứng dụng liên quan.',
    '2026-12-13 09:00:00+00', '2026-12-16 17:00:00+00',
    'Nottingham, United Kingdom', 'open', admin_id, 500,
    ARRAY['Quantum AI','Quantum Computing','Machine Learning','Artificial Intelligence'], 'offline', true, true,
    'IEEE QAI 2026', 'qai@ieee.org', '', NULL, NULL, '2026-12-12 23:59:00+00', NULL
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    '6th International Conference on Artificial Intelligence and Application Technologies (AIAT 2026)',
    'Hội thảo quốc tế về trí tuệ nhân tạo và công nghệ ứng dụng.',
    '2026-12-11 09:00:00+09', '2026-12-13 17:00:00+09',
    'Tokyo, Japan', 'open', admin_id, 300,
    ARRAY['Artificial Intelligence','Application Technologies','Deep Learning','Computer Vision'], 'hybrid', true, true,
    'AIAT 2026', 'info@aiat.org', '', NULL, NULL, '2026-12-10 23:59:00+09', NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description,
    start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
    location = EXCLUDED.location, status = EXCLUDED.status,
    organizer_id = EXCLUDED.organizer_id, topics = EXCLUDED.topics,
    event_format = EXCLUDED.event_format, is_featured = EXCLUDED.is_featured,
    is_schedule_public = EXCLUDED.is_schedule_public,
    contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
    submission_deadline = EXCLUDED.submission_deadline,
    review_deadline = EXCLUDED.review_deadline,
    registration_deadline = EXCLUDED.registration_deadline,
    camera_ready_deadline = EXCLUDED.camera_ready_deadline;

  INSERT INTO public.attendance_sessions (conference_id, code, starts_at, ends_at, created_by)
  VALUES
    ('a1000000-0000-0000-0000-000000000001', 'QAI2026', '2026-12-13 08:00:00+00', '2026-12-16 17:30:00+00', admin_id),
    ('a1000000-0000-0000-0000-000000000002', 'AIAT2026', '2026-12-11 08:00:00+09', '2026-12-13 17:30:00+09', admin_id)
  ON CONFLICT (conference_id) DO UPDATE SET
    code = EXCLUDED.code, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

  INSERT INTO public.sessions (id, conference_id, title, description, start_time, end_time, room)
  VALUES
    ('a1100000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Opening & Keynote','Opening and keynote session for IEEE QAI 2026.','2026-12-13 09:00:00+00','2026-12-13 10:30:00+00','Main Hall'),
    ('a1100000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Quantum Machine Learning','Quantum machine learning research session.','2026-12-13 11:00:00+00','2026-12-13 12:30:00+00','Room A'),
    ('a1100000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','Quantum AI Applications','Applications of quantum AI session.','2026-12-14 09:00:00+00','2026-12-14 10:30:00+00','Room A'),
    ('a1100000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','Posters & Networking','Poster and networking session.','2026-12-15 15:00:00+00','2026-12-15 17:00:00+00','Exhibition Hall'),
    ('a1100000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000001','Closing Session','Closing session for IEEE QAI 2026.','2026-12-16 15:30:00+00','2026-12-16 17:00:00+00','Main Hall'),
    ('a1100000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000002','Registration & Opening','Registration and opening session for AIAT 2026.','2026-12-11 09:00:00+09','2026-12-11 10:00:00+09','Main Hall'),
    ('a1100000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000002','AI Methods & Applications','AI methods and applications session.','2026-12-11 10:30:00+09','2026-12-11 12:00:00+09','Room 1'),
    ('a1100000-0000-0000-0000-000000000008','a1000000-0000-0000-0000-000000000002','Computer Vision & Deep Learning','Computer vision and deep learning session.','2026-12-12 09:00:00+09','2026-12-12 12:00:00+09','Room 1'),
    ('a1100000-0000-0000-0000-000000000009','a1000000-0000-0000-0000-000000000002','Industry Keynote','Industry keynote session.','2026-12-12 13:30:00+09','2026-12-12 15:00:00+09','Main Hall'),
    ('a1100000-0000-0000-0000-000000000010','a1000000-0000-0000-0000-000000000002','Poster Session','Poster presentations and discussion.','2026-12-12 15:30:00+09','2026-12-12 17:00:00+09','Exhibition Hall'),
    ('a1100000-0000-0000-0000-000000000011','a1000000-0000-0000-0000-000000000002','Invited Talks','Invited talks on application technologies.','2026-12-13 09:00:00+09','2026-12-13 12:00:00+09','Main Hall'),
    ('a1100000-0000-0000-0000-000000000012','a1000000-0000-0000-0000-000000000002','Closing & Awards','Closing and awards session.','2026-12-13 15:00:00+09','2026-12-13 17:00:00+09','Main Hall')
  ON CONFLICT (id) DO UPDATE SET
    conference_id = EXCLUDED.conference_id, title = EXCLUDED.title,
    description = EXCLUDED.description, start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time, room = EXCLUDED.room;
END $$;

COMMIT;
-- END SECTION 20260924_real_conferences_seed

-- BEGIN SECTION 20260925_conference_status_showcase
-- Dữ liệu cho trang Hội thảo và Bài báo.
-- Chạy sau các migration ngày 2026-09-25.
-- Có thể chạy lại: hội thảo được cập nhật theo ngày hiện tại, bài báo không bị tạo trùng.

BEGIN;

DO $$
DECLARE
  organizer_id uuid;
  author_id uuid;
  demo_reviewer_id uuid;
BEGIN
  SELECT id
  INTO organizer_id
  FROM public.profiles
  ORDER BY
    CASE role WHEN 'organizer' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    created_at
  LIMIT 1;

  IF organizer_id IS NULL THEN
    RAISE EXCEPTION 'Cần ít nhất một hồ sơ để tạo dữ liệu hội thảo';
  END IF;

  SELECT id
  INTO author_id
  FROM public.profiles
  ORDER BY
    CASE role WHEN 'author' THEN 0 WHEN 'reviewer' THEN 1 ELSE 2 END,
    created_at
  LIMIT 1;

  IF author_id IS NULL THEN
    author_id := organizer_id;
  END IF;

  SELECT id
  INTO demo_reviewer_id
  FROM public.profiles
  WHERE id <> author_id
    AND role = 'reviewer'
  ORDER BY created_at, id
  LIMIT 1;

  INSERT INTO public.conferences (
    id, title, description, start_date, end_date, location, status,
    organizer_id, cover_image_url, max_participants,
    submission_deadline, review_deadline, registration_deadline,
    camera_ready_deadline, blind_review, topics, event_format,
    is_featured, is_schedule_public, contact_name, contact_email, contact_phone
  )
  VALUES
    (
      'c0000000-0000-0000-0000-000000000001',
      'Diễn đàn Công nghệ Giáo dục Tương lai',
      'Hội thảo đang ở giai đoạn chuẩn bị nội dung và chưa được công bố chính thức.',
      CURRENT_DATE + 120, CURRENT_DATE + 121,
      'Trường Đại học Sư phạm TP. Hồ Chí Minh', 'draft', organizer_id,
      'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1200&q=80',
      180, CURRENT_DATE + 75, CURRENT_DATE + 90, CURRENT_DATE + 110,
      CURRENT_DATE + 100, false,
      ARRAY['Công nghệ giáo dục', 'Học tập số', 'Đổi mới sáng tạo'],
      'offline', false, false, 'Ban tổ chức EdFuture',
      'edfuture@example.com', '0901000001'
    ),
    (
      'c0000000-0000-0000-0000-000000000002',
      'Hội thảo Trí tuệ nhân tạo và Dữ liệu 2026',
      'Diễn đàn trao đổi các nghiên cứu mới về AI, khoa học dữ liệu và ứng dụng thực tiễn.',
      CURRENT_DATE + 60, CURRENT_DATE + 62,
      'Đại học Quốc gia TP. Hồ Chí Minh', 'open', organizer_id,
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80',
      350, CURRENT_DATE + 20, CURRENT_DATE + 35, CURRENT_DATE + 50,
      CURRENT_DATE + 45, true,
      ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu', 'Học máy'],
      'hybrid', true, true, 'Ban tổ chức AIDC',
      'aidc@example.com', '0901000002'
    ),
    (
      'c0000000-0000-0000-0000-000000000003',
      'Hội nghị An toàn Thông tin và Điện toán Đám mây',
      'Hội nghị đã đóng cổng đăng ký và đang hoàn thiện chương trình trước ngày khai mạc.',
      CURRENT_DATE + 25, CURRENT_DATE + 26,
      'Đà Nẵng', 'closed', organizer_id,
      'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80',
      220, CURRENT_DATE - 25, CURRENT_DATE - 10, CURRENT_DATE - 2,
      CURRENT_DATE + 5, true,
      ARRAY['An toàn thông tin', 'Điện toán đám mây', 'Mật mã học'],
      'hybrid', false, true, 'Ban tổ chức CSEC',
      'csec@example.com', '0901000003'
    ),
    (
      'c0000000-0000-0000-0000-000000000004',
      'Hội thảo Chuyển đổi số và Thành phố Thông minh',
      'Hội thảo đang diễn ra với các phiên báo cáo về chính quyền số, IoT và đô thị bền vững.',
      CURRENT_DATE - 1, CURRENT_DATE + 1,
      'Trung tâm Hội nghị Quốc gia, Hà Nội', 'ongoing', organizer_id,
      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80',
      500, CURRENT_DATE - 60, CURRENT_DATE - 35, CURRENT_DATE - 7,
      CURRENT_DATE - 20, false,
      ARRAY['Chuyển đổi số', 'Thành phố thông minh', 'IoT'],
      'offline', true, true, 'Ban tổ chức SmartCity',
      'smartcity@example.com', '0901000004'
    ),
    (
      'c0000000-0000-0000-0000-000000000005',
      'Hội nghị Khoa học Máy tính và Công nghệ Phần mềm',
      'Hội nghị đã hoàn thành, lưu trữ chương trình và các bài báo khoa học tiêu biểu.',
      CURRENT_DATE - 90, CURRENT_DATE - 88,
      'Đại học Bách khoa Hà Nội', 'completed', organizer_id,
      'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      300, CURRENT_DATE - 150, CURRENT_DATE - 125, CURRENT_DATE - 100,
      CURRENT_DATE - 110, false,
      ARRAY['Kỹ thuật phần mềm', 'Hệ thống phân tán', 'Kiểm thử phần mềm'],
      'offline', false, true, 'Ban tổ chức CSE',
      'cse@example.com', '0901000005'
    ),
    (
      'c0000000-0000-0000-0000-000000000006',
      'Hội thảo Quốc tế Robot và Tự động hóa',
      'Hội thảo đã hủy; bản ghi được giữ lại để minh họa trạng thái và lịch sử sự kiện.',
      CURRENT_DATE + 40, CURRENT_DATE + 42,
      'Cần Thơ', 'cancelled', organizer_id,
      'https://images.unsplash.com/photo-1488229297570-58520851e868?auto=format&fit=crop&w=1200&q=80',
      240, CURRENT_DATE - 5, CURRENT_DATE + 10, CURRENT_DATE + 25,
      CURRENT_DATE + 18, true,
      ARRAY['Robot', 'Tự động hóa', 'Thị giác máy tính'],
      'online', false, false, 'Ban tổ chức RAS',
      'ras@example.com', '0901000006'
    )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    location = EXCLUDED.location,
    status = EXCLUDED.status,
    organizer_id = EXCLUDED.organizer_id,
    cover_image_url = EXCLUDED.cover_image_url,
    max_participants = EXCLUDED.max_participants,
    submission_deadline = EXCLUDED.submission_deadline,
    review_deadline = EXCLUDED.review_deadline,
    registration_deadline = EXCLUDED.registration_deadline,
    camera_ready_deadline = EXCLUDED.camera_ready_deadline,
    blind_review = EXCLUDED.blind_review,
    topics = EXCLUDED.topics,
    event_format = EXCLUDED.event_format,
    is_featured = EXCLUDED.is_featured,
    is_schedule_public = EXCLUDED.is_schedule_public,
    contact_name = EXCLUDED.contact_name,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    updated_at = now();

  INSERT INTO public.papers (
    id, conference_id, title, abstract, keywords, file_url,
    status, submitted_by, current_version
  )
  VALUES
    (
      'd0000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000001',
      'Khung năng lực số cho sinh viên trong môi trường học tập kết hợp',
      'Nghiên cứu đề xuất khung năng lực số và phương pháp đánh giá phù hợp với mô hình học tập kết hợp tại đại học.',
      'năng lực số, blended learning, giáo dục đại học',
      'https://arxiv.org/pdf/2303.08774', 'submitted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000002',
      'c0000000-0000-0000-0000-000000000002',
      'Mô hình học sâu phát hiện bất thường trong dữ liệu chuỗi thời gian',
      'Bài báo khảo sát và đánh giá mô hình học sâu dùng để phát hiện bất thường trong dữ liệu cảm biến nhiều biến.',
      'deep learning, anomaly detection, time series',
      'https://arxiv.org/pdf/2009.07436', 'under_review', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000003',
      'c0000000-0000-0000-0000-000000000002',
      'Trợ lý học tập tiếng Việt dựa trên mô hình ngôn ngữ lớn',
      'Nghiên cứu trình bày kiến trúc trợ lý học tập, cơ chế truy xuất tri thức và phương pháp đánh giá câu trả lời tiếng Việt.',
      'LLM, RAG, trợ lý học tập, tiếng Việt',
      'https://arxiv.org/pdf/2005.11401', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000004',
      'c0000000-0000-0000-0000-000000000003',
      'Phát hiện xâm nhập mạng bằng học liên kết bảo vệ dữ liệu',
      'Phương pháp huấn luyện học liên kết cho phép nhiều đơn vị phối hợp phát hiện tấn công mà không chia sẻ dữ liệu thô.',
      'federated learning, intrusion detection, privacy',
      'https://arxiv.org/pdf/1602.05629', 'revision_required', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000005',
      'c0000000-0000-0000-0000-000000000004',
      'Nền tảng IoT giám sát chất lượng không khí đô thị theo thời gian thực',
      'Hệ thống kết hợp mạng cảm biến, xử lý luồng và bảng điều khiển để theo dõi chất lượng không khí tại đô thị.',
      'IoT, smart city, air quality, stream processing',
      'https://arxiv.org/pdf/1706.03762', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000006',
      'c0000000-0000-0000-0000-000000000004',
      'Tối ưu điều phối giao thông bằng học tăng cường đa tác tử',
      'Bài báo áp dụng học tăng cường đa tác tử để điều khiển tín hiệu giao thông thích nghi theo mật độ phương tiện.',
      'multi-agent, reinforcement learning, traffic control',
      'https://arxiv.org/pdf/1911.10635', 'under_review', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000007',
      'c0000000-0000-0000-0000-000000000005',
      'Kiểm thử dựa trên thuộc tính cho dịch vụ phân tán',
      'Nghiên cứu đánh giá hiệu quả của kiểm thử dựa trên thuộc tính trong việc phát hiện lỗi nhất quán ở dịch vụ phân tán.',
      'property-based testing, distributed systems, software testing',
      'https://arxiv.org/pdf/1901.01930', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000008',
      'c0000000-0000-0000-0000-000000000005',
      'Dự đoán lỗi phần mềm từ lịch sử thay đổi mã nguồn',
      'Mô hình kết hợp đặc trưng quy trình và biểu diễn mã nguồn để dự đoán mô-đun có nguy cơ phát sinh lỗi.',
      'defect prediction, source code, software analytics',
      'https://arxiv.org/pdf/1807.00537', 'rejected', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000009',
      'c0000000-0000-0000-0000-000000000006',
      'Điều khiển cánh tay robot bằng thị giác và học bắt chước',
      'Bài báo nghiên cứu mô hình học bắt chước từ dữ liệu hình ảnh để thực hiện các tác vụ gắp và đặt vật thể.',
      'robotics, imitation learning, computer vision',
      'https://arxiv.org/pdf/1810.04805', 'submitted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000010',
      'c0000000-0000-0000-0000-000000000001',
      'Thiết kế hệ sinh thái học tập thích ứng trong giáo dục đại học',
      'Nghiên cứu đề xuất kiến trúc học tập thích ứng dựa trên hồ sơ người học, phân tích dữ liệu và phản hồi theo thời gian thực.',
      'adaptive learning, learning analytics, giáo dục đại học',
      'https://arxiv.org/pdf/2302.11382', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000011',
      'c0000000-0000-0000-0000-000000000003',
      'Phát hiện mã độc bằng biểu diễn đồ thị lời gọi hàm',
      'Bài báo xây dựng đồ thị lời gọi hàm và sử dụng mạng nơ-ron đồ thị để nhận diện các mẫu hành vi độc hại.',
      'malware detection, graph neural network, cyber security',
      'https://arxiv.org/pdf/2003.04094', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000012',
      'c0000000-0000-0000-0000-000000000006',
      'Lập kế hoạch chuyển động an toàn cho robot cộng tác',
      'Nghiên cứu trình bày phương pháp lập kế hoạch chuyển động có xét đến bất định khi robot làm việc cùng con người.',
      'collaborative robot, motion planning, human-robot interaction',
      'https://arxiv.org/pdf/2203.12644', 'accepted', author_id, 1
    )
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status;

  -- Các trạng thái kết quả phải có phản biện tương ứng. Nếu hệ thống chưa có
  -- một tài khoản phản biện khác tác giả, đưa các bài này về Chờ phân công.
  IF demo_reviewer_id IS NULL THEN
    UPDATE public.papers
    SET status = 'submitted'
    WHERE id BETWEEN
      'd0000000-0000-0000-0000-000000000001'::uuid AND
      'd0000000-0000-0000-0000-000000000012'::uuid
      AND status <> 'submitted';
  ELSE
    INSERT INTO public.reviews (
      id, paper_id, reviewer_id, status, score,
      originality_score, relevance_score, methodology_score,
      presentation_score, comments, recommendation, response_at, completed_at
    )
    SELECT
      ('d3000000-0000-0000-0000-' || lpad(item.paper_number::text, 12, '0'))::uuid,
      ('d0000000-0000-0000-0000-' || lpad(item.paper_number::text, 12, '0'))::uuid,
      demo_reviewer_id,
      item.review_status,
      item.score, item.score, item.score, item.score, item.score,
      item.comments,
      item.recommendation,
      CASE WHEN item.review_status IN ('in_progress', 'completed') THEN now() ELSE NULL END,
      CASE WHEN item.review_status = 'completed' THEN now() ELSE NULL END
    FROM (VALUES
      (2,  'assigned',   NULL::integer, ''::text, NULL::text),
      (3,  'completed',  9, 'Bài báo đáp ứng yêu cầu và được đề nghị chấp nhận.', 'accept'),
      (4,  'completed',  7, 'Bài báo cần chỉnh sửa theo nhận xét trước khi đánh giá lại.', 'revise'),
      (5,  'completed',  8, 'Nội dung phù hợp và kết quả được trình bày rõ ràng.', 'accept'),
      (6,  'in_progress',NULL::integer, ''::text, NULL::text),
      (7,  'completed',  8, 'Phương pháp hợp lý và có giá trị ứng dụng.', 'accept'),
      (8,  'completed',  4, 'Bài báo chưa đáp ứng yêu cầu về phương pháp và thực nghiệm.', 'reject'),
      (10, 'completed',  9, 'Giải pháp có tính thực tiễn và được trình bày thuyết phục.', 'accept'),
      (11, 'completed',  8, 'Kết quả nghiên cứu rõ ràng và phù hợp chủ đề hội thảo.', 'accept'),
      (12, 'completed',  8, 'Bài báo có đóng góp phù hợp và đủ điều kiện chấp nhận.', 'accept')
    ) AS item(paper_number, review_status, score, comments, recommendation)
    ON CONFLICT (paper_id, reviewer_id) DO UPDATE SET
      status = EXCLUDED.status,
      score = EXCLUDED.score,
      originality_score = EXCLUDED.originality_score,
      relevance_score = EXCLUDED.relevance_score,
      methodology_score = EXCLUDED.methodology_score,
      presentation_score = EXCLUDED.presentation_score,
      comments = EXCLUDED.comments,
      recommendation = EXCLUDED.recommendation,
      response_at = EXCLUDED.response_at,
      completed_at = EXCLUDED.completed_at;
  END IF;
END $$;

COMMIT;
-- END SECTION 20260925_conference_status_showcase

-- BEGIN SECTION 20260926_conference_field_backfill
-- Phân loại 10 hội thảo mẫu theo danh sách lĩnh vực/chủ đề của form.
-- Chạy sau các file seed. Có thể chạy lại, không thay đổi lịch hay trạng thái.
BEGIN;

ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE public.conferences DROP CONSTRAINT IF EXISTS conferences_field_check;
ALTER TABLE public.conferences ADD CONSTRAINT conferences_field_check CHECK (
  field IS NULL OR field IN (
    'Công nghệ thông tin', 'Kỹ thuật', 'Khoa học tự nhiên', 'Y tế',
    'Nông nghiệp', 'Môi trường', 'Kinh tế', 'Kinh doanh',
    'Giáo dục', 'Luật', 'Khoa học xã hội', 'Du lịch'
  )
);
COMMENT ON COLUMN public.conferences.field IS 'Lĩnh vực chính của hội thảo';

UPDATE public.conferences AS conference
SET field = mapping.field,
    topics = mapping.topics
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu']),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Kỹ thuật phần mềm', 'Trí tuệ nhân tạo']),
  ('a1000000-0000-0000-0000-000000000001'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo']),
  ('a1000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo']),
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'Giáo dục',
    ARRAY['Công nghệ giáo dục', 'Phương pháp giảng dạy']),
  ('c0000000-0000-0000-0000-000000000002'::uuid, 'Công nghệ thông tin',
    ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu']),
  ('c0000000-0000-0000-0000-000000000003'::uuid, 'Công nghệ thông tin',
    ARRAY['An toàn thông tin', 'Điện toán đám mây']),
  ('c0000000-0000-0000-0000-000000000004'::uuid, 'Công nghệ thông tin',
    ARRAY['IoT']),
  ('c0000000-0000-0000-0000-000000000005'::uuid, 'Công nghệ thông tin',
    ARRAY['Kỹ thuật phần mềm']),
  ('c0000000-0000-0000-0000-000000000006'::uuid, 'Kỹ thuật',
    ARRAY['Robot', 'Tự động hóa'])
) AS mapping(id, field, topics)
WHERE conference.id = mapping.id
  AND (conference.field IS DISTINCT FROM mapping.field
    OR conference.topics IS DISTINCT FROM mapping.topics);

NOTIFY pgrst, 'reload schema';
COMMIT;
-- END SECTION 20260926_conference_field_backfill

-- BEGIN SECTION multidisciplinary_demo
-- Hội thảo và bài báo giả lập phục vụ demo, không phải công bố khoa học thật.
-- Thêm bản ghi mới; cập nhật giới thiệu và tóm tắt cho các bản ghi đã có.
-- Mỗi bài báo mẫu có một liên kết PDF để có thể mở trực tiếp từ trang chi tiết.
BEGIN;
DO $$
DECLARE
  item record;
  organizer uuid;
  author_id uuid;
  conf_id uuid;
  paper_id uuid;
  paper_index integer;
BEGIN
  SELECT id INTO organizer FROM public.profiles
    WHERE role IN ('organizer', 'admin')
    ORDER BY CASE role WHEN 'organizer' THEN 0 ELSE 1 END, created_at, id LIMIT 1;
  SELECT id INTO author_id FROM public.profiles
    WHERE role IN ('author', 'admin')
    ORDER BY CASE role WHEN 'author' THEN 0 ELSE 1 END, created_at, id LIMIT 1;
  IF organizer IS NULL OR author_id IS NULL THEN
    RAISE EXCEPTION 'Cần có tài khoản organizer/admin và author/admin để thêm dữ liệu mẫu';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    (1, 'Công nghệ thông tin', 'Hội thảo Hệ thống số và Trí tuệ nhân tạo ứng dụng', 'Đà Nẵng', ARRAY['Trí tuệ nhân tạo','An toàn thông tin'], ARRAY['Phát hiện bất thường trong lưu lượng mạng bằng học máy','Trợ lý tra cứu tài liệu tiếng Việt dựa trên truy xuất ngữ nghĩa']),
    (2, 'Kỹ thuật', 'Hội thảo Cơ khí và Tự động hóa trong sản xuất', 'Hải Phòng', ARRAY['Cơ khí','Tự động hóa'], ARRAY['Thiết kế bộ điều khiển thích nghi cho cánh tay robot công nghiệp','Giám sát rung động để bảo trì dự đoán máy gia công']),
    (3, 'Khoa học tự nhiên', 'Hội nghị Vật liệu và Khoa học tự nhiên ứng dụng', 'Huế', ARRAY['Vật lý','Hóa học'], ARRAY['Mô phỏng khả năng dẫn nhiệt của vật liệu composite','Khảo sát khả năng hấp phụ phẩm màu của vật liệu sinh học']),
    (4, 'Y tế', 'Hội thảo Y tế công cộng và Công nghệ y sinh', 'TP. Hồ Chí Minh', ARRAY['Y tế công cộng','Công nghệ y sinh'], ARRAY['Thiết kế hệ thống theo dõi chỉ số sức khỏe từ xa','Khảo sát các yếu tố ảnh hưởng đến tiếp cận dịch vụ y tế cơ sở']),
    (5, 'Nông nghiệp', 'Hội thảo Nông nghiệp thông minh và Canh tác bền vững', 'Cần Thơ', ARRAY['Nông nghiệp thông minh','Trồng trọt'], ARRAY['Điều khiển tưới tự động dựa trên độ ẩm đất trong nhà kính','Nhận diện dấu hiệu bệnh trên lá lúa từ ảnh chụp đồng ruộng']),
    (6, 'Môi trường', 'Diễn đàn Tài nguyên và Môi trường bền vững', 'Đà Lạt', ARRAY['Xử lý chất thải','Biến đổi khí hậu'], ARRAY['Đánh giá mô hình phân loại rác tại nguồn trong khu dân cư','Mô phỏng nguy cơ ngập đô thị dưới các kịch bản mưa lớn']),
    (7, 'Kinh tế', 'Hội thảo Kinh tế số và Phát triển địa phương', 'Hà Nội', ARRAY['Kinh tế số','Kinh tế phát triển'], ARRAY['Phân tích mối liên hệ giữa hạ tầng số và năng suất doanh nghiệp','Đánh giá khả năng tiếp cận tài chính của hộ kinh doanh nhỏ']),
    (8, 'Kinh doanh', 'Hội nghị Quản trị doanh nghiệp và Thương mại điện tử', 'Bình Dương', ARRAY['Thương mại điện tử','Logistics và chuỗi cung ứng'], ARRAY['Các yếu tố ảnh hưởng đến ý định mua lại trên sàn thương mại điện tử','Tối ưu tuyến giao hàng chặng cuối cho doanh nghiệp bán lẻ']),
    (9, 'Giáo dục', 'Hội thảo Đổi mới giảng dạy và Công nghệ giáo dục', 'Hà Nội', ARRAY['Công nghệ giáo dục','Phương pháp giảng dạy'], ARRAY['Thiết kế học liệu tương tác cho lớp học kết hợp','Đánh giá hoạt động học tập theo dự án trong môn khoa học']),
    (10, 'Luật', 'Hội thảo Pháp luật kinh doanh và Sở hữu trí tuệ', 'TP. Hồ Chí Minh', ARRAY['Luật kinh tế','Sở hữu trí tuệ'], ARRAY['Phân tích cơ chế giải quyết tranh chấp trong giao dịch điện tử','Thảo luận quyền sở hữu trí tuệ đối với nội dung được tạo bằng AI']),
    (11, 'Khoa học xã hội', 'Hội nghị Văn hóa và Biến đổi xã hội', 'Huế', ARRAY['Xã hội học','Văn hóa học'], ARRAY['Khảo sát vai trò của mạng xã hội trong kết nối cộng đồng trẻ','Số hóa di sản văn hóa và sự tham gia của cộng đồng địa phương']),
    (12, 'Du lịch', 'Hội thảo Du lịch thông minh và Phát triển bền vững', 'Nha Trang', ARRAY['Du lịch thông minh','Du lịch bền vững'], ARRAY['Thiết kế hệ thống gợi ý lịch trình du lịch theo sở thích','Đánh giá sự tham gia của người dân trong du lịch cộng đồng'])
  ) AS samples(seq, field, title, location, topics, paper_titles)
  LOOP
    conf_id := ('e1000000-0000-0000-0000-' || lpad(item.seq::text, 12, '0'))::uuid;
    INSERT INTO public.conferences (
      id, title, description, field, topics, location, organizer_id,
      start_date, end_date, status, max_participants, event_format,
      submission_deadline, review_deadline, registration_deadline, camera_ready_deadline,
      blind_review, is_schedule_public, contact_name
    ) VALUES (
      conf_id, item.title,
      CASE item.seq
        WHEN 1 THEN 'Hội thảo kết nối các nhà nghiên cứu và chuyên gia công nghệ để trao đổi về trí tuệ nhân tạo, an toàn thông tin và hệ thống số. Chương trình tập trung vào ứng dụng học máy, xử lý ngôn ngữ tiếng Việt và bảo vệ hạ tầng mạng.'
        WHEN 2 THEN 'Hội thảo trao đổi các hướng nghiên cứu cơ khí, điều khiển và tự động hóa trong sản xuất. Các phiên chuyên đề tập trung vào robot công nghiệp, giám sát thiết bị và bảo trì nhằm nâng cao độ tin cậy của dây chuyền.'
        WHEN 3 THEN 'Hội nghị giới thiệu các hướng nghiên cứu vật lý, hóa học và vật liệu ứng dụng. Nội dung tập trung vào mô phỏng tính chất vật liệu, cơ chế truyền nhiệt và các giải pháp xử lý chất ô nhiễm.'
        WHEN 4 THEN 'Hội thảo tạo diễn đàn trao đổi về y tế công cộng và công nghệ y sinh. Chương trình đề cập đến theo dõi sức khỏe từ xa, quản lý dữ liệu sức khỏe và cải thiện khả năng tiếp cận dịch vụ y tế cơ sở.'
        WHEN 5 THEN 'Hội thảo thảo luận việc ứng dụng cảm biến, phân tích hình ảnh và tự động hóa trong canh tác. Các chủ đề hướng đến quản lý tưới, theo dõi sức khỏe cây trồng và sử dụng tài nguyên nông nghiệp hiệu quả.'
        WHEN 6 THEN 'Diễn đàn kết nối các nghiên cứu về quản lý chất thải và thích ứng với biến đổi khí hậu. Nội dung trao đổi gồm phân loại rác tại nguồn, mô hình ngập đô thị và sự tham gia của cộng đồng trong bảo vệ môi trường.'
        WHEN 7 THEN 'Hội thảo trao đổi về chuyển đổi kinh tế trong môi trường số và các điều kiện phát triển địa phương. Chương trình tập trung vào hạ tầng số, năng suất doanh nghiệp và khả năng tiếp cận tài chính của hộ kinh doanh.'
        WHEN 8 THEN 'Hội nghị thảo luận những thay đổi trong quản trị doanh nghiệp, thương mại điện tử và chuỗi cung ứng. Các phiên chuyên đề đề cập đến hành vi khách hàng, tổ chức phân phối và tối ưu hoạt động giao nhận.'
        WHEN 9 THEN 'Hội thảo chia sẻ phương pháp giảng dạy và ứng dụng công nghệ trong thiết kế hoạt động học tập. Nội dung tập trung vào học liệu tương tác, lớp học kết hợp và đánh giá năng lực thông qua học tập theo dự án.'
        WHEN 10 THEN 'Hội thảo trao đổi các vấn đề pháp lý đặt ra trong hoạt động kinh doanh và phát triển công nghệ. Các chủ đề gồm tranh chấp giao dịch điện tử, sở hữu trí tuệ và nội dung được tạo với sự hỗ trợ của trí tuệ nhân tạo.'
        WHEN 11 THEN 'Hội nghị thảo luận mối quan hệ giữa văn hóa, công nghệ và biến đổi xã hội. Chương trình tập trung vào kết nối cộng đồng trên mạng xã hội, số hóa di sản và vai trò của người dân trong bảo tồn văn hóa.'
        WHEN 12 THEN 'Hội thảo trao đổi các giải pháp phát triển du lịch dựa trên công nghệ và sự tham gia của cộng đồng. Nội dung bao gồm gợi ý lịch trình, nâng cao trải nghiệm du khách và cân bằng lợi ích trong du lịch bền vững.'
      END,
      item.field, item.topics, item.location, organizer,
      ((CURRENT_DATE + 60 + item.seq * 3) + time '08:30') AT TIME ZONE 'Asia/Ho_Chi_Minh',
      ((CURRENT_DATE + 61 + item.seq * 3) + time '17:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',
      'open', 150 + item.seq * 10, 'hybrid',
      now() + interval '30 days', now() + interval '45 days',
      now() + interval '55 days', now() + interval '50 days',
      false, true, 'Ban tổ chức ' || item.field
    ) ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;

    FOR paper_index IN 1..2 LOOP
      paper_id := ('e2000000-0000-0000-0000-' || lpad((item.seq * 10 + paper_index)::text, 12, '0'))::uuid;
      INSERT INTO public.papers (
        id, conference_id, title, abstract, keywords, file_url, status, submitted_by, current_version
      ) VALUES (
        paper_id, conf_id, item.paper_titles[paper_index],
        CASE item.seq
          WHEN 1 THEN (ARRAY['Nghiên cứu xem xét phương pháp phát hiện lưu lượng mạng bất thường thông qua các đặc trưng kết nối và mô hình học máy. Nội dung tập trung vào tiền xử lý dữ liệu, xử lý mất cân bằng nhãn và thiết kế đánh giá dựa trên khả năng phát hiện tấn công cùng tỷ lệ cảnh báo sai.', 'Bài viết trình bày kiến trúc trợ lý tra cứu tài liệu tiếng Việt kết hợp biểu diễn ngữ nghĩa và truy xuất văn bản. Các nội dung chính gồm phân đoạn tài liệu, lựa chọn đoạn liên quan và đánh giá mức độ phù hợp của câu trả lời với nguồn tham chiếu.'])[paper_index]
          WHEN 2 THEN (ARRAY['Bài viết trình bày hướng thiết kế bộ điều khiển thích nghi cho cánh tay robot khi tải trọng và điều kiện vận hành thay đổi. Mô hình động lực học, cơ chế điều chỉnh tham số và tiêu chí đánh giá sai số bám quỹ đạo được thảo luận trong bối cảnh sản xuất công nghiệp.', 'Nghiên cứu xây dựng quy trình phân tích tín hiệu rung động phục vụ theo dõi tình trạng máy gia công. Nội dung gồm thu thập tín hiệu, trích xuất đặc trưng và xác định dấu hiệu suy giảm thiết bị để hỗ trợ lập kế hoạch bảo trì.'])[paper_index]
          WHEN 3 THEN (ARRAY['Nghiên cứu xem xét sự truyền nhiệt trong vật liệu composite thông qua mô hình mô phỏng. Các yếu tố được phân tích gồm thành phần vật liệu, cấu trúc phân bố và điều kiện biên, từ đó xây dựng cách đánh giá đặc tính dẫn nhiệt.', 'Bài viết trình bày phương pháp khảo sát khả năng hấp phụ phẩm màu của vật liệu có nguồn gốc sinh học. Thiết kế khảo sát xem xét ảnh hưởng của độ pH, thời gian tiếp xúc và nồng độ ban đầu đến quá trình xử lý.'])[paper_index]
          WHEN 4 THEN (ARRAY['Bài viết trình bày kiến trúc hệ thống theo dõi chỉ số sức khỏe từ xa, bao gồm thiết bị thu thập, truyền dữ liệu và giao diện theo dõi. Nội dung nhấn mạnh độ tin cậy của dữ liệu, bảo vệ thông tin cá nhân và giới hạn sử dụng của hệ thống.', 'Nghiên cứu xây dựng khung khảo sát các yếu tố ảnh hưởng đến tiếp cận dịch vụ y tế cơ sở. Khoảng cách địa lý, chi phí, nguồn thông tin và trải nghiệm người sử dụng được xem xét nhằm nhận diện những rào cản cần cải thiện.'])[paper_index]
          WHEN 5 THEN (ARRAY['Bài viết trình bày mô hình điều khiển tưới trong nhà kính dựa trên dữ liệu cảm biến độ ẩm đất. Nội dung gồm bố trí cảm biến, lựa chọn ngưỡng điều khiển và phương pháp theo dõi lượng nước sử dụng theo nhu cầu cây trồng.', 'Nghiên cứu xem xét quy trình nhận diện dấu hiệu bệnh trên lá lúa từ ảnh chụp đồng ruộng. Các bước xử lý ảnh, xây dựng dữ liệu và đánh giá khả năng phân loại được thảo luận cùng những hạn chế do ánh sáng và nền ảnh.'])[paper_index]
          WHEN 6 THEN (ARRAY['Bài viết xây dựng khung đánh giá hoạt động phân loại rác tại nguồn trong khu dân cư. Nội dung tập trung vào mức độ tham gia, chất lượng phân loại và tổ chức thu gom để xác định những điều kiện duy trì mô hình.', 'Nghiên cứu trình bày cách mô phỏng nguy cơ ngập đô thị dưới các kịch bản mưa lớn. Dữ liệu địa hình, đặc điểm thoát nước và phân bố lượng mưa được kết hợp để phân tích các khu vực có khả năng chịu ảnh hưởng.'])[paper_index]
          WHEN 7 THEN (ARRAY['Nghiên cứu đề xuất khung phân tích mối liên hệ giữa hạ tầng số và năng suất doanh nghiệp. Nội dung xem xét khả năng kết nối, mức độ ứng dụng công nghệ và các yếu tố quy mô, ngành nghề có thể ảnh hưởng đến kết quả phân tích.', 'Bài viết xây dựng cách đánh giá khả năng tiếp cận nguồn vốn của hộ kinh doanh nhỏ. Các yếu tố được xem xét gồm hồ sơ tài chính, điều kiện vay, thông tin tín dụng và mức độ hiểu biết về các sản phẩm tài chính.'])[paper_index]
          WHEN 8 THEN (ARRAY['Nghiên cứu xây dựng mô hình phân tích ý định mua lại trên sàn thương mại điện tử. Chất lượng dịch vụ, niềm tin, trải nghiệm giao nhận và mức độ hài lòng được xem xét làm cơ sở thiết kế khảo sát người tiêu dùng.', 'Bài viết trình bày bài toán tối ưu tuyến giao hàng chặng cuối với các ràng buộc về tải trọng và thời gian phục vụ. Nội dung tập trung vào biểu diễn mạng giao nhận, lựa chọn phương án định tuyến và đánh giá chi phí vận hành.'])[paper_index]
          WHEN 9 THEN (ARRAY['Bài viết trình bày quy trình thiết kế học liệu tương tác cho lớp học kết hợp trực tiếp và trực tuyến. Nội dung gồm xác định mục tiêu học tập, xây dựng hoạt động và lựa chọn hình thức phản hồi phù hợp với người học.', 'Nghiên cứu xây dựng khung đánh giá hoạt động học tập theo dự án trong môn khoa học. Các tiêu chí bao gồm vận dụng kiến thức, hợp tác, giải quyết vấn đề và phản tư trong quá trình thực hiện dự án.'])[paper_index]
          WHEN 10 THEN (ARRAY['Bài viết phân tích các vấn đề cần xem xét khi giải quyết tranh chấp trong giao dịch điện tử. Nội dung tập trung vào chứng cứ điện tử, nhận diện các bên và lựa chọn phương thức giải quyết tranh chấp.', 'Bài viết thảo luận các cách tiếp cận quyền sở hữu trí tuệ đối với nội dung được tạo với sự hỗ trợ của AI. Mức độ đóng góp của con người, nguồn dữ liệu và trách nhiệm của các bên được đặt ra như những vấn đề cần phân tích.'])[paper_index]
          WHEN 11 THEN (ARRAY['Nghiên cứu xây dựng hướng khảo sát vai trò của mạng xã hội trong việc hình thành và duy trì kết nối của người trẻ. Nội dung xem xét hình thức tương tác, cảm nhận gắn kết và sự chuyển tiếp giữa quan hệ trực tuyến với đời sống cộng đồng.', 'Bài viết thảo luận quá trình số hóa di sản văn hóa gắn với sự tham gia của cộng đồng địa phương. Các vấn đề gồm lựa chọn nội dung, quyền tiếp cận, lưu giữ tri thức và phối hợp giữa đơn vị quản lý với người dân.'])[paper_index]
          WHEN 12 THEN (ARRAY['Bài viết trình bày thiết kế hệ thống gợi ý lịch trình dựa trên sở thích, thời gian và ngân sách của du khách. Nội dung tập trung vào biểu diễn điểm đến, phối hợp các ràng buộc và đánh giá mức độ phù hợp của lịch trình.', 'Nghiên cứu xây dựng khung đánh giá sự tham gia của người dân trong hoạt động du lịch cộng đồng. Nội dung xem xét vai trò ra quyết định, phân chia lợi ích và bảo tồn tài nguyên văn hóa, môi trường tại điểm đến.'])[paper_index]
        END,
        array_to_string(item.topics, ', '),
        CASE ((item.seq - 1) * 2 + paper_index) % 6
          WHEN 1 THEN 'https://arxiv.org/pdf/2303.08774'
          WHEN 2 THEN 'https://arxiv.org/pdf/2009.07436'
          WHEN 3 THEN 'https://arxiv.org/pdf/2005.11401'
          WHEN 4 THEN 'https://arxiv.org/pdf/1706.03762'
          WHEN 5 THEN 'https://arxiv.org/pdf/1911.10635'
          ELSE 'https://arxiv.org/pdf/2203.12644'
        END,
        'submitted', author_id, 1
      ) ON CONFLICT (id) DO UPDATE SET
        abstract = EXCLUDED.abstract,
        file_url = EXCLUDED.file_url,
        current_version = EXCLUDED.current_version;

      INSERT INTO public.paper_versions (
        paper_id, version_number, file_url, notes, uploaded_by
      )
      SELECT
        paper.id, 1, paper.file_url,
        'Bản PDF công khai từ arXiv, dùng làm dữ liệu demo.', author_id
      FROM public.papers AS paper
      WHERE paper.id = ('e2000000-0000-0000-0000-' || lpad((item.seq * 10 + paper_index)::text, 12, '0'))::uuid
      ON CONFLICT ON CONSTRAINT paper_versions_paper_id_version_number_key DO UPDATE SET
        file_url = EXCLUDED.file_url,
        notes = EXCLUDED.notes;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
-- END SECTION multidisciplinary_demo

-- BEGIN SECTION distribute_demo_papers
-- Chia đều 40 bài demo cho tất cả tài khoản tác giả hiện có.
-- Thứ tự ổn định giúp chạy lại migration mà không làm thay đổi ngẫu nhiên chủ bài.
BEGIN;

WITH author_pool AS (
  SELECT id AS author_id,
    row_number() OVER (ORDER BY created_at, id) AS author_rank
  FROM public.profiles
  WHERE role = 'author'
),
author_total AS (
  SELECT count(*)::bigint AS total FROM author_pool
),
demo_papers AS (
  SELECT id AS paper_id,
    row_number() OVER (ORDER BY id) AS paper_rank
  FROM public.papers
  WHERE id::text LIKE '20000000-0000-0000-0000-%'
     OR id::text LIKE 'd0000000-0000-0000-0000-%'
     OR id::text LIKE 'e2000000-0000-0000-0000-%'
),
assignments AS (
  SELECT demo_papers.paper_id, author_pool.author_id
  FROM demo_papers
  CROSS JOIN author_total
  JOIN author_pool
    ON author_pool.author_rank = ((demo_papers.paper_rank - 1) % author_total.total) + 1
  WHERE author_total.total > 0
)
UPDATE public.papers AS paper
SET submitted_by = assignments.author_id
FROM assignments
WHERE paper.id = assignments.paper_id
  AND paper.submitted_by IS DISTINCT FROM assignments.author_id;

UPDATE public.paper_versions AS version
SET uploaded_by = paper.submitted_by
FROM public.papers AS paper
WHERE version.paper_id = paper.id
  AND (
    paper.id::text LIKE '20000000-0000-0000-0000-%'
    OR paper.id::text LIKE 'd0000000-0000-0000-0000-%'
    OR paper.id::text LIKE 'e2000000-0000-0000-0000-%'
  )
  AND version.uploaded_by IS DISTINCT FROM paper.submitted_by;

COMMIT;
-- END SECTION distribute_demo_papers
