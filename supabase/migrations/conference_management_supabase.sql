-- ============================================================
-- CONFERENCE MANAGEMENT SYSTEM
-- SUPABASE DATABASE SCHEMA - FINAL VERSION
-- ============================================================
-- Run this entire file in Supabase SQL Editor on a new project/database.
--
-- Roles:
--   admin, organizer, author, participant
--
-- Main entities:
--   profiles, conferences, participants, papers,
--   paper_authors, reviews, sessions, certificates
--
-- Security:
--   RLS enabled on every application table.
--   New users may self-select participant or author.
--   Review is an assignment on a specific paper, not a user role.
--   Admin and organizer roles must be granted by an admin.
--   Normal users cannot change their own role.
--   Organizers can only manage their own conferences.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'participant'
    CHECK (role IN ('admin', 'organizer', 'author', 'participant')),
  phone text DEFAULT '',
  organization text DEFAULT '',
  avatar_url text DEFAULT '',
  bio text DEFAULT '',
  notification_preferences jsonb NOT NULL DEFAULT '{"system": true, "messages": true, "reviews": true, "certificates": true}'::jsonb,
  language text NOT NULL DEFAULT 'vi'
    CHECK (language IN ('vi', 'en')),
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.conferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  location text DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'ongoing', 'completed', 'cancelled')),
  organizer_id uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cover_image_url text DEFAULT '',
  max_participants integer NOT NULL DEFAULT 0
    CHECK (max_participants >= 0),
  submission_deadline timestamptz,
  review_deadline timestamptz,
  registration_deadline timestamptz,
  camera_ready_deadline timestamptz,
  blind_review boolean NOT NULL DEFAULT false,
  topics text[] NOT NULL DEFAULT ARRAY[]::text[],
  event_format text NOT NULL DEFAULT 'offline'
    CHECK (event_format IN ('online', 'offline', 'hybrid')),
  is_featured boolean NOT NULL DEFAULT false,
  is_schedule_public boolean NOT NULL DEFAULT true,
  contact_name text DEFAULT '',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conferences_valid_date
    CHECK (end_date >= start_date)
);


CREATE TABLE IF NOT EXISTS public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  attended boolean NOT NULL DEFAULT false,
  attendance_code text NOT NULL DEFAULT gen_random_uuid()::text,

  UNIQUE (conference_id, user_id),
  UNIQUE (attendance_code)
);


CREATE TABLE IF NOT EXISTS public.papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  title text NOT NULL,
  abstract text DEFAULT '',
  keywords text DEFAULT '',
  file_url text DEFAULT '',
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN (
      'submitted',
      'under_review',
      'accepted',
      'rejected',
      'revision_required'
    )),
  submitted_by uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  current_version integer NOT NULL DEFAULT 1
    CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.paper_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL
    REFERENCES public.papers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_order integer NOT NULL DEFAULT 1
    CHECK (author_order > 0),

  UNIQUE (paper_id, user_id),
  UNIQUE (paper_id, author_order)
);


CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL
    REFERENCES public.papers(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed')),

  score integer
    CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
  originality_score integer
    CHECK (originality_score IS NULL OR (originality_score >= 0 AND originality_score <= 10)),
  relevance_score integer
    CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 10)),
  methodology_score integer
    CHECK (methodology_score IS NULL OR (methodology_score >= 0 AND methodology_score <= 10)),
  presentation_score integer
    CHECK (presentation_score IS NULL OR (presentation_score >= 0 AND presentation_score <= 10)),

  comments text DEFAULT '',

  recommendation text
    CHECK (
      recommendation IS NULL
      OR recommendation IN ('accept', 'reject', 'revise')
    ),

  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  UNIQUE (paper_id, reviewer_id)
);


CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  room text DEFAULT '',
  speaker_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  paper_id uuid
    REFERENCES public.papers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sessions_valid_time
    CHECK (end_time > start_time)
);


CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number text NOT NULL DEFAULT gen_random_uuid()::text,
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  certificate_type text NOT NULL
    CHECK (certificate_type IN ('attendance', 'presentation')),
  issued_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conference_id, user_id, certificate_type),
  UNIQUE (certificate_number)
);


CREATE TABLE IF NOT EXISTS public.conference_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff'
    CHECK (role IN ('owner', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (conference_id, user_id)
);


CREATE TABLE IF NOT EXISTS public.paper_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL
    REFERENCES public.papers(id) ON DELETE CASCADE,
  version_number integer NOT NULL
    CHECK (version_number > 0),
  file_url text NOT NULL DEFAULT '',
  notes text DEFAULT '',
  uploaded_by uuid NOT NULL DEFAULT auth.uid()
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (paper_id, version_number)
);


CREATE TABLE IF NOT EXISTS public.reviewer_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL
    REFERENCES public.papers(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (paper_id, reviewer_id)
);


CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'success', 'warning', 'error')),
  category text NOT NULL DEFAULT 'system'
    CHECK (category IN ('system', 'messages', 'reviews', 'certificates')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.conference_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  title text DEFAULT '',
  organization text DEFAULT '',
  bio text DEFAULT '',
  avatar_url text DEFAULT '',
  is_keynote boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 1 CHECK (display_order > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.conference_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL
    REFERENCES public.conferences(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);


-- Safe directory for user pickers, including the contact email needed by
-- organizers when managing registrations.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';

DROP VIEW IF EXISTS public.profile_directory;
CREATE VIEW public.profile_directory AS
SELECT
  id,
  full_name,
  role,
  organization,
  avatar_url,
  contact_email AS email,
  created_at,
  updated_at
FROM public.profiles;


-- Keep this script useful for databases that already ran an older version.
ALTER TABLE public.conferences
  ALTER COLUMN organizer_id SET DEFAULT auth.uid(),
  ALTER COLUMN max_participants SET DEFAULT 0;

-- Convert installations created with the former reviewer role. Review access is
-- now determined by an assignment in public.reviews, so the account remains usable.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'organizer', 'reviewer', 'author', 'participant'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{"system": true, "messages": true, "reviews": true, "certificates": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'vi',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('system', 'messages', 'reviews', 'certificates'));

ALTER TABLE public.papers
  ALTER COLUMN submitted_by SET DEFAULT auth.uid();

ALTER TABLE public.conferences
  ADD COLUMN IF NOT EXISTS submission_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS review_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS registration_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS camera_ready_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS blind_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS event_format text NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_schedule_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone text DEFAULT '';

ALTER TABLE public.papers
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS originality_score integer,
  ADD COLUMN IF NOT EXISTS relevance_score integer,
  ADD COLUMN IF NOT EXISTS methodology_score integer,
  ADD COLUMN IF NOT EXISTS presentation_score integer;

ALTER TABLE public.participants
  ALTER COLUMN attendance_code SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.certificates
  ALTER COLUMN certificate_number SET DEFAULT gen_random_uuid()::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conferences_valid_date'
      AND conrelid = 'public.conferences'::regclass
  ) THEN
    ALTER TABLE public.conferences
      ADD CONSTRAINT conferences_valid_date CHECK (end_date >= start_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'participants_attendance_code_key'
      AND conrelid = 'public.participants'::regclass
  ) THEN
    ALTER TABLE public.participants
      ADD CONSTRAINT participants_attendance_code_key UNIQUE (attendance_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paper_authors_paper_id_author_order_key'
      AND conrelid = 'public.paper_authors'::regclass
  ) THEN
    ALTER TABLE public.paper_authors
      ADD CONSTRAINT paper_authors_paper_id_author_order_key UNIQUE (paper_id, author_order);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_valid_time'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_valid_time CHECK (end_time > start_time);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'certificates_certificate_number_key'
      AND conrelid = 'public.certificates'::regclass
  ) THEN
    ALTER TABLE public.certificates
      ADD CONSTRAINT certificates_certificate_number_key UNIQUE (certificate_number);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conferences_event_format_check'
      AND conrelid = 'public.conferences'::regclass
  ) THEN
    ALTER TABLE public.conferences
      ADD CONSTRAINT conferences_event_format_check
      CHECK (event_format IN ('online', 'offline', 'hybrid'));
  END IF;
END $$;


-- ============================================================
-- 2. ENABLE RLS
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conference_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviewer_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conference_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conference_announcements ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 3. HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    public.get_current_user_role() = 'admin',
    false
  );
$$;


CREATE OR REPLACE FUNCTION public.is_organizer_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    public.get_current_user_role() IN ('organizer', 'admin'),
    false
  );
$$;


CREATE OR REPLACE FUNCTION public.is_conference_organizer(conf_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conf_id
      AND (
        c.organizer_id = auth.uid()
        OR public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.conference_staff cs
          WHERE cs.conference_id = c.id
            AND cs.user_id = auth.uid()
        )
      )
  );
$$;


CREATE OR REPLACE FUNCTION public.can_read_paper(target_paper_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = target_paper_id
      AND (
        p.submitted_by = auth.uid()
        OR public.is_conference_organizer(p.conference_id)
        OR EXISTS (
          SELECT 1
          FROM public.reviews r
          WHERE r.paper_id = p.id
            AND r.reviewer_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.paper_authors pa
          WHERE pa.paper_id = p.id
            AND pa.user_id = auth.uid()
        )
      )
  );
$$;


CREATE OR REPLACE FUNCTION public.can_register_for_conference(conf_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conf_id
      AND c.status = 'open'
      AND (
        c.registration_deadline IS NULL
        OR now() <= c.registration_deadline
      )
      AND (
        c.max_participants = 0
        OR (
          SELECT COUNT(*)
          FROM public.participants p
          WHERE p.conference_id = c.id
        ) < c.max_participants
      )
  );
$$;


-- ============================================================
-- 4. USER PROFILE TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Users may self-select normal roles, but never admin/organizer.
  INSERT INTO public.profiles (
    id,
    full_name,
    role
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' IN ('participant', 'author', 'reviewer')
        THEN NEW.raw_user_meta_data->>'role'
      ELSE 'participant'
    END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 5. PROTECT PROFILE ROLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow database migrations / SQL Editor maintenance.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- An admin must not change their own role from the client.
  IF NEW.role IS DISTINCT FROM OLD.role
    AND auth.uid() = OLD.id THEN
    RAISE EXCEPTION 'Administrators cannot change their own role';
  END IF;

  -- Admin may change another user's role.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Everyone else may not change role.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'You are not allowed to change your role';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS protect_profile_role_trigger
ON public.profiles;

CREATE TRIGGER protect_profile_role_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();


CREATE OR REPLACE FUNCTION public.prevent_last_admin_demotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.role = 'admin'
    AND NEW.role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE role = 'admin'
        AND id <> OLD.id
    ) THEN
    RAISE EXCEPTION 'The system must retain at least one administrator';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS prevent_last_admin_demotion_trigger
ON public.profiles;

CREATE TRIGGER prevent_last_admin_demotion_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_last_admin_demotion();


