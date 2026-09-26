BEGIN;

-- Preserve existing date-only values at local midnight while allowing precise
-- start/end times for new and edited conferences.
ALTER TABLE public.conferences
  ALTER COLUMN start_date TYPE timestamptz USING start_date::timestamptz,
  ALTER COLUMN end_date TYPE timestamptz USING (end_date::timestamptz + interval '23 hours 59 minutes 59 seconds');

ALTER TABLE public.conferences
  DROP CONSTRAINT IF EXISTS conferences_valid_date;
ALTER TABLE public.conferences
  ADD CONSTRAINT conferences_valid_date CHECK (end_date >= start_date);

NOTIFY pgrst, 'reload schema';
COMMIT;
