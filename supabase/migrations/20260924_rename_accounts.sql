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