-- ============================================================
-- 6. PROTECT CONFERENCE AND PAPER WORKFLOW
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_conference_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow database migrations / SQL Editor maintenance.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id THEN
    RAISE EXCEPTION 'Only an administrator can transfer conference ownership';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS protect_conference_owner_trigger
ON public.conferences;

CREATE TRIGGER protect_conference_owner_trigger
BEFORE UPDATE ON public.conferences
FOR EACH ROW
EXECUTE FUNCTION public.protect_conference_owner();

CREATE OR REPLACE FUNCTION public.protect_paper_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow database migrations / SQL Editor maintenance.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Organizer/admin may manage paper workflow.
  IF public.is_conference_organizer(OLD.conference_id)
    AND public.is_conference_organizer(NEW.conference_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.abstract IS DISTINCT FROM OLD.abstract
    OR NEW.keywords IS DISTINCT FROM OLD.keywords
    OR NEW.file_url IS DISTINCT FROM OLD.file_url THEN
    IF EXISTS (
      SELECT 1
      FROM public.conferences c
      WHERE c.id = OLD.conference_id
        AND (
          (
            OLD.status IN ('accepted', 'revision_required')
            AND c.camera_ready_deadline IS NOT NULL
            AND now() > c.camera_ready_deadline
          )
          OR (
            OLD.status NOT IN ('accepted', 'revision_required')
            AND c.submission_deadline IS NOT NULL
            AND now() > c.submission_deadline
          )
        )
    ) THEN
      RAISE EXCEPTION 'The deadline for updating this paper has passed';
    END IF;
  END IF;

  -- Authors cannot move a paper to another conference.
  IF NEW.conference_id IS DISTINCT FROM OLD.conference_id THEN
    RAISE EXCEPTION 'Authors cannot change the conference of a paper';
  END IF;

  -- Authors cannot change the paper owner.
  IF NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
    RAISE EXCEPTION 'Authors cannot change the paper owner';
  END IF;

  -- Authors cannot change paper status.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Authors cannot change paper status';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS protect_paper_fields_trigger
ON public.papers;

CREATE TRIGGER protect_paper_fields_trigger
BEFORE UPDATE ON public.papers
FOR EACH ROW
EXECUTE FUNCTION public.protect_paper_fields();


CREATE OR REPLACE FUNCTION public.replace_paper_authors(
  target_paper_id uuid,
  author_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  author_count integer := COALESCE(cardinality(author_ids), 0);
  distinct_author_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = target_paper_id
      AND (
        p.submitted_by = auth.uid()
        OR public.is_conference_organizer(p.conference_id)
      )
  ) THEN
    RAISE EXCEPTION 'You are not allowed to update this paper authors list';
  END IF;

  SELECT COUNT(DISTINCT author_id)
  INTO distinct_author_count
  FROM unnest(COALESCE(author_ids, ARRAY[]::uuid[])) AS selected(author_id);

  IF author_count <> distinct_author_count THEN
    RAISE EXCEPTION 'An author can only be added once';
  END IF;

  DELETE FROM public.paper_authors
  WHERE paper_id = target_paper_id;

  INSERT INTO public.paper_authors (paper_id, user_id, author_order)
  SELECT target_paper_id, author_id, author_order
  FROM unnest(COALESCE(author_ids, ARRAY[]::uuid[]))
    WITH ORDINALITY AS selected(author_id, author_order);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_paper_authors(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_paper_authors(uuid, uuid[]) TO authenticated;


-- ============================================================
-- 7. VALIDATE SESSION PAPER
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_session_paper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paper_conference_id uuid;
BEGIN
  IF NEW.paper_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conference_id
  INTO paper_conference_id
  FROM public.papers
  WHERE id = NEW.paper_id;

  IF paper_conference_id IS NULL THEN
    RAISE EXCEPTION 'Paper does not exist';
  END IF;

  IF paper_conference_id <> NEW.conference_id THEN
    RAISE EXCEPTION
      'Paper and session must belong to the same conference';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS validate_session_paper_trigger
ON public.sessions;

CREATE TRIGGER validate_session_paper_trigger
BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.validate_session_paper();


-- ============================================================
-- 8. VALIDATE REVIEWER
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_review_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
  FROM public.profiles
    WHERE id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'Reviewer profile does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = NEW.paper_id
      AND p.submitted_by = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'Reviewer cannot review their own paper';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.paper_authors pa
    WHERE pa.paper_id = NEW.paper_id
      AND pa.user_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'Reviewer cannot review a paper they co-authored';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reviewer_conflicts rc
    WHERE rc.paper_id = NEW.paper_id
      AND rc.reviewer_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'Reviewer has declared a conflict of interest for this paper';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS validate_review_assignment_trigger
ON public.reviews;

CREATE TRIGGER validate_review_assignment_trigger
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.validate_review_assignment();


CREATE OR REPLACE FUNCTION public.protect_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow database migrations / SQL Editor maintenance and organizers.
  IF auth.uid() IS NULL
    OR public.is_admin()
    OR public.is_conference_organizer(
      (SELECT conference_id FROM public.papers WHERE id = OLD.paper_id)
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW.paper_id IS DISTINCT FROM OLD.paper_id
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
    RAISE EXCEPTION 'Review assignment fields cannot be changed by the reviewer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = OLD.paper_id
      AND c.review_deadline IS NOT NULL
      AND now() > c.review_deadline
  ) THEN
    RAISE EXCEPTION 'The review deadline has passed';
  END IF;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS protect_review_fields_trigger
ON public.reviews;

CREATE TRIGGER protect_review_fields_trigger
BEFORE UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.protect_review_fields();


-- ============================================================
-- 9. AUDIT AND NOTIFICATION HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.write_audit_log(
  action_name text,
  entity_name text,
  target_id uuid,
  detail_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), action_name, entity_name, target_id, detail_data);
END;
$$;


CREATE OR REPLACE FUNCTION public.create_notification(
  target_user_id uuid,
  notification_title text,
  notification_message text,
  notification_type text DEFAULT 'info'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE((
    SELECT (notification_preferences->>'system')::boolean
    FROM public.profiles
    WHERE id = target_user_id
  ), true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, category)
    VALUES (target_user_id, notification_title, notification_message, notification_type, 'system');
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.create_notification(
  target_user_id uuid,
  notification_title text,
  notification_message text,
  notification_type text,
  notification_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  IF notification_category NOT IN ('system', 'messages', 'reviews', 'certificates') THEN
    RAISE EXCEPTION 'Invalid notification category';
  END IF;

  IF COALESCE((
    SELECT (notification_preferences->>notification_category)::boolean
    FROM public.profiles
    WHERE id = target_user_id
  ), true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, category)
    VALUES (
      target_user_id,
      notification_title,
      notification_message,
      notification_type,
      notification_category
    );
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.write_audit_log(
      'profile.role_changed',
      'profile',
      NEW.id,
      jsonb_build_object(
        'full_name', NEW.full_name,
        'previous_role', OLD.role,
        'new_role', NEW.role
      )
    );
  END IF;
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS audit_profile_role_change_trigger
ON public.profiles;

CREATE TRIGGER audit_profile_role_change_trigger
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.audit_profile_role_change();


CREATE OR REPLACE FUNCTION public.audit_conference_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit_log(
    'conference.created',
    'conference',
    NEW.id,
    jsonb_build_object('title', NEW.title)
  );
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit_paper_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit_log(
    'paper.submitted',
    'paper',
    NEW.id,
    jsonb_build_object('title', NEW.title, 'conference_id', NEW.conference_id)
  );
  PERFORM public.create_notification(
    NEW.submitted_by,
    'Đã nộp bài báo',
    'Bài báo "' || NEW.title || '" đã được ghi nhận trong hệ thống.',
    'success'
  );
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit_review_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paper_title text;
BEGIN
  SELECT title INTO paper_title
  FROM public.papers
  WHERE id = NEW.paper_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log(
      'review.assigned',
      'review',
      NEW.id,
      jsonb_build_object('paper_id', NEW.paper_id, 'reviewer_id', NEW.reviewer_id)
    );
  PERFORM public.create_notification(
    NEW.reviewer_id,
    'Bạn được phân công phản biện',
    'Bài báo "' || COALESCE(paper_title, 'N/A') || '" đang chờ bạn đánh giá.',
    'info',
    'reviews'
    );
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.write_audit_log(
      'review.completed',
      'review',
      NEW.id,
      jsonb_build_object('paper_id', NEW.paper_id, 'score', NEW.score, 'recommendation', NEW.recommendation)
    );
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit_certificate_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit_log(
    'certificate.issued',
    'certificate',
    NEW.id,
    jsonb_build_object('certificate_number', NEW.certificate_number, 'user_id', NEW.user_id)
  );
  PERFORM public.create_notification(
    NEW.user_id,
    'Chứng nhận đã được cấp',
    'Mã chứng nhận của bạn là ' || NEW.certificate_number,
    'success',
    'certificates'
  );
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.audit_conference_staff_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log(
      'conference_staff.added',
      'conference_staff',
      NEW.id,
      jsonb_build_object('conference_id', NEW.conference_id, 'user_id', NEW.user_id)
    );
    PERFORM public.create_notification(
      NEW.user_id,
      'Bạn đã được thêm vào ban tổ chức',
      'Bạn có quyền hỗ trợ quản lý một hội thảo trong ConfManager.',
      'success'
    );
    RETURN NEW;
  END IF;

  PERFORM public.write_audit_log(
    'conference_staff.removed',
    'conference_staff',
    OLD.id,
    jsonb_build_object('conference_id', OLD.conference_id, 'user_id', OLD.user_id)
  );
  PERFORM public.create_notification(
    OLD.user_id,
    'Quyền staff đã được gỡ',
    'Bạn không còn được phân công hỗ trợ hội thảo này.',
    'info'
  );
  RETURN OLD;
END;
$$;


DROP TRIGGER IF EXISTS audit_conference_insert_trigger
ON public.conferences;

CREATE TRIGGER audit_conference_insert_trigger
AFTER INSERT ON public.conferences
FOR EACH ROW
EXECUTE FUNCTION public.audit_conference_insert();


DROP TRIGGER IF EXISTS audit_paper_insert_trigger
ON public.papers;

CREATE TRIGGER audit_paper_insert_trigger
AFTER INSERT ON public.papers
FOR EACH ROW
EXECUTE FUNCTION public.audit_paper_insert();


DROP TRIGGER IF EXISTS audit_review_change_trigger
ON public.reviews;

CREATE TRIGGER audit_review_change_trigger
AFTER INSERT OR UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.audit_review_change();


DROP TRIGGER IF EXISTS audit_certificate_insert_trigger
ON public.certificates;

CREATE TRIGGER audit_certificate_insert_trigger
AFTER INSERT ON public.certificates
FOR EACH ROW
EXECUTE FUNCTION public.audit_certificate_insert();


DROP TRIGGER IF EXISTS audit_conference_staff_change_trigger
ON public.conference_staff;

CREATE TRIGGER audit_conference_staff_change_trigger
AFTER INSERT OR DELETE ON public.conference_staff
FOR EACH ROW
EXECUTE FUNCTION public.audit_conference_staff_change();


-- ============================================================
-- 10. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS profiles_set_updated_at
ON public.profiles;

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS conferences_set_updated_at
ON public.conferences;

CREATE TRIGGER conferences_set_updated_at
BEFORE UPDATE ON public.conferences
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS papers_set_updated_at
ON public.papers;

CREATE TRIGGER papers_set_updated_at
BEFORE UPDATE ON public.papers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 10. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conferences_status
  ON public.conferences(status);

CREATE INDEX IF NOT EXISTS idx_conferences_organizer
  ON public.conferences(organizer_id);

CREATE INDEX IF NOT EXISTS idx_conferences_public_listing
  ON public.conferences(is_featured, start_date, status);

CREATE INDEX IF NOT EXISTS idx_conference_speakers_conference
  ON public.conference_speakers(conference_id, display_order);

CREATE INDEX IF NOT EXISTS idx_conference_announcements_public
  ON public.conference_announcements(conference_id, is_public, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_participants_conference
  ON public.participants(conference_id);

CREATE INDEX IF NOT EXISTS idx_participants_user
  ON public.participants(user_id);

CREATE INDEX IF NOT EXISTS idx_papers_conference
  ON public.papers(conference_id);

CREATE INDEX IF NOT EXISTS idx_papers_submitted_by
  ON public.papers(submitted_by);

CREATE INDEX IF NOT EXISTS idx_papers_status
  ON public.papers(status);

CREATE INDEX IF NOT EXISTS idx_reviews_paper
  ON public.reviews(paper_id);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON public.reviews(reviewer_id);

CREATE INDEX IF NOT EXISTS idx_sessions_conference
  ON public.sessions(conference_id);

CREATE INDEX IF NOT EXISTS idx_sessions_paper
  ON public.sessions(paper_id);

CREATE INDEX IF NOT EXISTS idx_certificates_user
  ON public.certificates(user_id);

CREATE INDEX IF NOT EXISTS idx_certificates_conference
  ON public.certificates(conference_id);

CREATE INDEX IF NOT EXISTS idx_paper_authors_paper
  ON public.paper_authors(paper_id);

CREATE INDEX IF NOT EXISTS idx_paper_authors_user
  ON public.paper_authors(user_id);

CREATE INDEX IF NOT EXISTS idx_conference_staff_conference
  ON public.conference_staff(conference_id);

CREATE INDEX IF NOT EXISTS idx_conference_staff_user
  ON public.conference_staff(user_id);

CREATE INDEX IF NOT EXISTS idx_paper_versions_paper
  ON public.paper_versions(paper_id, version_number);

CREATE INDEX IF NOT EXISTS idx_reviewer_conflicts_reviewer
  ON public.reviewer_conflicts(reviewer_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs(entity_type, entity_id, created_at DESC);


-- ============================================================
-- 11. DROP OLD POLICIES
-- ============================================================

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

DROP POLICY IF EXISTS "conferences_select_all" ON public.conferences;
DROP POLICY IF EXISTS "conferences_insert_organizer" ON public.conferences;
DROP POLICY IF EXISTS "conferences_update_organizer" ON public.conferences;
DROP POLICY IF EXISTS "conferences_delete_organizer" ON public.conferences;

DROP POLICY IF EXISTS "participants_select_own_or_organizer" ON public.participants;
DROP POLICY IF EXISTS "participants_insert_own" ON public.participants;
DROP POLICY IF EXISTS "participants_update_organizer" ON public.participants;
DROP POLICY IF EXISTS "participants_delete_own_or_organizer" ON public.participants;

DROP POLICY IF EXISTS "papers_select_own_or_reviewer_or_organizer" ON public.papers;
DROP POLICY IF EXISTS "papers_insert_own" ON public.papers;
DROP POLICY IF EXISTS "papers_update_own" ON public.papers;
DROP POLICY IF EXISTS "papers_delete_own" ON public.papers;

DROP POLICY IF EXISTS "paper_authors_select_related" ON public.paper_authors;
DROP POLICY IF EXISTS "paper_authors_insert_paper_owner" ON public.paper_authors;
DROP POLICY IF EXISTS "paper_authors_delete_paper_owner" ON public.paper_authors;

DROP POLICY IF EXISTS "reviews_select_reviewer_or_author_or_organizer" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_organizer" ON public.reviews;
DROP POLICY IF EXISTS "reviews_update_reviewer" ON public.reviews;
DROP POLICY IF EXISTS "reviews_update_reviewer_or_organizer" ON public.reviews;
DROP POLICY IF EXISTS "reviews_delete_organizer" ON public.reviews;

DROP POLICY IF EXISTS "sessions_select_all" ON public.sessions;
DROP POLICY IF EXISTS "sessions_select_public" ON public.sessions;
DROP POLICY IF EXISTS "sessions_select_organizer" ON public.sessions;
DROP POLICY IF EXISTS "sessions_insert_organizer" ON public.sessions;
DROP POLICY IF EXISTS "sessions_update_organizer" ON public.sessions;
DROP POLICY IF EXISTS "sessions_delete_organizer" ON public.sessions;

DROP POLICY IF EXISTS "certificates_select_own_or_organizer" ON public.certificates;
DROP POLICY IF EXISTS "certificates_insert_organizer" ON public.certificates;
DROP POLICY IF EXISTS "certificates_delete_organizer" ON public.certificates;

DROP POLICY IF EXISTS "conference_staff_select_related" ON public.conference_staff;
DROP POLICY IF EXISTS "conference_staff_manage_owner" ON public.conference_staff;
DROP POLICY IF EXISTS "paper_versions_select_related" ON public.paper_versions;
DROP POLICY IF EXISTS "paper_versions_insert_owner" ON public.paper_versions;
DROP POLICY IF EXISTS "reviewer_conflicts_select_related" ON public.reviewer_conflicts;
DROP POLICY IF EXISTS "reviewer_conflicts_manage_self" ON public.reviewer_conflicts;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;

DROP POLICY IF EXISTS "conference_speakers_select_public" ON public.conference_speakers;
DROP POLICY IF EXISTS "conference_speakers_manage_organizer" ON public.conference_speakers;
DROP POLICY IF EXISTS "conference_announcements_select_public" ON public.conference_announcements;
DROP POLICY IF EXISTS "conference_announcements_manage_organizer" ON public.conference_announcements;


-- ============================================================
-- 12. PROFILES POLICIES
-- ============================================================

CREATE POLICY "profiles_select_all"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR public.is_admin()
  OR public.get_current_user_role() = 'organizer'
);


CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() = id
  OR public.is_admin()
)
WITH CHECK (
  auth.uid() = id
  OR public.is_admin()
);


CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = id
  AND role IN ('participant', 'author')
);


-- ============================================================
-- 13. CONFERENCE POLICIES
-- ============================================================

CREATE POLICY "conferences_select_all"
ON public.conferences
FOR SELECT
TO anon, authenticated
USING (
  status <> 'draft'
  OR public.is_conference_organizer(id)
);


CREATE POLICY "conferences_insert_organizer"
ON public.conferences
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin()
  OR (
    public.get_current_user_role() = 'organizer'
    AND organizer_id = auth.uid()
  )
);


CREATE POLICY "conferences_update_organizer"
ON public.conferences
FOR UPDATE
TO authenticated
USING (
  public.is_conference_organizer(id)
)
WITH CHECK (
  public.is_conference_organizer(id)
);


CREATE POLICY "conferences_delete_organizer"
ON public.conferences
FOR DELETE
TO authenticated
USING (
  public.is_conference_organizer(id)
);


-- ============================================================
-- 14. PARTICIPANT POLICIES
-- ============================================================

CREATE POLICY "participants_select_own_or_organizer"
ON public.participants
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


CREATE POLICY "participants_insert_own"
ON public.participants
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.can_register_for_conference(conference_id)
);


