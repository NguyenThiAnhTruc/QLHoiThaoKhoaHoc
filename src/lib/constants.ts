import type {
  ConferenceStatus,
  PaperStatus,
  ReviewStatus,
  ReviewRecommendation,
  UserRole,
} from "@/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Quản trị viên",
  organizer: "Ban tổ chức",
  reviewer: "Phản biện",
  author: "Tác giả",
};

export const CONFERENCE_STATUS_LABELS: Record<ConferenceStatus, string> = {
  draft: "Bản nháp",
  open: "Đang mở đăng ký",
  closed: "Đã đóng đăng ký",
  ongoing: "Đang diễn ra",
  completed: "Đã hoàn thành",
  cancelled: "Đã hủy",
};

export const CONFERENCE_STATUS_COLORS: Record<ConferenceStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-emerald-100 text-emerald-700",
  closed: "bg-amber-100 text-amber-700",
  ongoing: "bg-blue-100 text-blue-700",
  completed: "bg-teal-100 text-teal-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function getConferenceDisplayStatus(
  conference: {
    status: ConferenceStatus;
    start_date: string;
    end_date: string;
    registration_deadline?: string | null;
  },
  now = new Date(),
): ConferenceStatus {
  if (conference.status === "draft" || conference.status === "cancelled")
    return conference.status;
  const start = conferenceDate(conference.start_date, false);
  const end = conferenceDate(conference.end_date, true);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    return conference.status;
  if (now < start) {
    if (conference.status === "closed" || conference.status === "completed")
      return conference.status;
    return !conference.registration_deadline ||
      now <= new Date(conference.registration_deadline)
      ? "open"
      : "closed";
  }
  if (now <= end) return "ongoing";
  return "completed";
}

export function isConferenceRegistrationOpen(
  conference: {
    status: ConferenceStatus;
    start_date: string;
    end_date: string;
    registration_deadline?: string | null;
  },
  now = new Date(),
) {
  return (
    getConferenceDisplayStatus(conference, now) === "open" &&
    now < conferenceDate(conference.start_date, false) &&
    (!conference.registration_deadline ||
      now <= new Date(conference.registration_deadline))
  );
}

function conferenceDate(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
}

export const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  submitted: "Chờ phân công",
  under_review: "Đang phản biện",
  accepted: "Đã chấp nhận",
  rejected: "Đã từ chối",
  revision_required: "Chờ sửa đổi",
};

export const PAPER_STATUS_COLORS: Record<PaperStatus, string> = {
  submitted: "bg-slate-100 text-slate-700",
  under_review: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  revision_required: "bg-amber-100 text-amber-700",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  declined: "Đã từ chối phân công",
  assigned: "Chờ xác nhận",
  in_progress: "Đang thực hiện",
  completed: "Đã hoàn thành",
};

export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  declined: "bg-rose-100 text-rose-700",
  assigned: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

export const RECOMMENDATION_LABELS: Record<ReviewRecommendation, string> = {
  accept: "Chấp nhận",
  reject: "Từ chối",
  revise: "Cần sửa đổi",
};

export const RECOMMENDATION_COLORS: Record<ReviewRecommendation, string> = {
  accept: "bg-emerald-100 text-emerald-700",
  reject: "bg-rose-100 text-rose-700",
  revise: "bg-amber-100 text-amber-700",
};

export const CERTIFICATE_TYPE_LABELS: Record<string, string> = {
  attendance: "Tham dự",
  presentation: "Báo cáo",
};

export const ALL_ROLES: UserRole[] = [
  "reviewer",
  "admin",
  "organizer",
  "author",
];

export const ALL_CONFERENCE_STATUSES: ConferenceStatus[] = [
  "draft",
  "open",
  "closed",
  "ongoing",
  "completed",
  "cancelled",
];

export const ALL_PAPER_STATUSES: PaperStatus[] = [
  "accepted",
  "rejected",
  "revision_required",
  "under_review",
  "submitted",
];

export const ALL_RECOMMENDATIONS: ReviewRecommendation[] = [
  "accept",
  "reject",
  "revise",
];
