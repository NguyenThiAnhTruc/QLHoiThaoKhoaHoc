import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
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
  const [status, setStatus] = useState<ConferenceStatus>("draft");
  const [maxParticipants, setMaxParticipants] = useState(0);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [submissionDeadline, setSubmissionDeadline] = useState("");
  const [reviewDeadline, setReviewDeadline] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [cameraReadyDeadline, setCameraReadyDeadline] = useState("");
  const [blindReview, setBlindReview] = useState(false);
  const [topics, setTopics] = useState("");
  const [eventFormat, setEventFormat] = useState<EventFormat>("offline");
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
      setStatus(data.status);
      setMaxParticipants(data.max_participants ?? 0);
      setCoverImageUrl(data.cover_image_url ?? "");
      setSubmissionDeadline(toDateTimeInput(data.submission_deadline));
      setReviewDeadline(toDateTimeInput(data.review_deadline));
      setRegistrationDeadline(toDateTimeInput(data.registration_deadline));
      setCameraReadyDeadline(toDateTimeInput(data.camera_ready_deadline));
      setBlindReview(Boolean(data.blind_review));
      setTopics((data.topics ?? []).join(", "));
      setEventFormat(data.event_format ?? "offline");
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
    if (!title.trim() || !startDate || !endDate) {
      showToast("error", "Vui lòng điền đầy đủ thông tin");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      showToast("error", "Ngày kết thúc phải sau ngày bắt đầu");
      return;
    }

    setLoading(true);
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
      review_deadline: toNullableIso(reviewDeadline),
      registration_deadline: toNullableIso(registrationDeadline),
      camera_ready_deadline: toNullableIso(cameraReadyDeadline),
      blind_review: blindReview,
      topics: topics
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
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
    setLoading(false);
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Chủ đề"
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            placeholder="AI, Data Science, Cybersecurity"
          />
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
          <Input
            label="Ngày và giờ bắt đầu *"
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Ngày và giờ kết thúc *"
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
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
            {ALL_CONFERENCE_STATUSES.map((s) => (
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
          <Input
            label="Deadline nộp bài"
            type="datetime-local"
            value={submissionDeadline}
            onChange={(e) => setSubmissionDeadline(e.target.value)}
          />
          <Input
            label="Deadline phản biện"
            type="datetime-local"
            value={reviewDeadline}
            onChange={(e) => setReviewDeadline(e.target.value)}
          />
          <Input
            label="Deadline đăng ký tham dự"
            type="datetime-local"
            value={registrationDeadline}
            onChange={(e) => setRegistrationDeadline(e.target.value)}
          />
          <Input
            label="Deadline camera ready"
            type="datetime-local"
            value={cameraReadyDeadline}
            onChange={(e) => setCameraReadyDeadline(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <input
            type="checkbox"
            checked={blindReview}
            onChange={(e) => setBlindReview(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-700">
              Bật blind review
            </span>
            <span className="text-xs text-slate-500">
              Ẩn thông tin tác giả với phản biện khi xem bài báo.
            </span>
          </span>
        </label>

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