CREATE POLICY "participants_update_organizer"
ON public.participants
FOR UPDATE
TO authenticated
USING (
  public.is_conference_organizer(conference_id)
)
WITH CHECK (
  public.is_conference_organizer(conference_id)
);


CREATE POLICY "participants_delete_own_or_organizer"
ON public.participants
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


-- ============================================================
-- 15. PAPER POLICIES
-- ============================================================

CREATE POLICY "papers_select_own_or_reviewer_or_organizer"
ON public.papers
FOR SELECT
TO authenticated
USING (
  public.can_read_paper(id)
);


CREATE POLICY "papers_insert_own"
ON public.papers
FOR INSERT
TO authenticated
WITH CHECK (
  submitted_by = auth.uid()
  AND public.get_current_user_role() IN ('author', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conference_id
      AND c.status = 'open'
      AND (
        c.submission_deadline IS NULL
        OR now() <= c.submission_deadline
      )
  )
);


CREATE POLICY "papers_update_own"
ON public.papers
FOR UPDATE
TO authenticated
USING (
  submitted_by = auth.uid()
  OR public.is_conference_organizer(conference_id)
)
WITH CHECK (
  submitted_by = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


CREATE POLICY "papers_delete_own"
ON public.papers
FOR DELETE
TO authenticated
USING (
  submitted_by = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


-- ============================================================
-- 16. PAPER AUTHORS POLICIES
-- ============================================================

CREATE POLICY "paper_authors_select_related"
ON public.paper_authors
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = paper_id
      AND public.can_read_paper(p.id)
      AND NOT (
        c.blind_review
        AND NOT public.is_conference_organizer(p.conference_id)
        AND EXISTS (
          SELECT 1
          FROM public.reviews r
          WHERE r.paper_id = p.id
            AND r.reviewer_id = auth.uid()
        )
      )
  )
);


CREATE POLICY "paper_authors_insert_paper_owner"
ON public.paper_authors
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = paper_id
      AND p.submitted_by = auth.uid()
  )
);


CREATE POLICY "paper_authors_delete_paper_owner"
ON public.paper_authors
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = paper_id
      AND p.submitted_by = auth.uid()
  )
);


-- ============================================================
-- 17. REVIEW POLICIES
-- ============================================================

CREATE POLICY "reviews_select_reviewer_or_author_or_organizer"
ON public.reviews
FOR SELECT
TO authenticated
USING (
  reviewer_id = auth.uid()
  OR public.can_read_paper(paper_id)
);


CREATE POLICY "reviews_insert_organizer"
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_conference_organizer(
    (
      SELECT p.conference_id
      FROM public.papers p
      WHERE p.id = paper_id
    )
  )
);


