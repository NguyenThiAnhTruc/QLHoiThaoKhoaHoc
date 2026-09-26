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
