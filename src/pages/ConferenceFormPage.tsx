import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "@/context/useRouter";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import {
  CONFERENCE_STATUS_LABELS,
  ALL_CONFERENCE_STATUSES,
} from "@/lib/constants";
import type { ConferenceStatus, EventFormat } from "@/types";
import { CONFERENCE_FIELDS, getConferenceTopics, isConferenceField } from "@/lib/conferenceFields";

const CONFERENCE_FORM_STATUSES = ALL_CONFERENCE_STATUSES.filter(
  (conferenceStatus) => conferenceStatus !== "draft",
);

interface ConferenceFormPageProps {
  embedded?: boolean;
  editId?: string;
  onCancel?: () => void;
  onSaved?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
}

export function ConferenceFormPage({
  embedded = false,
  editId: providedEditId,
  onCancel,
  onSaved,
  onSubmittingChange,
}: ConferenceFormPageProps = {}) {
  const { route, navigate } = useRouter();
  const editId = providedEditId ?? (!embedded ? route.params.id : undefined);
  const isEdit = !!editId;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<ConferenceStatus>("open");
  const [maxParticipants, setMaxParticipants] = useState(0);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [submissionDeadline, setSubmissionDeadline] = useState("");
  const [reviewDeadline, setReviewDeadline] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [cameraReadyDeadline, setCameraReadyDeadline] = useState("");
  const [field, setField] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const availableTopics = getConferenceTopics(field);
  const [eventFormat, setEventFormat] = useState<EventFormat>("offline");
  const [autoCertificates,setAutoCertificates]=useState(false);
  const [autoSurveys,setAutoSurveys]=useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(true);
  const [requireAcceptedPaper, setRequireAcceptedPaper] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isSchedulePublic, setIsSchedulePublic] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    onSubmittingChange?.(loading);
  }, [loading, onSubmittingChange]);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data, error } = await supabase
        .from("conferences")
        .select("*")
        .eq("id", editId)
        .maybeSingle();
      if (error || !data) {
        showToast("error", "Không thể tải thông tin hội thảo");
        navigate("conferences");
        return;
      }
      setTitle(data.title);
      setDescription(data.description ?? "");
      setStartDate(toDateTimeInput(data.start_date));
      setEndDate(toDateTimeInput(data.end_date));
      setLocation(data.location ?? "");
      setStatus(data.status === "draft" ? "open" : data.status);
      setMaxParticipants(data.max_participants ?? 0);
      setCoverImageUrl(data.cover_image_url ?? "");
      setSubmissionDeadline(toDateTimeInput(data.submission_deadline));
      setReviewDeadline(toDateTimeInput(data.review_deadline));
      setRegistrationDeadline(toDateTimeInput(data.registration_deadline));
      setCameraReadyDeadline(toDateTimeInput(data.camera_ready_deadline));
      setField(data.field ?? "");
      setTopics(data.topics ?? []);
      setEventFormat(data.event_format ?? "offline");
      setReviewEnabled(data.review_enabled !== false);
      setAutoCertificates(Boolean(data.auto_certificates));setAutoSurveys(Boolean(data.auto_surveys));
      setRequireAcceptedPaper(Boolean(data.require_accepted_paper));
      setIsFeatured(Boolean(data.is_featured));
      setIsSchedulePublic(data.is_schedule_public !== false);
      setContactName(data.contact_name ?? "");
      setContactEmail(data.contact_email ?? "");
      setContactPhone(data.contact_phone ?? "");
      setFetching(false);
    })();
  }, [editId, isEdit, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!title.trim() || !startDate || !endDate) {
      showToast("error", "Vui lòng điền đầy đủ thông tin");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      showToast("error", "Ngày kết thúc phải sau ngày bắt đầu");
      return;
    }
    if (!isConferenceField(field)) {
      showToast("error", "Vui lòng chọn lĩnh vực chính của hội thảo");
      return;
    }
    if (topics.some((topic) => !availableTopics.includes(topic))) {
      showToast("error", "Vui lòng chọn lại chủ đề thuộc lĩnh vực đã chọn");
      return;
    }

    setLoading(true);
    try {
    let uploadedCoverUrl = coverImageUrl.trim();
    if (coverImageFile) {
      if (!coverImageFile.type.startsWith("image/")) {
        showToast("error", "Ảnh bìa không đúng định dạng");
        setLoading(false);
        return;
      }
      if (coverImageFile.size > 5 * 1024 * 1024) {
        showToast("error", "Ảnh bìa không được vượt quá 5 MB");
        setLoading(false);
        return;
      }
      const extension =
        coverImageFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `covers/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("conference-images")
        .upload(path, coverImageFile, { cacheControl: "3600", upsert: false });
      if (uploadError) {
        showToast("error", "Tải ảnh bìa thất bại: " + uploadError.message);
        setLoading(false);
        return;
      }
      uploadedCoverUrl = supabase.storage
        .from("conference-images")
        .getPublicUrl(path).data.publicUrl;
    }
    const payload = {
      title: title.trim(),
      description: description.trim(),
      start_date: toNullableIso(startDate),
      end_date: toNullableIso(endDate),
      location: location.trim(),
      status,
      max_participants: maxParticipants,
      cover_image_url: uploadedCoverUrl,
      submission_deadline: toNullableIso(submissionDeadline),
      review_deadline: reviewEnabled ? toNullableIso(reviewDeadline) : null,
      review_enabled: reviewEnabled,
      auto_certificates:autoCertificates,auto_surveys:autoSurveys,
      require_accepted_paper: requireAcceptedPaper,
      registration_deadline: toNullableIso(registrationDeadline),
      camera_ready_deadline: toNullableIso(cameraReadyDeadline),
      field,
      topics: [...new Set(topics)],
      event_format: eventFormat,
      is_featured: isFeatured,
      is_schedule_public: isSchedulePublic,
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      contact_phone: contactPhone.trim(),
    };

    if (isEdit) {
      const { error } = await supabase
        .from("conferences")
        .update(payload)
        .eq("id", editId);
      if (error) {
        showToast("error", "Cập nhật thất bại: " + error.message);
      } else {
        showToast("success", "Cập nhật hội thảo thành công");
        if (onSaved) onSaved();
        else navigate("conference-detail", { id: editId });
      }
    } else {
      const { data, error } = await supabase
        .from("conferences")
        .insert(payload)
        .select()
        .single();
      if (error) {
        showToast("error", "Tạo hội thảo thất bại: " + error.message);
      } else {
        showToast("success", "Tạo hội thảo thành công");
        if (onSaved) onSaved();
        else navigate("conference-detail", { id: data.id });
      }
    }
    } catch {
      showToast("error", "Không thể lưu hội thảo. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!embedded && (
        <>
          <button
            onClick={() =>
              onCancel
                ? onCancel()
                : navigate(
                    isEdit ? "conference-detail" : "conferences",
                    isEdit ? { id: editId } : {},
                  )
            }
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </button>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {isEdit ? "Chỉnh sửa hội thảo" : "Tạo hội thảo mới"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Điền thông tin chi tiết về hội thảo
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
        <Input
          label="Tên hội thảo *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nhập tên hội thảo"
        />

        <Select
          label="Lĩnh vực *"
          aria-label="Lĩnh vực"
          required
          disabled={loading}
          value={field}
          onChange={(e) => {
            const nextField = e.target.value;
            setField(nextField);
            setTopics((current) => current.filter((topic) => getConferenceTopics(nextField).includes(topic)));
          }}
        >
          <option value="">Chọn lĩnh vực chính</option>
          {Object.keys(CONFERENCE_FIELDS).map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>

        <section className="space-y-3 rounded-lg border border-slate-200 p-4" aria-label="Chủ đề">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Chủ đề</h2>
            <p className="mt-1 text-xs text-slate-500">{field ? "Có thể chọn nhiều chủ đề. Khi đổi lĩnh vực, các chủ đề không phù hợp sẽ được bỏ chọn." : "Chọn lĩnh vực để xem các chủ đề tương ứng."}</p>
          </div>
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Chủ đề đã chọn">
              {topics.map((topic) => (
                <span key={topic} className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-sm text-teal-800">
                  {topic}
                  <button type="button" disabled={loading} aria-label={`Xóa chủ đề ${topic}`} className="rounded-full p-1 hover:bg-teal-100 focus-visible:outline-teal-600" onClick={() => setTopics((current) => current.filter((item) => item !== topic))}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {topics.some((topic) => !availableTopics.includes(topic)) && (
            <p className="text-xs text-amber-700">Hội thảo có chủ đề cũ chưa thuộc danh sách hiện tại. Vui lòng chọn lĩnh vực và cập nhật chủ đề trước khi lưu.</p>
          )}
          {field && (
            <div className="grid gap-2 sm:grid-cols-2">
              {availableTopics.map((topic) => (
                <label key={topic} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" disabled={loading} checked={topics.includes(topic)} onChange={(e) => setTopics((current) => e.target.checked ? [...new Set([...current, topic])] : current.filter((item) => item !== topic))} className="h-4 w-4 rounded border-slate-300 accent-teal-600" />
                  {topic}
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Hình thức tổ chức"
            value={eventFormat}
            onChange={(e) => setEventFormat(e.target.value as EventFormat)}
          >
            <option value="offline">Trực tiếp</option>
            <option value="online">Trực tuyến</option>
            <option value="hybrid">Kết hợp</option>
          </Select>
        </div>

        <Textarea
          label="Mô tả"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Mô tả ngắn về hội thảo"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateInput
            label="Ngày và giờ bắt đầu *"
            type="datetime-local"
            value={startDate}
            onValueChange={setStartDate}
           />
          <DateInput
            label="Ngày và giờ kết thúc *"
            type="datetime-local"
            value={endDate}
            onValueChange={setEndDate}
           />
        </div>

        <Input
          label="Địa điểm"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Địa điểm tổ chức"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Trạng thái"
            value={status}
            onChange={(e) => setStatus(e.target.value as ConferenceStatus)}
          >
            {CONFERENCE_FORM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONFERENCE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Input
            label="Số người tối đa"
            type="number"
            min={0}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(parseInt(e.target.value) || 0)}
          />
        </div>

        <Input
          label="URL hình ảnh bìa"
          value={coverImageUrl}
          onChange={(e) => {
            setCoverImageUrl(e.target.value);
            setCoverImageFile(null);
          }}
          placeholder="https://..."
        />
        <label className="block text-sm font-medium text-slate-700">
          Hoặc tải ảnh từ máy
          <input
            type="file"
            accept="image/*"
            className="mt-2 block w-full rounded-lg border border-slate-200 p-2 text-sm font-normal"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setCoverImageFile(file);
              if (file) setCoverImageUrl("");
            }}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            PNG, JPG hoặc WEBP, tối đa 5 MB.
          </span>
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateInput
            label="Deadline nộp bài"
            type="datetime-local"
            value={submissionDeadline}
            onValueChange={setSubmissionDeadline}
           />
          <DateInput
            disabled={!reviewEnabled}
            label="Deadline phản biện"
            type="datetime-local"
            value={reviewDeadline}
            onValueChange={setReviewDeadline}
           />
          <DateInput
            label="Deadline đăng ký tham dự"
            type="datetime-local"
            value={registrationDeadline}
            onValueChange={setRegistrationDeadline}
           />
          <DateInput
            label="Deadline camera ready"
            type="datetime-local"
            value={cameraReadyDeadline}
            onValueChange={setCameraReadyDeadline}
           />
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <label className="flex items-center gap-3"><input type="checkbox" checked={autoCertificates} onChange={(event)=>setAutoCertificates(event.target.checked)}/><span>Tự động cấp và gửi chứng nhận tham dự sau hội thảo</span></label>
          <label className="flex items-center gap-3"><input type="checkbox" checked={autoSurveys} onChange={(event)=>setAutoSurveys(event.target.checked)}/><span>Tự động nhắc đánh giá sau từng phiên</span></label>
          <label className="flex items-center gap-3"><input type="checkbox" checked={reviewEnabled} onChange={(event) => setReviewEnabled(event.target.checked)} /><span>Sử dụng phản biện bài báo</span></label>
          <p className="text-xs text-slate-500">Khi tắt, ban tổ chức quyết định trực tiếp chấp nhận, từ chối hoặc yêu cầu sửa bài.</p>
          <label className="flex items-center gap-3"><input type="checkbox" checked={requireAcceptedPaper} onChange={(event) => setRequireAcceptedPaper(event.target.checked)} /><span>Tác giả chỉ đăng ký tham dự sau khi có bài được chấp nhận</span></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700">
              Đánh dấu hội thảo nổi bật
            </span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={isSchedulePublic}
              onChange={(e) => setIsSchedulePublic(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-sm font-medium text-slate-700">
              Công khai lịch trình
            </span>
          </label>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700">
            Liên hệ ban tổ chức
          </p>
          <Input
            label="Người liên hệ"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Họ và tên"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Email liên hệ"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="contact@example.com"
            />
            <Input
              label="Số điện thoại liên hệ"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="0900000000"
            />
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
                    isEdit ? "conference-detail" : "conferences",
                    isEdit ? { id: editId } : {},
                  )
            }
          >
            Hủy
          </Button>
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4" /> {loading ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function toDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toNullableIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}