CREATE POLICY "reviews_update_reviewer_or_organizer"
ON public.reviews
FOR UPDATE
TO authenticated
USING (
  reviewer_id = auth.uid()
  OR public.is_conference_organizer(
    (SELECT conference_id FROM public.papers WHERE id = reviews.paper_id)
  )
)
WITH CHECK (
  reviewer_id = auth.uid()
  OR public.is_conference_organizer(
    (SELECT conference_id FROM public.papers WHERE id = paper_id)
  )
);


CREATE POLICY "reviews_delete_organizer"
ON public.reviews
FOR DELETE
TO authenticated
USING (
  public.is_conference_organizer(
    (
      SELECT p.conference_id
      FROM public.papers p
      WHERE p.id = reviews.paper_id
    )
  )
);


-- ============================================================
-- 18. SESSION POLICIES
-- ============================================================

CREATE POLICY "sessions_select_public"
ON public.sessions
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conference_id
      AND c.status <> 'draft'
      AND c.is_schedule_public
  )
);


CREATE POLICY "sessions_select_organizer"
ON public.sessions
FOR SELECT
TO authenticated
USING (public.is_conference_organizer(conference_id));


CREATE POLICY "sessions_insert_organizer"
ON public.sessions
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_conference_organizer(conference_id)
);


CREATE POLICY "sessions_update_organizer"
ON public.sessions
FOR UPDATE
TO authenticated
USING (
  public.is_conference_organizer(conference_id)
)
WITH CHECK (
  public.is_conference_organizer(conference_id)
);


CREATE POLICY "sessions_delete_organizer"
ON public.sessions
FOR DELETE
TO authenticated
USING (
  public.is_conference_organizer(conference_id)
);


-- ============================================================
-- 19. CERTIFICATE POLICIES
-- ============================================================

CREATE POLICY "certificates_select_own_or_organizer"
ON public.certificates
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


CREATE POLICY "certificates_insert_organizer"
ON public.certificates
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_conference_organizer(conference_id)
);


CREATE POLICY "certificates_delete_organizer"
ON public.certificates
FOR DELETE
TO authenticated
USING (
  public.is_conference_organizer(conference_id)
);


-- ============================================================
-- 20. ADDITIONAL FEATURE POLICIES
-- ============================================================

CREATE POLICY "conference_staff_select_related"
ON public.conference_staff
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_conference_organizer(conference_id)
);


CREATE POLICY "conference_staff_manage_owner"
ON public.conference_staff
FOR ALL
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conference_id
      AND c.organizer_id = auth.uid()
  )
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.conferences c
    WHERE c.id = conference_id
      AND c.organizer_id = auth.uid()
  )
);


CREATE POLICY "paper_versions_select_related"
ON public.paper_versions
FOR SELECT
TO authenticated
USING (
  public.can_read_paper(paper_id)
);


CREATE POLICY "paper_versions_insert_owner"
ON public.paper_versions
FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.papers p
    JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = paper_id
      AND (
        public.is_conference_organizer(p.conference_id)
        OR (
          p.submitted_by = auth.uid()
          AND (
            (
              p.status IN ('accepted', 'revision_required')
              AND (
                c.camera_ready_deadline IS NULL
                OR now() <= c.camera_ready_deadline
              )
            )
            OR (
              p.status NOT IN ('accepted', 'revision_required')
              AND (
                c.submission_deadline IS NULL
                OR now() <= c.submission_deadline
              )
            )
          )
        )
      )
  )
);


CREATE POLICY "reviewer_conflicts_select_related"
ON public.reviewer_conflicts
FOR SELECT
TO authenticated
USING (
  reviewer_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = paper_id
      AND public.is_conference_organizer(p.conference_id)
  )
);


CREATE POLICY "reviewer_conflicts_manage_self"
ON public.reviewer_conflicts
FOR ALL
TO authenticated
USING (
  reviewer_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = paper_id
      AND public.is_conference_organizer(p.conference_id)
  )
)
WITH CHECK (
  reviewer_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.papers p
    WHERE p.id = paper_id
      AND public.is_conference_organizer(p.conference_id)
  )
);


CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());


CREATE POLICY "notifications_update_own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());


CREATE POLICY "audit_logs_select_admin"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());


CREATE POLICY "conference_speakers_select_public"
ON public.conference_speakers
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conferences c
    WHERE c.id = conference_id
      AND (c.status <> 'draft' OR public.is_conference_organizer(c.id))
  )
);


CREATE POLICY "conference_speakers_manage_organizer"
ON public.conference_speakers
FOR ALL
TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id));


CREATE POLICY "conference_announcements_select_public"
ON public.conference_announcements
FOR SELECT
TO anon, authenticated
USING (
  (is_public AND EXISTS (
    SELECT 1 FROM public.conferences c
    WHERE c.id = conference_id AND c.status <> 'draft'
  ))
  OR public.is_conference_organizer(conference_id)
);


CREATE POLICY "conference_announcements_manage_organizer"
ON public.conference_announcements
FOR ALL
TO authenticated
USING (public.is_conference_organizer(conference_id))
WITH CHECK (public.is_conference_organizer(conference_id));


-- ============================================================
-- 21. PUBLIC CERTIFICATE VERIFICATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_certificate(lookup_number text)
RETURNS TABLE (
  certificate_number text,
  certificate_type text,
  issued_at timestamptz,
  recipient_name text,
  recipient_organization text,
  conference_title text,
  conference_start_date date,
  conference_end_date date
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    c.certificate_number,
    c.certificate_type,
    c.issued_at,
    p.full_name,
    p.organization,
    conf.title,
    conf.start_date,
    conf.end_date
  FROM public.certificates c
  JOIN public.profiles p ON p.id = c.user_id
  JOIN public.conferences conf ON conf.id = c.conference_id
  WHERE c.certificate_number = lookup_number
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;


-- ============================================================
-- 22. STORAGE FOR PAPER FILES
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('paper-files', 'paper-files', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = false
WHERE id = 'paper-files';

DROP POLICY IF EXISTS "paper_files_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "paper_files_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "paper_files_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "paper_files_delete_owner" ON storage.objects;

CREATE POLICY "paper_files_select_authenticated"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'paper-files'
  AND (
    owner = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.papers p
      WHERE p.file_url = name
        AND public.can_read_paper(p.id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.paper_versions pv
      JOIN public.papers p ON p.id = pv.paper_id
      WHERE pv.file_url = name
        AND public.can_read_paper(p.id)
    )
  )
);

CREATE POLICY "paper_files_insert_authenticated"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'paper-files' AND owner = auth.uid());

CREATE POLICY "paper_files_update_owner"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'paper-files' AND owner = auth.uid())
WITH CHECK (bucket_id = 'paper-files' AND owner = auth.uid());

CREATE POLICY "paper_files_delete_owner"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'paper-files' AND owner = auth.uid());


-- ============================================================
-- 23. GRANTS
-- ============================================================
-- Supabase normally grants table access to authenticated users,
-- while RLS controls which rows they can access.
-- These grants make the intended API access explicit.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT
ON public.conferences
TO anon;

GRANT SELECT
ON public.sessions
TO anon;

GRANT SELECT
ON public.conference_speakers
TO anon;

GRANT SELECT
ON public.conference_announcements
TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.profiles
TO authenticated;

REVOKE ALL ON public.profile_directory FROM PUBLIC;
GRANT SELECT ON public.profile_directory TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.conferences
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.participants
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.papers
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.paper_authors
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.reviews
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.sessions
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.conference_speakers
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.conference_announcements
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.certificates
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.conference_staff
TO authenticated;

GRANT SELECT, INSERT
ON public.paper_versions
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.reviewer_conflicts
TO authenticated;

GRANT SELECT, UPDATE
ON public.notifications
TO authenticated;

GRANT SELECT
ON public.audit_logs
TO authenticated;


-- ============================================================
-- 21. DEMO ACCOUNTS
-- ============================================================
-- Demo password for all seeded accounts: Demo@123456
-- Remove or change these accounts before using the project in production.
--
-- Login examples:
--   admin@confmanager.com
--   organizer@confmanager.com
--   author@confmanager.com
--   reviewer@confmanager.com (account assigned to demo reviews)
--   participant@confmanager.com

