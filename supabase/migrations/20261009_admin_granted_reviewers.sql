-- Public sign-up creates authors; administrators grant reviewer accounts.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'author')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'author');

CREATE OR REPLACE FUNCTION public.require_author_reviewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.reviewer_id AND role = 'reviewer'
  ) THEN
    RAISE EXCEPTION 'Chỉ tài khoản Phản biện được phân công';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS reviews_update_reviewer_or_organizer ON public.reviews;
CREATE POLICY reviews_update_reviewer_or_organizer ON public.reviews
FOR UPDATE TO authenticated
USING (
  (reviewer_id = auth.uid() AND public.get_current_user_role() = 'reviewer')
  OR public.is_conference_organizer(
    (SELECT conference_id FROM public.papers WHERE id = reviews.paper_id)
  )
)
WITH CHECK (
  (reviewer_id = auth.uid() AND public.get_current_user_role() = 'reviewer')
  OR public.is_conference_organizer(
    (SELECT conference_id FROM public.papers WHERE id = paper_id)
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
