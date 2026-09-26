-- Organizers need a contact address when managing registrations. Expose the
-- profile contact email through the safe directory view; auth emails remain
-- outside the public profiles schema.
BEGIN;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';

-- Backfill existing profiles from Supabase Auth where possible. Future profile
-- edits can keep this contact value up to date without exposing auth.users.
UPDATE public.profiles p
SET contact_email = COALESCE(NULLIF(p.contact_email, ''), u.email, '')
FROM auth.users u
WHERE u.id = p.id AND COALESCE(p.contact_email, '') = '';

DROP VIEW IF EXISTS public.profile_directory;
CREATE VIEW public.profile_directory AS
SELECT id, full_name, role, organization, avatar_url, contact_email AS email,
       created_at, updated_at
FROM public.profiles;
REVOKE ALL ON public.profile_directory FROM PUBLIC;
GRANT SELECT ON public.profile_directory TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
