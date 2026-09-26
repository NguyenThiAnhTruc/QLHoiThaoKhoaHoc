BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('conference-images', 'conference-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "conference_images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "conference_images_delete_authenticated" ON storage.objects;

CREATE POLICY "conference_images_select_public"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'conference-images');

CREATE POLICY "conference_images_insert_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'conference-images' AND owner = auth.uid());

CREATE POLICY "conference_images_update_authenticated"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'conference-images' AND owner = auth.uid())
WITH CHECK (bucket_id = 'conference-images' AND owner = auth.uid());

CREATE POLICY "conference_images_delete_authenticated"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'conference-images' AND owner = auth.uid());

COMMIT;