DO $$
DECLARE
  demo_password text := 'Demo@123456';
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000001',
      'authenticated',
      'authenticated',
      'admin@confmanager.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Nguyễn Minh Quân","role":"admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000002',
      'authenticated',
      'authenticated',
      'organizer@confmanager.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Trần Thu Hà","role":"organizer"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000003',
      'authenticated',
      'authenticated',
      'author@confmanager.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Lê Hoàng Nam","role":"author"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000004',
      'authenticated',
      'authenticated',
      'reviewer@confmanager.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Phạm Ngọc Lan","role":"author"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    ),
    (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000005',
      'authenticated',
      'authenticated',
      'participant@confmanager.com',
      crypt(demo_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Võ Gia Hân","role":"participant"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now();

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'admin@confmanager.com',
      '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@confmanager.com","email_verified":true}'::jsonb,
      'email',
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      'organizer@confmanager.com',
      '{"sub":"00000000-0000-0000-0000-000000000002","email":"organizer@confmanager.com","email_verified":true}'::jsonb,
      'email',
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000003',
      'author@confmanager.com',
      '{"sub":"00000000-0000-0000-0000-000000000003","email":"author@confmanager.com","email_verified":true}'::jsonb,
      'email',
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000004',
      'reviewer@confmanager.com',
      '{"sub":"00000000-0000-0000-0000-000000000004","email":"reviewer@confmanager.com","email_verified":true}'::jsonb,
      'email',
      now(),
      now(),
      now()
    ),
    (
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000005',
      'participant@confmanager.com',
      '{"sub":"00000000-0000-0000-0000-000000000005","email":"participant@confmanager.com","email_verified":true}'::jsonb,
      'email',
      now(),
      now(),
      now()
    )
  ON CONFLICT (provider, provider_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    identity_data = EXCLUDED.identity_data,
    updated_at = now();

  INSERT INTO public.profiles (
    id,
    full_name,
    role,
    phone,
    organization,
    bio
  )
  VALUES
    (
      '00000000-0000-0000-0000-000000000001',
      'Nguyễn Minh Quân',
      'admin',
      '0900000001',
      'ConfManager',
      'Tài khoản quản trị dùng để demo toàn bộ hệ thống.'
    ),
    (
      '00000000-0000-0000-0000-000000000002',
      'Trần Thu Hà',
      'organizer',
      '0900000002',
      'Khoa Công nghệ thông tin',
      'Tài khoản ban tổ chức dùng để tạo hội thảo và lịch trình.'
    ),
    (
      '00000000-0000-0000-0000-000000000003',
      'Lê Hoàng Nam',
      'author',
      '0900000003',
      'Trường Đại học Demo',
      'Tài khoản tác giả dùng để nộp bài báo khoa học.'
    ),
    (
      '00000000-0000-0000-0000-000000000004',
      'Phạm Ngọc Lan',
      'author',
      '0900000004',
      'Hội đồng phản biện',
      'Tài khoản demo được phân công phản biện bài báo.'
    ),
    (
      '00000000-0000-0000-0000-000000000005',
      'Võ Gia Hân',
      'participant',
      '0900000005',
      'Khách tham dự',
      'Tài khoản người tham dự dùng để đăng ký hội thảo.'
    )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    phone = EXCLUDED.phone,
    organization = EXCLUDED.organization,
    bio = EXCLUDED.bio,
    updated_at = now();
END $$;


-- ============================================================
-- 22. DEMO CONFERENCES AND REAL PAPER SAMPLES
-- ============================================================
-- The following demo papers use real, public research metadata from arXiv.
-- They are inserted as sample submissions so the app has realistic data.

INSERT INTO public.conferences (
  id,
  title,
  description,
  start_date,
  end_date,
  location,
  status,
  organizer_id,
  cover_image_url,
  max_participants,
  submission_deadline,
  review_deadline,
  registration_deadline,
  camera_ready_deadline,
  blind_review
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'Hội thảo Trí tuệ nhân tạo và Khoa học dữ liệu 2026',
    'Hội thảo demo dùng để quản lý bài báo, phản biện, lịch trình và chứng nhận trong hệ thống ConfManager.',
    '2026-10-20',
    '2026-10-22',
    'TP. Hồ Chí Minh',
    'open',
    '00000000-0000-0000-0000-000000000002',
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80',
    200,
    '2026-09-25 23:59:00+07',
    '2026-10-05 23:59:00+07',
    '2026-10-15 23:59:00+07',
    '2026-10-12 23:59:00+07',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Hội nghị Công nghệ phần mềm và Hệ thống thông minh 2026',
    'Hội nghị demo cho các chủ đề học máy, tối ưu hóa và hệ thống thông minh.',
    '2026-11-12',
    '2026-11-14',
    'Hà Nội',
    'ongoing',
    '00000000-0000-0000-0000-000000000002',
    'https://images.unsplash.com/photo-1515169067865-5387ec356754?auto=format&fit=crop&w=1200&q=80',
    150,
    '2026-10-01 23:59:00+07',
    '2026-10-18 23:59:00+07',
    '2026-11-01 23:59:00+07',
    '2026-10-25 23:59:00+07',
    false
  )
ON CONFLICT (id) DO UPDATE
SET
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
  updated_at = now();


UPDATE public.conferences
SET
  topics = CASE id
    WHEN '10000000-0000-0000-0000-000000000001'::uuid
      THEN ARRAY['AI', 'Data Science', 'Machine Learning']
    ELSE ARRAY['Software Engineering', 'Intelligent Systems']
  END,
  event_format = CASE id
    WHEN '10000000-0000-0000-0000-000000000001'::uuid THEN 'hybrid'
    ELSE 'offline'
  END,
  is_featured = true,
  is_schedule_public = true,
  contact_name = 'Ban tổ chức',
  contact_email = 'organizer@confmanager.com',
  contact_phone = '0900000002'
WHERE id IN (
  '10000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000002'::uuid
);


INSERT INTO public.conference_speakers (
  conference_id,
  full_name,
  title,
  organization,
  bio,
  is_keynote,
  display_order
)
SELECT
  '10000000-0000-0000-0000-000000000001'::uuid,
  'TS. Nguyễn Minh An',
  'Keynote: AI có trách nhiệm',
  'Trường Đại học Demo',
  'Nghiên cứu viên về trí tuệ nhân tạo và khoa học dữ liệu.',
  true,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public.conference_speakers
  WHERE conference_id = '10000000-0000-0000-0000-000000000001'::uuid
    AND full_name = 'TS. Nguyễn Minh An'
);


INSERT INTO public.conference_speakers (
  conference_id,
  full_name,
  title,
  organization,
  bio,
  is_keynote,
  display_order
)
SELECT
  '10000000-0000-0000-0000-000000000002'::uuid,
  'PGS. Trần Hải Nam',
  'Keynote: Hệ thống thông minh tin cậy',
  'Viện Công nghệ Phần mềm',
  'Chuyên gia về kỹ thuật phần mềm và hệ thống thông minh.',
  true,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM public.conference_speakers
  WHERE conference_id = '10000000-0000-0000-0000-000000000002'::uuid
    AND full_name = 'PGS. Trần Hải Nam'
);


INSERT INTO public.conference_announcements (
  conference_id,
  title,
  message,
  is_public
)
SELECT
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Mở đăng ký tham dự',
  'Hội thảo đã mở đăng ký và nhận bài báo theo deadline được công bố.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.conference_announcements
  WHERE conference_id = '10000000-0000-0000-0000-000000000001'::uuid
    AND title = 'Mở đăng ký tham dự'
);


INSERT INTO public.conference_announcements (
  conference_id,
  title,
  message,
  is_public
)
SELECT
  '10000000-0000-0000-0000-000000000002'::uuid,
  'Cập nhật lịch trình',
  'Lịch trình các phiên báo cáo sẽ được công bố và cập nhật tại trang hội thảo.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.conference_announcements
  WHERE conference_id = '10000000-0000-0000-0000-000000000002'::uuid
    AND title = 'Cập nhật lịch trình'
);


INSERT INTO public.papers (
  id,
  conference_id,
  title,
  abstract,
  keywords,
  file_url,
  status,
  submitted_by,
  current_version
)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Attention Is All You Need',
    'Bài báo giới thiệu kiến trúc Transformer cho mô hình chuỗi, thay thế cơ chế hồi tiếp bằng self-attention và trở thành nền tảng quan trọng của NLP hiện đại.',
    'Transformer, attention, neural machine translation, deep learning',
    'https://arxiv.org/pdf/1706.03762',
    'accepted',
    '00000000-0000-0000-0000-000000000003',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    'Bài báo trình bày BERT, mô hình biểu diễn ngôn ngữ hai chiều dựa trên Transformer và được fine-tune cho nhiều tác vụ NLP.',
    'BERT, language model, natural language processing, Transformer',
    'https://arxiv.org/pdf/1810.04805',
    'under_review',
    '00000000-0000-0000-0000-000000000003',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'Deep Residual Learning for Image Recognition',
    'Bài báo giới thiệu mạng ResNet với residual learning, giúp huấn luyện các mạng nơ-ron rất sâu hiệu quả hơn cho nhận dạng ảnh.',
    'ResNet, computer vision, image recognition, deep learning',
    'https://arxiv.org/pdf/1512.03385',
    'revision_required',
    '00000000-0000-0000-0000-000000000003',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    'Adam: A Method for Stochastic Optimization',
    'Bài báo đề xuất Adam, thuật toán tối ưu hóa gradient thích nghi sử dụng ước lượng moment bậc một và bậc hai.',
    'Adam, optimization, stochastic gradient, machine learning',
    'https://arxiv.org/pdf/1412.6980',
    'submitted',
    '00000000-0000-0000-0000-000000000003',
    1
  )
ON CONFLICT (id) DO UPDATE
SET
  conference_id = EXCLUDED.conference_id,
  title = EXCLUDED.title,
  abstract = EXCLUDED.abstract,
  keywords = EXCLUDED.keywords,
  file_url = EXCLUDED.file_url,
  status = EXCLUDED.status,
  submitted_by = EXCLUDED.submitted_by,
  current_version = EXCLUDED.current_version,
  updated_at = now();


INSERT INTO public.paper_versions (
  paper_id,
  version_number,
  file_url,
  notes,
  uploaded_by
)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    1,
    'https://arxiv.org/pdf/1706.03762',
    'Bản PDF công khai từ arXiv, dùng làm dữ liệu demo.',
    '00000000-0000-0000-0000-000000000003'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    1,
    'https://arxiv.org/pdf/1810.04805',
    'Bản PDF công khai từ arXiv, dùng làm dữ liệu demo.',
    '00000000-0000-0000-0000-000000000003'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    1,
    'https://arxiv.org/pdf/1512.03385',
    'Bản PDF công khai từ arXiv, dùng làm dữ liệu demo.',
    '00000000-0000-0000-0000-000000000003'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    1,
    'https://arxiv.org/pdf/1412.6980',
    'Bản PDF công khai từ arXiv, dùng làm dữ liệu demo.',
    '00000000-0000-0000-0000-000000000003'
  )
ON CONFLICT (paper_id, version_number) DO UPDATE
SET
  file_url = EXCLUDED.file_url,
  notes = EXCLUDED.notes,
  uploaded_by = EXCLUDED.uploaded_by;


INSERT INTO public.reviews (
  id,
  paper_id,
  reviewer_id,
  status,
  score,
  originality_score,
  relevance_score,
  methodology_score,
  presentation_score,
  comments,
  recommendation,
  completed_at
)
VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'completed',
    10,
    10,
    10,
    9,
    9,
    'Bài báo có đóng góp nền tảng, trình bày rõ và tác động rất lớn.',
    'accept',
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'assigned',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '',
    NULL,
    NULL
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    'completed',
    9,
    9,
    9,
    9,
    8,
    'Kết quả mạnh, nhưng phần trình bày thực nghiệm có thể bổ sung thêm so sánh.',
    'revise',
    now()
  )
ON CONFLICT (id) DO UPDATE
SET
  status = EXCLUDED.status,
  score = EXCLUDED.score,
  originality_score = EXCLUDED.originality_score,
  relevance_score = EXCLUDED.relevance_score,
  methodology_score = EXCLUDED.methodology_score,
  presentation_score = EXCLUDED.presentation_score,
  comments = EXCLUDED.comments,
  recommendation = EXCLUDED.recommendation,
  completed_at = EXCLUDED.completed_at;


-- ============================================================
-- 24. INTERNAL MESSAGING
-- ============================================================
-- Conversations are used for support requests and administrator broadcasts.
-- A normal user can only view conversations they belong to. Administrators
-- can view and reply to every conversation.

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  conversation_type text NOT NULL DEFAULT 'support'
    CHECK (conversation_type IN ('support', 'broadcast')),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);


CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);


ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversation_members_user
  ON public.conversation_members(user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at);


CREATE OR REPLACE FUNCTION public.can_access_conversation(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id = target_conversation_id
        AND cm.user_id = auth.uid()
    );
$$;


CREATE OR REPLACE FUNCTION public.can_send_conversation_message(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR (
      public.can_access_conversation(target_conversation_id)
      AND EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = target_conversation_id
          AND c.conversation_type = 'support'
      )
    );
$$;


