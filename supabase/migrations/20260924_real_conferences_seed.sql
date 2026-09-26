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
