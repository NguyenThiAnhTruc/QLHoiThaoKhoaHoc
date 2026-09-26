import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  MapPin,
  BarChart3,
  Mail,
  Plus,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import type { PageKey } from "@/context/RouterContextCore";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConferenceFormPage } from "@/pages/ConferenceFormPage";
import { PaperFormPage } from "@/pages/PaperFormPage";
import { AdminReports } from "@/components/AdminReports";
import { AdminManagementTable } from "@/components/AdminManagementTable";
import {
  CONFERENCE_STATUS_COLORS,
  CONFERENCE_STATUS_LABELS,
  PAPER_STATUS_COLORS,
  PAPER_STATUS_LABELS,
  getConferenceDisplayStatus,
} from "@/lib/constants";
import type { Conference, Paper, Participant } from "@/types";

interface ReviewRow {
  paper_id: string;
  status: string;
  paper?: { conference?: { review_deadline: string | null } | null } | null;
}

interface AuditItem {
  id: string;
  action: string;
  created_at: string;
  actor?: { full_name: string } | null;
}

interface DeadlineWarning {
  category: "conference" | "paper";
  id: string;
  title: string;
  label: string;
  date: string;
  days: number;
}

type Navigate = (page: PageKey, params?: Record<string, string>) => void;

const actionLabels: Record<string, string> = {
  "conference.created": "Tạo hội thảo",
  "paper.submitted": "Nộp bài báo",
  "review.assigned": "Phân công phản biện",
  "review.completed": "Hoàn thành phản biện",
  "certificate.issued": "Cấp chứng nhận",
  "profile.role_changed": "Thay đổi vai trò",
};