CREATE OR REPLACE FUNCTION public.start_support_conversation(
  conversation_subject text,
  initial_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_conversation_id uuid;
  admin_profile record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF char_length(trim(conversation_subject)) = 0
    OR char_length(trim(initial_message)) = 0 THEN
    RAISE EXCEPTION 'Subject and message are required';
  END IF;

  INSERT INTO public.conversations (subject, conversation_type, created_by)
  VALUES (trim(conversation_subject), 'support', auth.uid())
  RETURNING id INTO new_conversation_id;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (new_conversation_id, auth.uid());

  FOR admin_profile IN
    SELECT id FROM public.profiles WHERE role = 'admin'
  LOOP
    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES (new_conversation_id, admin_profile.id)
    ON CONFLICT DO NOTHING;

  END LOOP;

  INSERT INTO public.messages (conversation_id, sender_id, body)
  VALUES (new_conversation_id, auth.uid(), trim(initial_message));

  PERFORM public.write_audit_log(
    'message.support_created',
    'conversation',
    new_conversation_id,
    jsonb_build_object('subject', trim(conversation_subject))
  );

  RETURN new_conversation_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.send_admin_broadcast(
  conversation_subject text,
  message_body text,
  target_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_conversation_id uuid;
  recipient record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send broadcasts';
  END IF;

  IF char_length(trim(conversation_subject)) = 0
    OR char_length(trim(message_body)) = 0 THEN
    RAISE EXCEPTION 'Subject and message are required';
  END IF;

  IF target_role IS NOT NULL
    AND target_role NOT IN ('admin', 'organizer', 'author', 'participant') THEN
    RAISE EXCEPTION 'Invalid recipient role';
  END IF;

  INSERT INTO public.conversations (subject, conversation_type, created_by)
  VALUES (trim(conversation_subject), 'broadcast', auth.uid())
  RETURNING id INTO new_conversation_id;

  FOR recipient IN
    SELECT id FROM public.profiles
    WHERE target_role IS NULL OR role = target_role
  LOOP
    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES (new_conversation_id, recipient.id)
    ON CONFLICT DO NOTHING;

  END LOOP;

  INSERT INTO public.messages (conversation_id, sender_id, body)
  VALUES (new_conversation_id, auth.uid(), trim(message_body));

  PERFORM public.write_audit_log(
    'message.broadcast_sent',
    'conversation',
    new_conversation_id,
    jsonb_build_object('subject', trim(conversation_subject), 'target_role', target_role)
  );

  RETURN new_conversation_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.notify_conversation_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conversation_subject text;
  recipient record;
BEGIN
  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;

  SELECT subject INTO conversation_subject
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  FOR recipient IN
    SELECT user_id
    FROM public.conversation_members
    WHERE conversation_id = NEW.conversation_id
      AND user_id <> NEW.sender_id
  LOOP
    PERFORM public.create_notification(
      recipient.user_id,
      COALESCE(conversation_subject, 'Tin nhắn mới'),
      'Bạn có một tin nhắn mới trong hộp thư.',
      'info',
      'messages'
    );
  END LOOP;

  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS notify_conversation_message_trigger ON public.messages;

CREATE TRIGGER notify_conversation_message_trigger
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_conversation_message();


DROP POLICY IF EXISTS "conversations_select_member_or_admin" ON public.conversations;
DROP POLICY IF EXISTS "conversation_members_select_member_or_admin" ON public.conversation_members;
DROP POLICY IF EXISTS "messages_select_member_or_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_member_or_admin" ON public.messages;
DROP POLICY IF EXISTS "conversation_members_update_own" ON public.conversation_members;

CREATE POLICY "conversations_select_member_or_admin"
ON public.conversations
FOR SELECT TO authenticated
USING (public.can_access_conversation(id));

CREATE POLICY "conversation_members_select_member_or_admin"
ON public.conversation_members
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "conversation_members_update_own"
ON public.conversation_members
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "messages_select_member_or_admin"
ON public.messages
FOR SELECT TO authenticated
USING (public.can_access_conversation(conversation_id));

CREATE POLICY "messages_insert_member_or_admin"
ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.can_send_conversation_message(conversation_id)
);

GRANT SELECT, UPDATE ON public.conversation_members TO authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_support_conversation(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_admin_broadcast(text, text, text) TO authenticated;


-- ============================================================
-- 25. STORAGE FOR PROFILE AVATARS
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-avatars', 'profile-avatars', true)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = true
WHERE id = 'profile-avatars';

DROP POLICY IF EXISTS "profile_avatars_select_public" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_delete_own" ON storage.objects;

CREATE POLICY "profile_avatars_select_public"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'profile-avatars');

CREATE POLICY "profile_avatars_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND owner = auth.uid()
);

CREATE POLICY "profile_avatars_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND owner = auth.uid()
)
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND owner = auth.uid()
);

CREATE POLICY "profile_avatars_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND owner = auth.uid()
);


-- ============================================================
-- END
-- ============================================================


-- Organizer role request workflow
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


-- Add shared reading without expanding can_read_paper, which also protects
-- reviews, author identities and previous manuscript versions.
DROP POLICY IF EXISTS papers_select_accepted ON public.papers;
CREATE POLICY papers_select_accepted ON public.papers
FOR SELECT TO authenticated USING (status = 'accepted');

-- Only the file currently attached to an accepted paper is shared.
-- The bucket stays private; existing owner/reviewer/organizer access is unchanged.
DROP POLICY IF EXISTS paper_files_select_accepted ON storage.objects;
CREATE POLICY paper_files_select_accepted ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'paper-files'
  AND EXISTS (
    SELECT 1 FROM public.papers p
    WHERE p.status = 'accepted' AND p.file_url = name
  )
);


-- Preserve existing assignments as history; only authors can be assigned or
-- submit further review updates. Existing conflict-of-interest checks remain.
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.reviewer_id AND role IN ('author', 'reviewer')) THEN
    RAISE EXCEPTION 'Chỉ tài khoản Tác giả được phân công và thực hiện phản biện';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_author_reviewer_trigger ON public.reviews;
CREATE TRIGGER require_author_reviewer_trigger
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.require_author_reviewer();

-- 2026-09-23: role permission hardening (also shipped as an incremental migration).
-- Apply after the conference management schema and 20260922 migrations.
BEGIN;

-- Defaults are not validation: an API caller can explicitly supply these fields.
DROP POLICY IF EXISTS papers_insert_own ON public.papers;
CREATE POLICY papers_insert_own ON public.papers FOR INSERT TO authenticated
WITH CHECK (
  submitted_by = auth.uid()
  AND status = 'submitted'
  AND current_version = 1
  AND public.get_current_user_role() IN ('author', 'admin')
  AND EXISTS (
    SELECT 1 FROM public.conferences c WHERE c.id = conference_id
      AND c.status = 'open'
      AND (c.submission_deadline IS NULL OR now() <= c.submission_deadline)
  )
);

DROP POLICY IF EXISTS participants_insert_own ON public.participants;
CREATE POLICY participants_insert_own ON public.participants FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid() AND attended = false
  AND public.can_register_for_conference(conference_id)
);

CREATE OR REPLACE FUNCTION public.managed_conferences()
RETURNS SETOF public.conferences
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.* FROM public.conferences c
  WHERE auth.uid() IS NOT NULL AND public.is_conference_organizer(c.id)
  ORDER BY c.title;
$$;
REVOKE ALL ON FUNCTION public.managed_conferences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.managed_conferences() TO authenticated;

-- A SECURITY DEFINER helper avoids recursive RLS when checking the paper owner.
-- Keep blind identities private for all readers other than owners/coauthors/staff.
CREATE OR REPLACE FUNCTION public.must_hide_paper_identity(target_paper_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id AND c.blind_review
      AND p.submitted_by IS DISTINCT FROM auth.uid()
      AND NOT public.is_conference_organizer(p.conference_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.paper_authors pa
        WHERE pa.paper_id = p.id AND pa.user_id = auth.uid()
      )
  );
$$;
REVOKE ALL ON FUNCTION public.must_hide_paper_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.must_hide_paper_identity(uuid) TO authenticated;

-- Never expose an unmasked table row (including through nested API joins).
DROP POLICY IF EXISTS papers_select_own_or_reviewer_or_organizer ON public.papers;
CREATE POLICY papers_select_own_or_reviewer_or_organizer ON public.papers
FOR SELECT TO authenticated USING (
  public.can_read_paper(id) AND NOT public.must_hide_paper_identity(id)
);
DROP POLICY IF EXISTS papers_select_accepted ON public.papers;
CREATE POLICY papers_select_accepted ON public.papers FOR SELECT TO authenticated
USING (status = 'accepted' AND NOT public.must_hide_paper_identity(id));

-- PL/pgSQL deliberately prevents SQL inlining. Mask before returning rows, so
-- API filters and FK embedding cannot be used to test hidden owner/file values.
CREATE OR REPLACE FUNCTION public.read_papers()
RETURNS SETOF public.papers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE paper_row public.papers;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  FOR paper_row IN
    SELECT p.* FROM public.papers p
    WHERE p.status = 'accepted' OR public.can_read_paper(p.id)
  LOOP
    IF public.must_hide_paper_identity(paper_row.id) THEN
      paper_row.submitted_by := NULL;
      -- Existing storage paths contain the uploader UUID. Use an opaque handle;
      -- the authenticated download function returns bytes, never that path.
      paper_row.file_url := CASE WHEN coalesce(paper_row.file_url, '') = ''
        THEN '' ELSE 'blind:' || paper_row.id::text END;
    END IF;
    RETURN NEXT paper_row;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.read_papers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_papers() TO authenticated;

-- Historical versions contain uploader IDs and identifying object paths.
DROP POLICY IF EXISTS paper_versions_select_related ON public.paper_versions;
CREATE POLICY paper_versions_select_related ON public.paper_versions
FOR SELECT TO authenticated USING (
  public.can_read_paper(paper_id) AND NOT public.must_hide_paper_identity(paper_id)
);

-- Direct storage access already joins the RLS-protected papers/versions tables.
-- This extra guard documents and enforces the boundary for the accepted policy.
DROP POLICY IF EXISTS paper_files_select_accepted ON storage.objects;
CREATE POLICY paper_files_select_accepted ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'paper-files' AND EXISTS (
    SELECT 1 FROM public.papers p WHERE p.status = 'accepted'
      AND p.file_url = name AND NOT public.must_hide_paper_identity(p.id)
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Admin management additions (2026-09-24).
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

-- Reporting history additions (2026-09-24).
BEGIN;
-- Reporting history is append-only from database triggers, readable by admins.
CREATE TABLE IF NOT EXISTS public.reporting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('tracking_started', 'registration_cancelled', 'camera_ready')),
  conference_id uuid REFERENCES public.conferences(id) ON DELETE CASCADE,
  paper_id uuid REFERENCES public.papers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS reporting_tracking_started ON public.reporting_events(event_type) WHERE event_type = 'tracking_started';
