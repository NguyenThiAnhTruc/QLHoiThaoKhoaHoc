BEGIN;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

UPDATE public.participants
SET checked_in_at = registered_at
WHERE attended = true AND checked_in_at IS NULL;

COMMIT;