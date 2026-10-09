import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { withRequestTimeout } from "@/lib/requestTimeout";
import { useRouter } from "@/context/useRouter";
import { useAuth } from "@/context/useAuth";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, ConferenceTopic, Profile } from "@/types";

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
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [keywords, setKeywords] = useState("");
  const [problem, setProblem] = useState("");
  const [goals, setGoals] = useState("");
  const [groupName, setGroupName] = useState("");
  const [mainAuthorId, setMainAuthorId] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedAuthorIds, setSelectedAuthorIds] = useState<string[]>([]);
  const [authorParticipation, setAuthorParticipation] = useState<Record<string, "participating" | "not_participating">>({});
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
  const [topics, setTopics] = useState<ConferenceTopic[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
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
        setAuthorParticipation((current) => ({ ...current, [data.submitted_by]: data.author_participation_status ?? "participating" }));
        const { data: allowed, error: accessError } = await supabase.rpc("can_edit_paper_submission", { target_paper_id: editId });
        if (accessError) throw accessError;
        if (!allowed) throw new Error("Bạn không có quyền sửa bài hoặc đã hết hạn chỉnh sửa.");
        const { data: assigned, error: reviewError } = await supabase.from("reviews").select("reviewer_id").eq("paper_id", editId);
        if (reviewError) throw reviewError;
        setReviewerIds((assigned ?? []).map((review) => review.reviewer_id));
        setConferenceId(data.conference_id);
        const { data: paperTopicRows, error: paperTopicsError } = await supabase
          .from("paper_topics")
          .select("topic_id")
          .eq("paper_id", editId);
        if (paperTopicsError) throw paperTopicsError;
        setSelectedTopicIds((paperTopicRows ?? []).map((row) => row.topic_id));
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
        setProblem(data.problem_statement ?? "");
        setGoals(data.objectives ?? "");
        setGroupName(data.author_group ?? "");
        setMainAuthorId(data.corresponding_author_id ?? data.submitted_by ?? "");
        setFileUrl(data.file_url ?? "");

        const { data: authors, error: authorsError } = await supabase
          .from("paper_authors")
          .select("user_id, participation_status")
          .eq("paper_id", editId).order("author_order");
        if (authorsError) throw authorsError;
        if (authors) {
          setSelectedAuthorIds(authors.map((author) => author.user_id));
          setAuthorParticipation({ [data.submitted_by]: data.author_participation_status ?? "participating", ...Object.fromEntries(authors.map((author) => [
            author.user_id,
            author.participation_status === "not_participating" ? "not_participating" : "participating",
          ])) });
        }
        setCanSave(true);
      } else {
        if (requestedConferenceId) setConferenceId(requestedConferenceId);
        setOwnerId(profile?.id ?? null);
        setMainAuthorId(profile?.id ?? "");
        setCanSave(profile?.role === "author" || profile?.role === "admin");
      }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu bài báo. Vui lòng tải lại trang.");
      } finally { setFetching(false); }
    })();
  }, [editId, isEdit, navigate, requestedConferenceId, profile?.id, profile?.role]);

  useEffect(() => {
    if (!conferenceId) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    setTopics([]);
    void supabase.from("conference_topics").select("*").eq("conference_id", conferenceId)
      .order("name").then(({ data, error }) => {
        if (cancelled) return;
        if (error) showToast("error", "Không thể tải chủ đề hội thảo");
        setTopics((data ?? []) as ConferenceTopic[]);
        setSelectedTopicIds((current) => current.filter((id) => (data ?? []).some((topic) => topic.id === id)));
      });
    return () => { cancelled = true; };
  }, [conferenceId]);

  function nextStep() {
    if (step === 0 && (!conferenceId || !title.trim() || !abstract.trim() || !keywords.trim())) {
      showToast("error", "Chọn hội thảo và nhập tiêu đề, tóm tắt, từ khóa trước khi tiếp tục"); return;
    }
    if (step === 1 && (!mainAuthorId || (mainAuthorId !== ownerId && !selectedAuthorIds.includes(mainAuthorId)))) {
      showToast("error", "Chọn tác giả chính thuộc nhóm tác giả"); return;
    }
    setStep((current) => Math.min(2,current+1));
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || !canSave) return;
    if (step < 2) { nextStep(); return; }
    if (!conferenceId || !title.trim() || !abstract.trim() || !keywords.trim() || (!paperFile && !fileUrl.trim())) {
      showToast("error", "Vui lòng chọn hội thảo, nhập tiêu đề, tóm tắt, từ khóa và file bài báo");
      return;
    }
    if (!mainAuthorId || (mainAuthorId !== ownerId && !selectedAuthorIds.includes(mainAuthorId))) {
      showToast("error", "Vui lòng chọn tác giả chính thuộc nhóm tác giả"); return;
    }
    submitting.current = true;
    setLoading(true);
    setSaveError("");
    try {
      setSaveStage(paperFile ? "Đang tải PDF..." : "Đang lưu...");
      const uploadedUrl = await uploadPaperFile();
      if (paperFile && !uploadedUrl) return;
      setSaveStage("Đang lưu bài báo...");
      const { data, error } = await withRequestTimeout((signal) => supabase.rpc("save_complete_paper_submission", {
        target_paper_id: editId ?? submissionId.current,
        target_conference_id: conferenceId,
        paper_title: title.trim(), paper_abstract: abstract.trim(),
        paper_keywords: keywords.trim(), paper_file: uploadedUrl ?? fileUrl.trim(),
        author_ids: selectedAuthorIds, version_notes: versionNotes.trim(),
        expected_updated_at: expectedUpdatedAt,
        topic_ids: selectedTopicIds, participation: authorParticipation,
        problem, goals, group_name: groupName, main_author_id: mainAuthorId,
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
        <ol className="grid grid-cols-3 gap-2" aria-label="Các bước nộp bài">{["Thông tin bài", "Tác giả", "Tệp đính kèm"].map((label,index) => <li key={label}><button type="button" disabled={index > step} onClick={() => setStep(index)} aria-current={index === step ? "step" : undefined} className={`w-full rounded-lg px-2 py-3 text-sm ${index === step ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"}`}>{index+1}. {label}</button></li>)}</ol>
        <section hidden={step !== 0} className="space-y-5" aria-label="Thông tin bài">
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

        {topics.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Chủ đề bài báo</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {topics.map((topic) => (
                <label key={topic.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={selectedTopicIds.includes(topic.id)}
                    onChange={(event) => setSelectedTopicIds((current) => event.target.checked
                      ? [...new Set([...current, topic.id])]
                      : current.filter((id) => id !== topic.id))}
                    className="h-4 w-4 accent-teal-600" />
                  {topic.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

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
          label="Từ khóa *"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Cách nhau bởi dấu phẩy"
        />

          <Textarea label="Đặt vấn đề" value={problem} onChange={(event) => setProblem(event.target.value)} />
          <Textarea label="Mục tiêu nghiên cứu" value={goals} onChange={(event) => setGoals(event.target.value)} />
        </section>
        <section hidden={step !== 1} className="space-y-5" aria-label="Tác giả">
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
          <div className="space-y-3">
          <Input label="Tên nhóm tác giả" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
          {ownerId && <Select label="Trạng thái tham gia của tác giả nộp bài" value={authorParticipation[ownerId] ?? "participating"} onChange={(event) => setAuthorParticipation((current) => ({...current, [ownerId]: event.target.value as "participating" | "not_participating"}))}><option value="participating">Tham gia</option><option value="not_participating">Không tham gia</option></Select>}
          <Select label="Tác giả chính / liên hệ" value={mainAuthorId} onChange={(event) => setMainAuthorId(event.target.value)}>
            <option value="">Chọn tác giả chính</option>
            {profiles.filter((user) => user.id === ownerId || selectedAuthorIds.includes(user.id)).map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
          </Select>
          <p className="text-sm text-slate-600">{[profiles.find((user) => user.id === ownerId)?.full_name, ...selectedAuthorIds.map((id) => profiles.find((user) => user.id === id)?.full_name)].filter(Boolean).join(' & ')}</p>
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
                    onChange={() => {
                      toggleAuthor(author.id);
                      if (!selectedAuthorIds.includes(author.id)) {
                        setAuthorParticipation((current) => ({ ...current, [author.id]: "participating" }));
                      }
                    }}
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
                  {selectedAuthorIds.includes(author.id) && <select
                    aria-label={`Trạng thái tham gia của ${author.full_name}`}
                    value={authorParticipation[author.id] ?? "participating"}
                    onChange={(event) => setAuthorParticipation((current) => ({
                      ...current,
                      [author.id]: event.target.value as "participating" | "not_participating",
                    }))}
                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                  >
                    <option value="participating">Tham gia</option>
                    <option value="not_participating">Không tham gia</option>
                  </select>}
                </label>
              ))
            )}
          </div>
        </div>

        </section>
        <section hidden={step !== 2} className="space-y-5" aria-label="Tệp đính kèm">
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

        </section>
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
          {step > 0 && <Button type="button" variant="outline" onClick={() => setStep(step-1)}>Bước trước</Button>}
          {step < 2 ? <Button type="button" onClick={nextStep}>Tiếp tục</Button> : <Button type="submit" disabled={loading}><Save className="h-4 w-4" />{loading ? saveStage : "Lưu bài"}</Button>}
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