CREATE INDEX IF NOT EXISTS reporting_events_conference_date ON public.reporting_events(conference_id, occurred_at);
ALTER TABLE public.reporting_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reporting_events_admin ON public.reporting_events;
CREATE POLICY reporting_events_admin ON public.reporting_events FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.reporting_events FROM anon, authenticated;
GRANT SELECT ON public.reporting_events TO authenticated;
INSERT INTO public.reporting_events(event_type) VALUES ('tracking_started') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.track_registration_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A cascading deletion of a conference/account is not a cancellation.
  IF EXISTS(SELECT 1 FROM public.conferences WHERE id = OLD.conference_id)
    AND EXISTS(SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    INSERT INTO public.reporting_events(event_type, conference_id, user_id, details)
    VALUES ('registration_cancelled', OLD.conference_id, OLD.user_id,
      jsonb_build_object('registration_id', OLD.id, 'registered_at', OLD.registered_at, 'attended', OLD.attended));
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS track_registration_cancellation ON public.participants;
CREATE TRIGGER track_registration_cancellation AFTER DELETE ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.track_registration_cancellation();

CREATE OR REPLACE FUNCTION public.track_camera_ready_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paper_row public.papers;
BEGIN
  SELECT * INTO paper_row FROM public.papers WHERE id = NEW.paper_id;
  -- A new manuscript version uploaded after acceptance is the final submission.
  IF paper_row.status = 'accepted' THEN
    INSERT INTO public.reporting_events(event_type, conference_id, paper_id, user_id, details)
    VALUES ('camera_ready', paper_row.conference_id, NEW.paper_id, NEW.uploaded_by,
      jsonb_build_object('version_id', NEW.id, 'version_number', NEW.version_number));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS track_camera_ready_submission ON public.paper_versions;
CREATE TRIGGER track_camera_ready_submission AFTER INSERT ON public.paper_versions
FOR EACH ROW EXECUTE FUNCTION public.track_camera_ready_submission();
REVOKE ALL ON FUNCTION public.track_registration_cancellation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.track_camera_ready_submission() FROM PUBLIC;

-- ============================================================
-- ATTENDANCE SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_session_per_conference ON public.attendance_sessions(conference_id);
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_sessions_read ON public.attendance_sessions;
CREATE POLICY attendance_sessions_read ON public.attendance_sessions FOR SELECT TO authenticated
USING (public.is_admin() OR public.is_conference_organizer(conference_id)
  OR EXISTS (SELECT 1 FROM public.participants p WHERE p.conference_id = attendance_sessions.conference_id AND p.user_id = auth.uid()));
REVOKE ALL ON public.attendance_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attendance_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.create_attendance_session(target_conference_id uuid, session_starts_at timestamptz, session_ends_at timestamptz)
RETURNS public.attendance_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.attendance_sessions;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin() OR public.is_conference_organizer(target_conference_id)) THEN
    RAISE EXCEPTION 'Chỉ admin hoặc ban tổ chức được tạo phiên điểm danh' USING ERRCODE = '42501';
  END IF;
  IF session_ends_at <= session_starts_at THEN RAISE EXCEPTION 'Thời gian phiên không hợp lệ'; END IF;
  INSERT INTO public.attendance_sessions(conference_id, starts_at, ends_at, created_by)
  VALUES (target_conference_id, session_starts_at, session_ends_at, auth.uid())
  ON CONFLICT (conference_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
  RETURNING * INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_attendance_session(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_self(attendance_code_input text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.participants; sess public.attendance_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập để điểm danh'; END IF;
  SELECT * INTO sess FROM public.attendance_sessions WHERE code = upper(btrim(attendance_code_input)) AND now() BETWEEN starts_at AND ends_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mã điểm danh không hợp lệ hoặc phiên đã đóng'; END IF;
  SELECT * INTO target FROM public.participants WHERE conference_id = sess.conference_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Bạn chưa đăng ký hội thảo này'; END IF;
  IF target.attended THEN RETURN true; END IF;
  UPDATE public.participants SET attended = true, checked_in_at = now(), checked_in_by = auth.uid() WHERE id = target.id AND NOT attended;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.check_in_self(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_self(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- AUTHOR WORKFLOW UPDATE (20260925)
-- Apply after the existing conference schema and migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_edit_paper_submission(target_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p JOIN public.conferences c ON c.id = p.conference_id
    WHERE p.id = target_paper_id AND auth.uid() IS NOT NULL AND (
      public.is_conference_organizer(p.conference_id) OR (
        p.submitted_by = auth.uid()
        AND c.status NOT IN ('cancelled', 'completed')
        AND p.status <> 'rejected'
        AND CASE WHEN p.status IN ('accepted', 'revision_required')
          THEN c.camera_ready_deadline IS NULL OR now() <= c.camera_ready_deadline
          ELSE c.submission_deadline IS NULL OR now() <= c.submission_deadline END
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_paper_submission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_paper_submission(uuid) TO authenticated;

-- Serialize author/reviewer changes on the same parent row, including direct API writes.
CREATE OR REPLACE FUNCTION public.guard_paper_author_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_id uuid;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.paper_id ELSE NEW.paper_id END;
  PERFORM 1 FROM public.papers WHERE id = target_id FOR UPDATE;
  -- Permit cascades when the parent has already been deleted.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(target_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'UPDATE' AND NEW.paper_id <> OLD.paper_id THEN
      RAISE EXCEPTION 'Không thể chuyển đồng tác giả sang bài khác';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reviews WHERE paper_id = NEW.paper_id AND reviewer_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Người đang phản biện bài này không thể là đồng tác giả';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_author_change ON public.paper_authors;
CREATE TRIGGER guard_paper_author_change BEFORE INSERT OR UPDATE OR DELETE ON public.paper_authors
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_author_change();

CREATE OR REPLACE FUNCTION public.lock_review_paper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.papers WHERE id = NEW.paper_id FOR UPDATE;
  RETURN NEW;
END;
$$;
-- Trigger names sort alphabetically: lock before existing assignment validation.
DROP TRIGGER IF EXISTS a_lock_review_paper ON public.reviews;
CREATE TRIGGER a_lock_review_paper BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.lock_review_paper();

CREATE OR REPLACE FUNCTION public.guard_paper_submission_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(OLD.id)
    AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.abstract IS DISTINCT FROM OLD.abstract
      OR NEW.keywords IS DISTINCT FROM OLD.keywords OR NEW.file_url IS DISTINCT FROM OLD.file_url
      OR NEW.current_version IS DISTINCT FROM OLD.current_version) THEN
    RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_submission_update ON public.papers;
CREATE TRIGGER guard_paper_submission_update BEFORE UPDATE ON public.papers
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_submission_update();

CREATE OR REPLACE FUNCTION public.guard_paper_version_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.papers WHERE id = NEW.paper_id FOR UPDATE;
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_paper_submission(NEW.paper_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền nộp phiên bản hoặc đã hết hạn chỉnh sửa';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_paper_version_insert ON public.paper_versions;
CREATE TRIGGER guard_paper_version_insert BEFORE INSERT ON public.paper_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_paper_version_insert();

-- One transaction for paper metadata, authors and version history. Invoker keeps RLS active.
-- A client-generated UUID makes retrying a lost response safe for a new submission.
CREATE OR REPLACE FUNCTION public.save_paper_submission(
  target_paper_id uuid, target_conference_id uuid, paper_title text, paper_abstract text,
  paper_keywords text, paper_file text, author_ids uuid[], version_notes text,
  expected_updated_at timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE existing public.papers; next_version integer; previous_file text; conf public.conferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Bạn cần đăng nhập'; END IF;
  IF length(btrim(coalesce(paper_title, ''))) = 0 OR length(btrim(coalesce(paper_abstract, ''))) = 0
    OR length(btrim(coalesce(paper_file, ''))) = 0 THEN
    RAISE EXCEPTION 'Vui lòng nhập tiêu đề, tóm tắt và file bài báo';
  END IF;
  SELECT * INTO conf FROM public.conferences WHERE id = target_conference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hội thảo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_paper_id::text, 0));
  SELECT * INTO existing FROM public.papers WHERE id = target_paper_id FOR UPDATE;
  IF FOUND THEN
    IF NOT public.can_edit_paper_submission(target_paper_id) THEN
      RAISE EXCEPTION 'Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa';
    END IF;
    IF existing.conference_id <> target_conference_id THEN RAISE EXCEPTION 'Không thể đổi hội thảo của bài'; END IF;
    IF expected_updated_at IS NOT NULL AND existing.updated_at <> expected_updated_at THEN
      RAISE EXCEPTION 'Bài báo đã thay đổi. Hãy tải lại trang trước khi lưu';
    END IF;
    -- A retry of a create request must not overwrite another existing submission.
    IF expected_updated_at IS NULL AND (existing.submitted_by <> auth.uid()
      OR existing.title IS DISTINCT FROM btrim(paper_title)
      OR existing.abstract IS DISTINCT FROM btrim(paper_abstract)
      OR existing.file_url IS DISTINCT FROM btrim(paper_file)) THEN
      RAISE EXCEPTION 'Bài đã tồn tại. Hãy tải lại trang trước khi lưu';
    END IF;
  END IF;
  IF paper_file !~* '^https?://[^[:space:]]+$' THEN
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'paper-files'
      AND o.name = paper_file AND (o.owner = auth.uid() OR paper_file = existing.file_url)) THEN
      RAISE EXCEPTION 'File không hợp lệ hoặc bạn không có quyền sử dụng file này';
    END IF;
  ELSIF conf.blind_review THEN
    RAISE EXCEPTION 'Hội thảo phản biện ẩn danh yêu cầu tải lên file PDF';
  END IF;
  IF existing.id IS NULL THEN
    INSERT INTO public.papers (id, conference_id, title, abstract, keywords, file_url)
    VALUES (target_paper_id, target_conference_id, btrim(paper_title), btrim(paper_abstract), btrim(paper_keywords), btrim(paper_file));
  ELSE
    UPDATE public.papers SET title = btrim(paper_title), abstract = btrim(paper_abstract),
      keywords = btrim(paper_keywords), file_url = btrim(paper_file) WHERE id = target_paper_id;
  END IF;
  PERFORM public.replace_paper_authors(target_paper_id, author_ids);
  SELECT version_number, file_url INTO next_version, previous_file FROM public.paper_versions
    WHERE paper_id = target_paper_id ORDER BY version_number DESC LIMIT 1;
  IF previous_file IS DISTINCT FROM btrim(paper_file) THEN
    next_version := coalesce(next_version, 0) + 1;
    INSERT INTO public.paper_versions (paper_id, version_number, file_url, notes)
      VALUES (target_paper_id, next_version, btrim(paper_file), btrim(version_notes));
  END IF;
  UPDATE public.papers SET current_version = next_version WHERE id = target_paper_id;
  RETURN target_paper_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_paper_submission(uuid, uuid, text, text, text, text, uuid[], text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_paper_submission(uuid, uuid, text, text, text, text, uuid[], text, timestamptz) TO authenticated;

-- Published versions are immutable. Authors upload a new object for each revision.
CREATE OR REPLACE FUNCTION public.paper_file_is_referenced(object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.papers WHERE file_url = object_name
    OR file_url LIKE '%/storage/v1/object/public/paper-files/' || object_name)
  OR EXISTS (SELECT 1 FROM public.paper_versions WHERE file_url = object_name
    OR file_url LIKE '%/storage/v1/object/public/paper-files/' || object_name);
$$;
REVOKE ALL ON FUNCTION public.paper_file_is_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paper_file_is_referenced(text) TO authenticated;
DROP POLICY IF EXISTS paper_files_protect_versions_update ON storage.objects;
CREATE POLICY paper_files_protect_versions_update ON storage.objects AS RESTRICTIVE
FOR UPDATE TO authenticated USING (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name))
WITH CHECK (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name));
DROP POLICY IF EXISTS paper_files_protect_versions_delete ON storage.objects;
CREATE POLICY paper_files_protect_versions_delete ON storage.objects AS RESTRICTIVE
FOR DELETE TO authenticated USING (bucket_id <> 'paper-files' OR NOT public.paper_file_is_referenced(name));

CREATE OR REPLACE FUNCTION public.notify_paper_authors_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_id uuid; recipient uuid; heading text; body text; paper_title text;
BEGIN
  IF TG_TABLE_NAME = 'papers' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    target_id := NEW.id;
    heading := 'Cập nhật kết quả bài báo';
    body := CASE NEW.status WHEN 'accepted' THEN 'Đã chấp nhận'
      WHEN 'rejected' THEN 'Đã từ chối' WHEN 'revision_required' THEN 'Cần sửa đổi'
      WHEN 'under_review' THEN 'Đang phản biện' ELSE 'Đã nộp' END;
  ELSE
    IF NEW.status <> 'completed' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    target_id := NEW.paper_id;
    heading := 'Có kết quả phản biện mới';
    body := 'Một phản biện đã hoàn thành. Bạn có thể xem nhận xét tại trang chi tiết bài báo';
  END IF;
  SELECT title INTO paper_title FROM public.papers WHERE id = target_id;
  FOR recipient IN SELECT submitted_by FROM public.papers WHERE id = target_id
    UNION SELECT user_id FROM public.paper_authors WHERE paper_id = target_id
  LOOP
    PERFORM public.create_notification(recipient, heading, 'Bài báo "' || paper_title || '": ' || body, 'info', 'reviews');
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notify_paper_status ON public.papers;
CREATE TRIGGER notify_paper_status AFTER UPDATE OF status ON public.papers
FOR EACH ROW EXECUTE FUNCTION public.notify_paper_authors_result();
DROP TRIGGER IF EXISTS notify_paper_review_completed ON public.reviews;
CREATE TRIGGER notify_paper_review_completed AFTER UPDATE OF status ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.notify_paper_authors_result();

REVOKE ALL ON FUNCTION public.guard_paper_author_change(), public.lock_review_paper(),
  public.guard_paper_submission_update(), public.guard_paper_version_insert(), public.notify_paper_authors_result() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- REVIEWER WORKFLOW UPDATE (20260925)
-- Apply after 20260925_author_workflow.sql.
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','organizer','author','reviewer','participant'));
CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.reviewer_id AND role IN ('author','reviewer')) THEN
    RAISE EXCEPTION 'Tài khoản không đủ điều kiện phản biện';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS require_author_reviewer_trigger ON public.reviews;
CREATE TRIGGER require_author_reviewer_trigger BEFORE INSERT OR UPDATE OF reviewer_id ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.require_author_reviewer();
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('assigned','in_progress','completed','declined'));
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS response_at timestamptz;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.can_read_paper_review_results(target_paper_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.papers p WHERE p.id=target_paper_id AND (
      public.is_conference_organizer(p.conference_id) OR p.submitted_by=auth.uid()
      OR EXISTS (SELECT 1 FROM public.paper_authors pa WHERE pa.paper_id=p.id AND pa.user_id=auth.uid())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_paper_review_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_paper_review_results(uuid) TO authenticated;
DROP POLICY IF EXISTS reviews_select_reviewer_or_author_or_organizer ON public.reviews;
CREATE POLICY reviews_select_reviewer_or_author_or_organizer ON public.reviews FOR SELECT TO authenticated
USING (reviewer_id=auth.uid() OR public.can_read_paper_review_results(paper_id));

CREATE OR REPLACE FUNCTION public.guard_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công mới phải chờ xác nhận'; END IF;
    NEW.response_at := NULL; NEW.decline_reason := '';
  ELSE
    IF NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id OR NEW.paper_id IS DISTINCT FROM OLD.paper_id THEN
      RAISE EXCEPTION 'Hãy xóa phân công cũ và tạo lời mời mới để đổi người phản biện';
    END IF;
    NEW.assigned_at := OLD.assigned_at;
    NEW.completed_at := OLD.completed_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status='assigned' AND NEW.status IN ('in_progress','declined') THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được nhận hoặc từ chối'; END IF;
        NEW.response_at := now();
        IF NEW.status='declined' AND length(btrim(NEW.decline_reason))=0 THEN RAISE EXCEPTION 'Vui lòng nhập lý do từ chối'; END IF;
        IF NEW.status='in_progress' THEN NEW.decline_reason := ''; END IF;
      ELSIF OLD.status='in_progress' AND NEW.status='completed' THEN
        IF auth.uid() <> OLD.reviewer_id THEN RAISE EXCEPTION 'Chỉ người được giao mới được gửi đánh giá'; END IF;
        NEW.completed_at := now();
        NEW.response_at := OLD.response_at; NEW.decline_reason := OLD.decline_reason;
      ELSE
        RAISE EXCEPTION 'Chuyển trạng thái phản biện không hợp lệ';
      END IF;
    ELSE
      NEW.response_at := OLD.response_at;
      NEW.decline_reason := OLD.decline_reason;
    END IF;
    IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Đánh giá đã hoàn thành không thể sửa'; END IF;
  END IF;
  IF NEW.status IN ('assigned','declined') AND (NEW.score IS NOT NULL OR NEW.recommendation IS NOT NULL
    OR length(btrim(coalesce(NEW.comments,'')))>0 OR NEW.originality_score IS NOT NULL
    OR NEW.relevance_score IS NOT NULL OR NEW.methodology_score IS NOT NULL OR NEW.presentation_score IS NOT NULL
    OR NEW.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Phải nhận phân công trước khi đánh giá';
  END IF;
  IF NEW.status='completed' AND (NEW.score IS NULL OR NEW.recommendation IS NULL OR length(btrim(coalesce(NEW.comments,'')))=0) THEN
    RAISE EXCEPTION 'Vui lòng nhập điểm, khuyến nghị và nhận xét';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_review_response ON public.reviews;
CREATE TRIGGER guard_review_response BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.guard_review_response();

CREATE OR REPLACE FUNCTION public.respond_review_assignment(target_review_id uuid, accept_assignment boolean, reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE target public.reviews;
BEGIN
  IF auth.uid() IS NULL OR accept_assignment IS NULL THEN RAISE EXCEPTION 'Yêu cầu không hợp lệ'; END IF;
  SELECT * INTO target FROM public.reviews WHERE id=target_review_id FOR UPDATE;
  IF NOT FOUND OR target.reviewer_id <> auth.uid() THEN RAISE EXCEPTION 'Bạn không có quyền phản hồi phân công này'; END IF;
  IF target.status <> 'assigned' THEN RAISE EXCEPTION 'Phân công đã được phản hồi. Vui lòng tải lại'; END IF;
  UPDATE public.reviews SET status=CASE WHEN accept_assignment THEN 'in_progress' ELSE 'declined' END,
    decline_reason=CASE WHEN accept_assignment THEN '' ELSE btrim(coalesce(reason,'')) END WHERE id=target_review_id;
END; $$;
REVOKE ALL ON FUNCTION public.respond_review_assignment(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_review_assignment(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_review_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recipient uuid; conf uuid; paper_title text; reviewer_name text;
BEGIN
  IF OLD.status <> 'assigned' OR NEW.status NOT IN ('in_progress','declined') THEN RETURN NEW; END IF;
  SELECT conference_id,title INTO conf,paper_title FROM public.papers WHERE id=NEW.paper_id;
  SELECT full_name INTO reviewer_name FROM public.profiles WHERE id=NEW.reviewer_id;
  FOR recipient IN SELECT id FROM public.profiles WHERE role='admin'
    UNION SELECT organizer_id FROM public.conferences WHERE id=conf
    UNION SELECT user_id FROM public.conference_staff WHERE conference_id=conf
  LOOP
    PERFORM public.create_notification(recipient, CASE WHEN NEW.status='declined' THEN 'Phản biện từ chối phân công' ELSE 'Phản biện đã nhận phân công' END,
      coalesce(reviewer_name,'Người phản biện') || ' — ' || paper_title || CASE WHEN NEW.status='declined' THEN ': ' || NEW.decline_reason ELSE '' END,'info','reviews');
  END LOOP;
  PERFORM public.write_audit_log('review.' || NEW.status,'review',NEW.id,jsonb_build_object('paper_id',NEW.paper_id,'reason',NEW.decline_reason));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_review_response ON public.reviews;
CREATE TRIGGER notify_review_response AFTER UPDATE OF status ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_review_response();
REVOKE ALL ON FUNCTION public.guard_review_response(), public.notify_review_response() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Lĩnh vực chính; để NULL cho các hội thảo cũ chưa được phân loại.

-- BEGIN SECTION 20260927_conference_paper_catalog
-- Metadata visible to signed-in visitors of a visible conference.
-- File paths, author identities and review results retain their existing access rules.
BEGIN;
CREATE OR REPLACE FUNCTION public.conference_paper_catalog(target_conference_id uuid)
RETURNS TABLE (
  id uuid, title text, abstract text, status text,
  created_at timestamptz, can_open boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.title, p.abstract, p.status, p.created_at,
    (p.status = 'accepted' OR public.can_read_paper(p.id))
  FROM public.papers p
  JOIN public.conferences c ON c.id = p.conference_id
  WHERE auth.uid() IS NOT NULL
    AND c.id = target_conference_id
    AND (c.status <> 'draft' OR public.is_conference_organizer(c.id))
  ORDER BY p.created_at DESC, p.id;
$$;
REVOKE ALL ON FUNCTION public.conference_paper_catalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conference_paper_catalog(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- END SECTION 20260927_conference_paper_catalog

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
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Phân loại 10 hội thảo mẫu theo danh sách lĩnh vực/chủ đề của form.
-- Chạy sau các file seed. Có thể chạy lại, không thay đổi lịch hay trạng thái.
BEGIN;

ALTER TABLE public.conferences ADD COLUMN IF NOT EXISTS field text;

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
