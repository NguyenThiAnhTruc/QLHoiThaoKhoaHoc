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
