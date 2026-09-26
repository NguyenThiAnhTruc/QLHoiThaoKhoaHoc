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