export function DashboardPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [createForm, setCreateForm] = useState<"conference" | "paper" | null>(
    null,
  );
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [editForm, setEditForm] = useState<{
    kind: "conference" | "paper";
    id: string;
  } | null>(null);

  function closeCreateForm() {
    if (!formSubmitting) setCreateForm(null);
  }

  function handleCreated() {
    setCreateForm(null);
    setEditForm(null);
    setFormSubmitting(false);
    setReloadKey((key) => key + 1);
  }
  const [activeTab, setActiveTab] = useState<
    "overview" | "management" | "papers" | "reports"
  >("overview");

  const [conferences, setConferences] = useState<Conference[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [sessionConferenceIds, setSessionConferenceIds] = useState<string[]>(
    [],
  );
  const [attendanceCertificateKeys, setAttendanceCertificateKeys] = useState<
    Set<string>
  >(new Set());

  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setLoading(true);
      setLoadError(false);
      try {
        const [conferenceResult, paperResult, participantResult] =
          await Promise.all([
            fetchAll((from, to) =>
              supabase
                .from("conferences")
                .select("*", { count: "exact" })
                .order("start_date")
                .order("id")
                .range(from, to),
            ),
            fetchAll((from, to) =>
              supabase
                .rpc("read_papers", {}, { count: "exact" })
                .select("*, conference:conferences(*)")
                .order("created_at", { ascending: false })
                .order("id")
                .range(from, to),
            ),
            fetchAll((from, to) =>
              supabase
                .from("participants")
                .select("*, conference:conferences(*)", { count: "exact" })
                .order("registered_at", { ascending: false })
                .order("id")
                .range(from, to),
            ),
          ]);
        if (cancelled) return;
        if (
          conferenceResult.error ||
          paperResult.error ||
          participantResult.error
        ) {
          throw new Error("Dashboard data could not be loaded");
        }

        const nextConferences = (conferenceResult.data ?? []) as Conference[];
        const nextPapers = (paperResult.data ?? []) as unknown as Paper[];
        const nextParticipants = (participantResult.data ??
          []) as unknown as Participant[];
        setConferences(nextConferences);
        setPapers(nextPapers);
        setParticipants(nextParticipants);

        if (isAdmin) {
          const [reviewResult, sessionResult, certificateResult, auditResult] =
            await Promise.all([
              fetchAll((from, to) =>
                supabase
                  .from("reviews")
                  .select(
                    "paper_id, status, paper:papers(conference:conferences(review_deadline))",
                    { count: "exact" },
                  )
                  .order("id")
                  .range(from, to),
              ),
              fetchAll((from, to) =>
                supabase
                  .from("sessions")
                  .select("conference_id", { count: "exact" })
                  .order("id")
                  .range(from, to),
              ),
              fetchAll((from, to) =>
                supabase
                  .from("certificates")
                  .select("conference_id, user_id, certificate_type", {
                    count: "exact",
                  })
                  .order("id")
                  .range(from, to),
              ),
              supabase
                .from("audit_logs")
                .select("id, action, created_at, actor:profiles(full_name)")
                .order("created_at", { ascending: false })
                .limit(8),
            ]);
          if (cancelled) return;
          if (
            [reviewResult, sessionResult, certificateResult, auditResult].some(
              (result) => result.error,
            )
          ) {
            throw new Error("Admin dashboard data could not be loaded");
          }
          setReviews((reviewResult.data ?? []) as unknown as ReviewRow[]);
          setSessionConferenceIds(
            (sessionResult.data ?? []).map(
              ({ conference_id }) => conference_id,
            ),
          );
          setAttendanceCertificateKeys(
            new Set(
              (certificateResult.data ?? [])
                .filter(
                  ({ certificate_type }) => certificate_type === "attendance",
                )
                .map(
                  ({ conference_id, user_id }) => `${conference_id}:${user_id}`,
                ),
            ),
          );
          setAuditLogs((auditResult.data ?? []) as unknown as AuditItem[]);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, profile?.id, reloadKey]);

  const upcomingConferences = useMemo(
    () =>
      conferences
        .filter(
          ({ start_date, status }) =>
            !["cancelled", "completed"].includes(status) &&
            new Date(start_date) >= startOfToday(),
        )
        .slice(0, 5),
    [conferences],
  );
  const deadlineWarnings = useMemo(
    () =>
      conferences
        .flatMap((conference) => [
          makeDeadlineWarning(conference, "submission_deadline", "Hạn nộp bài"),
          makeDeadlineWarning(conference, "review_deadline", "Hạn phản biện"),
          makeDeadlineWarning(
            conference,
            "registration_deadline",
            "Hạn đăng ký",
          ),
          makeDeadlineWarning(
            conference,
            "camera_ready_deadline",
            "Hạn camera-ready",
          ),
        ])
        .filter((item): item is DeadlineWarning => item !== null)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [conferences],
  );

  const pendingWork = useMemo(() => {
    const papersWithReviews = new Set(reviews.filter(r => r.status !== 'declined').map(({ paper_id }) => paper_id));
    const unassignedPapers = papers.filter(
      ({ id, status }) =>
        !papersWithReviews.has(id) &&
        !["accepted", "rejected"].includes(status),
    ).length;
    const overdueReviews = reviews.filter(
      ({ status, paper }) =>
        (status === "assigned" || status === "in_progress") &&
        paper?.conference?.review_deadline &&
        new Date(paper.conference.review_deadline) < new Date(),
    ).length;
    const scheduledConferences = new Set(sessionConferenceIds);
    const missingSchedules = conferences.filter(
      (conference) =>
        !["draft", "completed", "cancelled"].includes(
          getConferenceDisplayStatus(conference),
        ) &&
        new Date(conference.start_date) >= startOfToday() &&
        !scheduledConferences.has(conference.id),
    ).length;
    const missingCertificates = participants.filter(
      (participant) =>
        participant.attended &&
        !attendanceCertificateKeys.has(
          `${participant.conference_id}:${participant.user_id}`,
        ),
    ).length;
    return [
      {
        label: "Bài chưa phân công phản biện",
        value: unassignedPapers,
        page: "papers" as const,
      },
      {
        label: "Phản biện quá hạn",
        value: overdueReviews,
        page: "reviews" as const,
      },
      {
        label: "Hội thảo chưa có lịch trình",
        value: missingSchedules,
        page: "conferences" as const,
      },
      {
        label: "Người đã điểm danh chưa có chứng nhận",
        value: missingCertificates,
        page: "certificates" as const,
      },
    ];
  }, [
    attendanceCertificateKeys,
    conferences,
    papers,
    participants,
    reviews,
    sessionConferenceIds,
  ]);

  if (loading) return <LoadingState />;
  if (loadError)
    return (
      <Card className="p-6 text-center">
        <div role="alert">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">
            Không thể tải trang tổng quan
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Dữ liệu chưa được tải đầy đủ. Vui lòng thử lại.
          </p>
        </div>
        <Button
          type="button"
          className="mt-4"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Thử lại
        </Button>
      </Card>
    );
  if (!isAdmin) {
    return (
      <MemberDashboard
        profileName={profile?.full_name}
        upcomingConferences={upcomingConferences}
        recentPapers={papers.slice(0, 5)}
        registrations={participants
          .filter((item) => item.user_id === profile?.id)
          .slice(0, 5)}
        navigate={navigate}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Quản lý hội thảo
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Tổng quan hội thảo khoa học và công việc quản trị.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("messages")}>
            <Mail className="h-4 w-4" />
            Thông báo nội bộ
          </Button>
          <Button variant="outline" onClick={() => navigate("messages", { compose: "email" })}>
            <Mail className="h-4 w-4" />
            Thông báo Gmail
          </Button>
          <Button onClick={() => setCreateForm("conference")}>
            <Plus className="h-4 w-4" />
            Tạo hội thảo
          </Button>
          <Button onClick={() => setCreateForm("paper")}>
            <FileText className="h-4 w-4" />
            Tạo bài báo
          </Button>
        </div>
      </header>

      <Modal
        open={createForm !== null}
        onClose={closeCreateForm}
        title={
          createForm === "conference" ? "Tạo hội thảo mới" : "Tạo bài báo mới"
        }
        size="lg"
      >
        {createForm === "conference" && (
          <ConferenceFormPage
            embedded
            onCancel={closeCreateForm}
            onSaved={handleCreated}
            onSubmittingChange={setFormSubmitting}
          />
        )}
        {createForm === "paper" && (
          <PaperFormPage
            embedded
            onCancel={closeCreateForm}
            onSaved={handleCreated}
            onSubmittingChange={setFormSubmitting}
          />
        )}
      </Modal>

      <Modal
        open={editForm !== null}
        onClose={() => {
          if (!formSubmitting) setEditForm(null);
        }}
        title={
          editForm?.kind === "conference"
            ? "Chỉnh sửa hội thảo"
            : "Chỉnh sửa bài báo"
        }
        size="lg"
      >
        {editForm?.kind === "conference" && (
          <ConferenceFormPage
            embedded
            editId={editForm.id}
            onCancel={() => setEditForm(null)}
            onSaved={handleCreated}
            onSubmittingChange={setFormSubmitting}
          />
        )}
        {editForm?.kind === "paper" && (
          <PaperFormPage
            embedded
            editId={editForm.id}
            onCancel={() => setEditForm(null)}
            onSaved={handleCreated}
            onSubmittingChange={setFormSubmitting}
          />
        )}
      </Modal>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div
          className="flex overflow-x-auto border-b border-slate-200"
          role="group"
          aria-label="Nội dung tổng quan"
        >
          {(
            [
              { key: "overview", label: "Tổng quan", icon: BarChart3 },
              {
                key: "management",
                label: "Quản lý hội thảo",
                icon: CalendarDays,
              },
              { key: "papers", label: "Quản lý bài báo", icon: FileText },
              { key: "reports", label: "Thống kê & Báo cáo", icon: BarChart3 },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={activeTab === key}
              onClick={() => setActiveTab(key)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium focus-visible:outline-teal-600 ${activeTab === key ? "border-teal-600 bg-teal-50 text-teal-700" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-6 p-4 sm:p-5">
          {activeTab === "overview" && <AuditList auditLogs={auditLogs} />}
          {activeTab === "reports" && <AdminReports />}
          {(activeTab === "management" || activeTab === "papers") && (
            <>
              <AdminManagementTable
                key={activeTab}
                kind={activeTab === "management" ? "conferences" : "papers"}
                conferences={conferences}
                papers={papers}
                participants={participants}
                onChanged={() => setReloadKey((key) => key + 1)}
                onEdit={(id) =>
                  setEditForm({
                    kind: activeTab === "management" ? "conference" : "paper",
                    id,
                  })
                }
              />
              <details className="rounded-lg border border-slate-100 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-500">
                  Công việc cần xử lý và cảnh báo deadline
                </summary>
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <Panel title="Cần xử lý" icon={AlertTriangle}>
                    <div className="divide-y divide-slate-100">
                      {pendingWork
                        .filter((item) =>
                          activeTab === "papers"
                            ? ["papers", "reviews"].includes(item.page)
                            : !["papers", "reviews"].includes(item.page),
                        )
                        .map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => navigate(item.page)}
                            className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-slate-50"
                          >
                            <span className="text-sm text-slate-700">
                              {item.label}
                            </span>
                            <Badge
                              className={
                                item.value > 0
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }
                            >
                              {item.value}
                            </Badge>
                          </button>
                        ))}
                    </div>
                  </Panel>
                  <Panel title="Cảnh báo deadline" icon={Clock3}>
                    <DeadlineList
                      warnings={deadlineWarnings
                        .filter(
                          (warning) =>
                            warning.category ===
                            (activeTab === "papers" ? "paper" : "conference"),
                        )
                        .slice(0, 5)}
                    />
                  </Panel>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberDashboard({
  profileName,
  upcomingConferences,
  recentPapers,
  registrations,
  navigate,
}: {
  profileName?: string;
  upcomingConferences: Conference[];
  recentPapers: Paper[];
  registrations: Participant[];
  navigate: Navigate;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          Xin chào, {profileName || "bạn"}!
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Tổng quan về hội thảo và công việc của bạn.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ConferenceList conferences={upcomingConferences} navigate={navigate} />
        <PaperList papers={recentPapers} navigate={navigate} />
      </div>
      {registrations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">
              Hội thảo đã đăng ký
            </h2>
            <CheckCircle2 className="h-5 w-5 text-slate-400" />
          </div>
          <div className="divide-y divide-slate-100">
            {registrations.map((registration) => (
              <div
                key={registration.id}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {registration.conference?.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Đăng ký: {formatDate(registration.registered_at)}
                  </p>
                </div>
                <Badge
                  className={
                    registration.attended
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                  }
                >
                  {registration.attended ? "Đã điểm danh" : "Chưa điểm danh"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      {children}
    </Card>
  );
}

function DeadlineList({ warnings }: { warnings: DeadlineWarning[] }) {
  return (
    <div className="divide-y divide-slate-100">
      {warnings.length === 0 ? (
        <Empty text="Không có deadline sắp hết hạn" />
      ) : (
        warnings.map((warning) => (
          <div key={warning.id} className="px-5 py-3.5">
            <p className="text-sm font-medium text-amber-800">
              {warning.label}: còn {warning.days} ngày
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">
              {warning.title} · {formatDate(warning.date)}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

function ConferenceList({
  conferences,
  navigate,
}: {
  conferences: Conference[];
  navigate: Navigate;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="font-semibold text-slate-900">Hội thảo sắp tới</h2>
        <button
          type="button"
          onClick={() => navigate("conferences")}
          className="flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
        >
          Tất cả <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {conferences.length === 0 ? (
          <Empty text="Chưa có hội thảo sắp tới" />
        ) : (
          conferences.map((conference) => (
            <button
              key={conference.id}
              type="button"
              onClick={() =>
                navigate("conference-detail", { id: conference.id })
              }
              className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  {conference.title}
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatDate(conference.start_date)}{" "}
                  {conference.location && (
                    <>
                      <MapPin className="ml-1 h-3.5 w-3.5" />
                      {conference.location}
                    </>
                  )}
                </p>
              </div>
              <Badge
                className={
                  CONFERENCE_STATUS_COLORS[
                    getConferenceDisplayStatus(conference)
                  ]
                }
              >
                {
                  CONFERENCE_STATUS_LABELS[
                    getConferenceDisplayStatus(conference)
                  ]
                }
              </Badge>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

function PaperList({
  papers,
  navigate,
}: {
  papers: Paper[];
  navigate: Navigate;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="font-semibold text-slate-900">Bài báo gần đây</h2>
        <button
          type="button"
          onClick={() => navigate("papers")}
          className="flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
        >
          Tất cả <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {papers.length === 0 ? (
          <Empty text="Chưa có bài báo nào" />
        ) : (
          papers.map((paper) => (
            <button
              key={paper.id}
              type="button"
              onClick={() => navigate("paper-detail", { id: paper.id })}
              className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-slate-50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  {paper.title}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {paper.conference?.title || "Chưa xác định hội thảo"}
                </p>
              </div>
              <Badge className={PAPER_STATUS_COLORS[paper.status]}>
                {PAPER_STATUS_LABELS[paper.status]}
              </Badge>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

function AuditList({ auditLogs }: { auditLogs: AuditItem[] }) {
  return (
    <section aria-labelledby="recent-activity-heading">
      <h2
        id="recent-activity-heading"
        className="text-sm font-semibold text-slate-800"
      >
        Hoạt động gần đây
      </h2>
      <div className="mt-4 space-y-3">
        {auditLogs.length === 0 ? (
          <Empty text="Chưa có hoạt động quản trị nào" />
        ) : (
          auditLogs.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {item.actor?.full_name || "Hệ thống"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {actionLabels[item.action] || item.action} ·{" "}
                  {formatDateTime(item.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-400">{text}</p>;
}
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
    </div>
  );
}

function makeDeadlineWarning(
  conference: Conference,
  field:
    | "submission_deadline"
    | "review_deadline"
    | "registration_deadline"
    | "camera_ready_deadline",
  label: string,
): DeadlineWarning | null {
  const date = conference[field];
  const displayStatus = getConferenceDisplayStatus(conference);
  if (!date || ["draft", "cancelled", "completed"].includes(displayStatus))
    return null;
  const remainingMs = new Date(date).getTime() - Date.now();
  if (
    !Number.isFinite(remainingMs) ||
    remainingMs < 0 ||
    remainingMs > 14 * 86_400_000
  )
    return null;
  const days = Math.ceil(remainingMs / 86_400_000);
  return {
    id: `${conference.id}-${field}`,
    title: conference.title,
    label,
    date,
    days,
    category: field === "registration_deadline" ? "conference" : "paper",
  };
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("vi-VN");
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN");
}
