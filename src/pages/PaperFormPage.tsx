import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { withRequestTimeout } from "@/lib/requestTimeout";
import { useRouter } from "@/context/useRouter";
import { useAuth } from "@/context/useAuth";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, Profile } from "@/types";

interface PaperFormPageProps {
  embedded?: boolean;
  editId?: string;
  initialConferenceId?: string;
  onCancel?: () => void;
  onSaved?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
}

export function PaperFormPage({
  embedded = false,
  editId: providedEditId,
  initialConferenceId,
  onCancel,
  onSaved,
  onSubmittingChange,
}: PaperFormPageProps = {}) {
  const { route, navigate } = useRouter();
  const { profile } = useAuth();
  const editId = providedEditId ?? (!embedded ? route.params.id : undefined);
  const isEdit = !!editId;
  const requestedConferenceId = initialConferenceId ?? (embedded
    ? undefined
    : route.params.conferenceId);

  const [conferences, setConferences] = useState<Conference[]>([]);
  const [conferenceId, setConferenceId] = useState(requestedConferenceId ?? "");
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [keywords, setKeywords] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedAuthorIds, setSelectedAuthorIds] = useState<string[]>([]);
  const [authorSearch, setAuthorSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveStage, setSaveStage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [fetching, setFetching] = useState(true);
  const submissionId = useRef(crypto.randomUUID());
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const submitting = useRef(false);
  const uploadedFile = useRef<{ file: File; path: string } | null>(null);

  useEffect(() => {
    onSubmittingChange?.(loading);
  }, [loading, onSubmittingChange]);

  useEffect(() => {
    (async () => {
      setFetching(true);
      setCanSave(false);
      setLoadError("");
      try {
      const { data: confs, error: confError } = await supabase
        .from("conferences")
        .select("*")
        .eq("status", "open")
        .order("title");
      if (confError) throw confError;
      if (confs) {
        setConferences(
          (confs as unknown as Conference[]).filter(
            (conference) =>
              !conference.submission_deadline ||
              new Date(conference.submission_deadline) >= new Date(),
          ),
        );
      }

      const { data: users, error: usersError } = await supabase
        .from("profile_directory")
        .select("*")
        .order("full_name");
      if (usersError) throw usersError;
      if (users) setProfiles(users as unknown as Profile[]);

      if (isEdit) {
        const { data, error } = await supabase
          .rpc("read_papers")
          .eq("id", editId)
          .select("*")
          .maybeSingle();
        if (error || !data) {
          showToast("error", "Không thể tải bài báo");
          navigate("papers");
          return;
        }
        setExpectedUpdatedAt(data.updated_at);
        setOwnerId(data.submitted_by);
        const { data: allowed, error: accessError } = await supabase.rpc("can_edit_paper_submission", { target_paper_id: editId });
        if (accessError) throw accessError;
        if (!allowed) throw new Error("Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa.");
        const { data: assigned, error: reviewError } = await supabase.from("reviews").select("reviewer_id").eq("paper_id", editId);
        if (reviewError) throw reviewError;
        setReviewerIds((assigned ?? []).map((review) => review.reviewer_id));
        setConferenceId(data.conference_id);
        const { data: currentConference, error: currentConfError } = await supabase
          .from("conferences")
          .select("*")
          .eq("id", data.conference_id)
          .maybeSingle();
        if (currentConfError) throw currentConfError;
        if (currentConference)
          setConferences((current) =>
            current.some((item) => item.id === currentConference.id)
              ? current
              : [...current, currentConference as Conference],
          );
        setTitle(data.title);
        setAbstract(data.abstract ?? "");
        setKeywords(data.keywords ?? "");
        setFileUrl(data.file_url ?? "");

        const { data: authors, error: authorsError } = await supabase
          .from("paper_authors")
          .select("user_id")
          .eq("paper_id", editId);
        if (authorsError) throw authorsError;
        if (authors) {
          setSelectedAuthorIds(authors.map((author) => author.user_id));
        }
        setCanSave(true);
      } else {
        if (requestedConferenceId) setConferenceId(requestedConferenceId);
        setOwnerId(profile?.id ?? null);
        setCanSave(profile?.role === "author" || profile?.role === "admin");
      }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu bài báo. Vui lòng tải lại trang.");
      } finally { setFetching(false); }
    })();
  }, [editId, isEdit, navigate, requestedConferenceId, profile?.id, profile?.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || !canSave) return;
    if (!conferenceId || !title.trim() || !abstract.trim() || (!paperFile && !fileUrl.trim())) {
      showToast("error", "Vui lòng chọn hội thảo, nhập tiêu đề, tóm tắt và file bài báo");
      return;
    }
    submitting.current = true;
    setLoading(true);
    setSaveError("");
    try {
      setSaveStage(paperFile ? "Đang tải PDF..." : "Đang lưu...");
      const uploadedUrl = await uploadPaperFile();
      if (paperFile && !uploadedUrl) return;
      setSaveStage("Đang lưu bài báo...");
      const { data, error } = await withRequestTimeout((signal) => supabase.rpc("save_paper_submission", {
        target_paper_id: editId ?? submissionId.current,
        target_conference_id: conferenceId,
        paper_title: title.trim(), paper_abstract: abstract.trim(),
        paper_keywords: keywords.trim(), paper_file: uploadedUrl ?? fileUrl.trim(),
        author_ids: selectedAuthorIds, version_notes: versionNotes.trim(),
        expected_updated_at: expectedUpdatedAt,
      }).abortSignal(signal), 60_000,
        "Chưa nhận được kết quả lưu bài sau 60 giây. Hãy kiểm tra kết nối và tải lại bài để xác nhận dữ liệu trước khi lưu lại.");
      if (error) {
        setSaveError("Không thể lưu bài: " + error.message);
        showToast("error", "Không thể lưu bài: " + error.message);
        return;
      }
      showToast("success", isEdit ? "Đã cập nhật bài báo và phiên bản" : "Nộp bài báo thành công");
      if (onSaved) onSaved();
      else navigate("paper-detail", { id: data as string });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể hoàn tất lưu bài. Vui lòng thử lại.";
      setSaveError(message);
      showToast("error", message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  async function uploadPaperFile() {
    if (!paperFile) return null;
    if (uploadedFile.current?.file === paperFile)
      return uploadedFile.current.path;
    if (!profile) {
      showToast("error", "Bạn cần đăng nhập để upload file");
      return null;
    }
    if (
      paperFile.type !== "application/pdf" &&
      !paperFile.name.toLowerCase().endsWith(".pdf")
    ) {
      showToast("error", "Chỉ hỗ trợ tải lên file PDF");
      return null;
    }
    if (paperFile.size > 15 * 1024 * 1024) {
      showToast("error", "File bài báo không được vượt quá 15 MB");
      return null;
    }

    const header = await paperFile.slice(0, 5).text();
    if (header !== "%PDF-") {
      showToast("error", "Nội dung file không phải PDF hợp lệ");
      return null;
    }
    const storagePath = `${profile.id}/${crypto.randomUUID()}-${slugify(paperFile.name)}.pdf`;
    // This Storage SDK cannot abort uploads; a late upload must not continue to save the paper.
    const { error } = await withRequestTimeout(() => supabase.storage
      .from("paper-files")
      .upload(storagePath, paperFile, { upsert: false }), 120_000,
        "Tải PDF quá thời gian chờ 2 phút. Hãy kiểm tra kết nối rồi thử lưu lại.");

    if (error) {
      setSaveError("Upload file thất bại: " + error.message);
      showToast("error", "Upload file thất bại: " + error.message);
      return null;
    }

    uploadedFile.current = { file: paperFile, path: storagePath };
    return storagePath;
  }

  function toggleAuthor(userId: string) {
    setSelectedAuthorIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  const authorOptions = profiles.filter((item) => {
    const query = authorSearch.trim().toLowerCase();
    if (item.id === ownerId || reviewerIds.includes(item.id)) return false;
    if (!query) return true;
    return (
      (item.full_name ?? "").toLowerCase().includes(query) ||
      (item.organization ?? "").toLowerCase().includes(query)
    );
  });

  if (fetching) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  if (loadError || !canSave) return <div className="space-y-3"><p role="alert" className="text-rose-700">{loadError || "Bạn không có quyền nộp bài báo."}</p><Button variant="outline" onClick={() => onCancel ? onCancel() : navigate("papers")}>Quay lại</Button></div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!embedded && (
        <>
          <button
            onClick={() =>
              onCancel
                ? onCancel()
                : navigate(
                    isEdit ? "paper-detail" : "papers",
                    isEdit ? { id: editId } : {},
                  )
            }
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </button>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {isEdit ? "Chỉnh sửa bài báo" : "Nộp bài báo mới"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Điền thông tin chi tiết về bài báo khoa học
            </p>
          </div>
        </>
      )}
      <form
        onSubmit={handleSubmit}
        className={
          embedded
            ? "space-y-5"
            : "space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        }
      >
        {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
        <fieldset disabled={loading} className="space-y-5">
        <p className="text-sm text-slate-500">Tải lên PDF hoặc nhập URL file. File tải lên được ưu tiên. Mỗi file mới được lưu thành một phiên bản riêng.</p>
        <Select
          label="Hội thảo *"
          value={conferenceId}
          onChange={(e) => setConferenceId(e.target.value)}
          disabled={isEdit}
        >
          <option value="">Chọn hội thảo</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>

        <Input
          label="Tiêu đề bài báo *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nhập tiêu đề bài báo"
        />

        <Textarea
          label="Tóm tắt *"
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          placeholder="Tóm tắt nội dung bài báo"
          className="min-h-[150px]"
        />

        <Input
          label="Từ khóa"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Cách nhau bởi dấu phẩy"
        />

        <Input
          label="URL file bài báo"
          value={fileUrl}
          onChange={(e) => setFileUrl(e.target.value)}
          placeholder="https://..."
        />

        <div className="space-y-3">
          <Input
            label="Tải lên file PDF (tối đa 15 MB)"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setPaperFile(e.target.files?.[0] ?? null)}
          />
          {(paperFile || fileUrl.trim()) && (
            <Textarea
              label="Ghi chú phiên bản"
              value={versionNotes}
              onChange={(e) => setVersionNotes(e.target.value)}
              placeholder="Ví dụ: Bản chỉnh sửa sau góp ý vòng 1"
              className="min-h-[80px]"
            />
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Đồng tác giả
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Chọn các tài khoản cùng tham gia bài báo này. Người đang phản biện bài sẽ không xuất hiện.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm đồng tác giả..."
              value={authorSearch}
              onChange={(e) => setAuthorSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
            {authorOptions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                Không tìm thấy tài khoản phù hợp
              </p>
            ) : (
              authorOptions.map((author) => (
                <label
                  key={author.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedAuthorIds.includes(author.id)}
                    onChange={() => toggleAuthor(author.id)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {author.full_name || "Chưa đặt tên"}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {author.organization || "Chưa cập nhật đơn vị"}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() =>
              onCancel
                ? onCancel()
                : navigate(
                    isEdit ? "paper-detail" : "papers",
                    isEdit ? { id: editId } : {},
                  )
            }
          >
            Hủy
          </Button>
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4" /> {loading ? saveStage : "Lưu"}
          </Button>
        </div>
        </fieldset>
      </form>
    </div>
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
