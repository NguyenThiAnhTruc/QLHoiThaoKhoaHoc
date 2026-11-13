import { ResourceCenter } from "@/components/ResourceCenter";
import { AgendaView } from "@/components/AgendaView";
import { useCallback, useEffect, useState } from "react";
import { TransferConferenceOwner } from "@/components/TransferConferenceOwner";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Users,
  UserPlus,
  FileText,
  CalendarClock as ScheduleIcon,
  Trash2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { showToast } from "@/components/ui/toastStore";
import {
  CONFERENCE_STATUS_LABELS,
  CONFERENCE_STATUS_COLORS,
  PAPER_STATUS_LABELS,
  PAPER_STATUS_COLORS,
  ROLE_LABELS,
  getConferenceDisplayStatus,
  isConferenceRegistrationOpen,
} from "@/lib/constants";
import type {
  Conference,
  Paper,
  Session,
  Participant,
  ConferenceStaff,
  Profile,
} from "@/types";

export function ConferenceDetailPage() {
  const { route, navigate } = useRouter();
  const { profile } = useAuth();
  const conferenceId = route.params.id;
  const profileId = profile?.id;

  const [conference, setConference] = useState<Conference | null>(null);
  const [papers, setPapers] = useState<
    (Pick<Paper, "id" | "title" | "abstract" | "status"> & {
      can_open: boolean;
    })[]
  >([]);
  const [paperLoadError, setPaperLoadError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [staff, setStaff] = useState<ConferenceStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffCandidates, setStaffCandidates] = useState<Profile[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [savingStaff, setSavingStaff] = useState(false);
  const [attendanceCertificate, setAttendanceCertificate] = useState<{
    id: string;
  } | null>(null);

  const isStaff = staff.some(
    (staffMember) => staffMember.user_id === profile?.id,
  );
  const canEdit =
    profile?.role === "admin" ||
    profile?.id === conference?.organizer_id ||
    isStaff;
  const canManageStaff =
    profile?.role === "admin" || profile?.id === conference?.organizer_id;
  const canRegisterRole =
    profile?.role === "author" ||
    profile?.role === "reviewer";
  const registrationOpen = conference
    ? isConferenceRegistrationOpen(conference)
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    const { data: conf } = await supabase
      .from("conferences")
      .select("*, organizer:profile_directory(*)")
      .eq("id", conferenceId)
      .maybeSingle();
    if (conf) setConference(conf as unknown as Conference);

    const { data: p, error: papersError } = await supabase
      .rpc("conference_paper_catalog", { target_conference_id: conferenceId })
      .order("created_at", { ascending: false });
    if (papersError) {
      setPaperLoadError("Không thể tải danh sách bài báo. Vui lòng thử lại.");
      showToast(
        "error",
        "Không thể tải bài báo của hội thảo: " + papersError.message,
      );
      setPapers([]);
    } else {
      setPaperLoadError("");
      setPapers(p ?? []);
    }

    const { data: s } = await supabase
      .from("sessions")
      .select("*, speaker:profile_directory(*)")
      .eq("conference_id", conferenceId)
      .order("start_time", { ascending: true });
    if (s) setSessions(s as unknown as Session[]);

    const { data: parts } = await supabase
      .from("participants")
      .select("*, user:profile_directory!participants_user_id_fkey(*)")
      .eq("conference_id", conferenceId)
      .order("registered_at", { ascending: false });
    if (parts) setParticipants(parts as unknown as Participant[]);

    const { data: staffRows } = await supabase
      .from("conference_staff")
      .select("*, user:profile_directory!conference_staff_user_id_fkey(*)")
      .eq("conference_id", conferenceId)
      .order("created_at", { ascending: true });
    if (staffRows) setStaff(staffRows as unknown as ConferenceStaff[]);

    if (profileId) {
      const { data: myReg } = await supabase
        .from("participants")
        .select("*")
        .eq("conference_id", conferenceId)
        .eq("user_id", profileId)
        .maybeSingle();
      setIsRegistered(!!myReg);
      if (profileId) {
        const { data: certificate } = await supabase
          .from("certificates")
          .select("id")
          .eq("conference_id", conferenceId)
          .eq("user_id", profileId)
          .eq("certificate_type", "attendance")
          .maybeSingle();
        setAttendanceCertificate(certificate as { id: string } | null);
      }
    } else {
      setIsRegistered(false);
    }

    setLoading(false);
  }, [conferenceId, profileId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || !conference || !profile) return;

    const rawIntent = sessionStorage.getItem("confmanager:pending-intent");
    if (!rawIntent) return;

    try {
      const intent = JSON.parse(rawIntent) as {
        conferenceId?: string;
        action?: "register" | "submit";
      };
      if (intent.conferenceId !== conferenceId || !intent.action) return;
      sessionStorage.removeItem("confmanager:pending-intent");

      if (intent.action === "submit") {
        if (profile.role !== "author") {
          showToast("error", "Chỉ tài khoản tác giả mới có thể nộp bài báo");
          return;
        }
        navigate("paper-form", { conferenceId });
        return;
      }

      if (!canRegisterRole || !registrationOpen) {
        showToast("error", "Hội thảo hiện không mở đăng ký tham dự");
        return;
      }

      void (async () => {
        const { error } = await supabase
          .from("participants")
          .insert({ conference_id: conferenceId, user_id: profile.id });
        if (error) {
          showToast("error", "Đăng ký tham dự thất bại: " + error.message);
          return;
        }
        showToast("success", "Đăng ký tham dự thành công");
        load();
      })();
    } catch {
      sessionStorage.removeItem("confmanager:pending-intent");
    }
  }, [
    canRegisterRole,
    conference,
    conferenceId,
    load,
    loading,
    navigate,
    profile,
    registrationOpen,
  ]);

  async function handleRegister() {
    if (!profile || !conference) return;
    const displayStatus = getConferenceDisplayStatus(conference);
    if (displayStatus !== "open" || !registrationOpen) {
      showToast("error", "Hội thảo hiện không mở đăng ký");
      return;
    }
    if (
      conference.max_participants > 0 &&
      participants.length >= conference.max_participants
    ) {
      showToast("error", "Hội thảo đã đủ số lượng người tham dự");
      return;
    }
    const { data: allowed, error: eligibilityError } = await supabase.rpc("can_register_for_conference", { conf_id: conferenceId });
    if (eligibilityError || !allowed) {
      showToast("error", conference.require_accepted_paper && profile.role === "author"
        ? "Cần có bài báo được chấp nhận và hội thảo còn mở đăng ký."
        : "Hội thảo không còn nhận đăng ký hoặc đã đủ số lượng.");
      return;
    }
    const { error } = await supabase
      .from("participants")
      .insert({ conference_id: conferenceId, user_id: profile.id });
    if (error) {
      showToast("error", "Đăng ký thất bại: " + error.message);
    } else {
      showToast("success", "Đăng ký tham dự thành công");
      load();
    }
  }

  async function handleUnregister() {
    if (!profile) return;
    if (conference && new Date() >= new Date(conference.start_date)) {
      showToast("error", "Không thể hủy đăng ký sau khi hội thảo đã bắt đầu");
      return;
    }
    const { error } = await supabase
      .from("participants")
      .delete()
      .eq("conference_id", conferenceId)
      .eq("user_id", profile.id);
    if (error) {
      showToast("error", "Hủy đăng ký thất bại");
    } else {
      showToast("success", "Đã hủy đăng ký tham dự");
      load();
    }
  }

  async function openStaffModal() {
    const { data, error } = await supabase
      .from("profile_directory")
      .select("*")
      .order("full_name");
    if (error) {
      showToast("error", "Không thể tải danh sách tài khoản");
      return;
    }
    setStaffCandidates((data ?? []) as unknown as Profile[]);
    setSelectedStaffId("");
    setCandidateSearch("");
    setStaffModalOpen(true);
  }

  async function handleAddStaff() {
    if (!selectedStaffId) {
      showToast("error", "Vui lòng chọn tài khoản staff");
      return;
    }
    setSavingStaff(true);
    const { error } = await supabase.from("conference_staff").insert({
      conference_id: conferenceId,
      user_id: selectedStaffId,
      role: "staff",
    });
    setSavingStaff(false);
    if (error) {
      showToast(
        "error",
        error.code === "23505"
          ? "Tài khoản này đã là staff của hội thảo"
          : "Thêm staff thất bại: " + error.message,
      );
      return;
    }
    showToast("success", "Đã thêm staff cho hội thảo");
    setStaffModalOpen(false);
    load();
  }

  async function handleRemoveStaff(staffMember: ConferenceStaff) {
    if (
      !confirm(
        `Gỡ ${staffMember.user?.full_name ?? "tài khoản này"} khỏi ban tổ chức?`,
      )
    ) {
      return;
    }
    const { error } = await supabase
      .from("conference_staff")
      .delete()
      .eq("id", staffMember.id);
    if (error) {
      showToast("error", "Gỡ staff thất bại: " + error.message);
      return;
    }
    showToast("success", "Đã gỡ staff khỏi hội thảo");
    load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  if (!conference) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Không tìm thấy hội thảo</p>
        <Button className="mt-4" onClick={() => navigate("conferences")}>
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  const eventStarted = new Date() >= new Date(conference.start_date);
  const eventFinished = new Date() > new Date(conference.end_date);
  const canCancelRegistration = !eventStarted && Boolean(registrationOpen);

  const tabs = [
    {
      key: "info",
      label: "Thông tin",
      icon: <CalendarDays className="h-4 w-4" />,
    },
    {
      key: "papers",
      label: paperLoadError
        ? "Bài báo (lỗi tải)"
        : `Bài báo (${papers.length})`,
      icon: <FileText className="h-4 w-4" />,
    },
    {
      key: "sessions",
      label: `Lịch trình (${sessions.length})`,
      icon: <ScheduleIcon className="h-4 w-4" />,
    },
    {key:"resources",label:"Tài liệu",icon:<FileText className="h-4 w-4"/>},
    {
      key: "participants",
      label: `Người tham dự (${participants.length})`,
      icon: <Users className="h-4 w-4" />,
    },
    ...(canManageStaff
      ? [
          {
            key: "staff",
            label: `Ban tổ chức (${staff.length + 1})`,
            icon: <Users className="h-4 w-4" />,
          },
        ]
      : []),
  ];
  const filteredStaff = staff.filter((staffMember) => {
    const query = staffSearch.trim().toLowerCase();
    return (
      !query ||
      staffMember.user?.full_name.toLowerCase().includes(query) ||
      staffMember.user?.organization.toLowerCase().includes(query)
    );
  });
  const availableStaffCandidates = staffCandidates.filter((candidate) => {
    const query = candidateSearch.trim().toLowerCase();
    return (
      candidate.id !== conference.organizer_id &&
      !staff.some((staffMember) => staffMember.user_id === candidate.id) &&
      (!query ||
        candidate.full_name.toLowerCase().includes(query) ||
        candidate.organization.toLowerCase().includes(query))
    );
  });
  const filteredParticipants = participants;
  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("conferences")}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách
      </button>

      {/* Header */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-teal-900 p-6 lg:p-8">
        {conference.cover_image_url && (
          <img
            src={conference.cover_image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-20"
          />
        )}
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1">
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
              <h1 className="mt-3 text-2xl font-bold text-white lg:text-3xl">
                {conference.title}
              </h1>
              <p className="mt-2 text-slate-300 line-clamp-2">
                {conference.description}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                {profile?.role === "admin" && (
                  <TransferConferenceOwner
                    conferenceId={conferenceId}
                    ownerId={conference.organizer_id}
                    onTransferred={() => void load()}
                  />
                )}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-5 text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-teal-400" />
              {formatConferenceDateTime(conference.start_date)} -{" "}
              {formatConferenceDateTime(conference.end_date)}
            </span>
            {conference.location && (
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-teal-400" />
                {conference.location}
              </span>
            )}
            {conference.max_participants > 0 && (
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-teal-400" />
                Tối đa {conference.max_participants} người
              </span>
            )}
            {conference.organizer && (
              <span className="flex items-center gap-2">
                <span className="text-teal-400">Ban tổ chức:</span>
                {conference.organizer.full_name}
              </span>
            )}
          </div>

          {!profile && (
            <Button onClick={() => window.location.reload()}>
              Đăng nhập để đăng ký
            </Button>
          )}
          {profile && canRegisterRole && isRegistered && (
            <div className="mt-5 flex gap-3">
              <span className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100">
                Đã đăng ký
              </span>
              {canCancelRegistration && (
                <Button
                  variant="outline"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                  onClick={handleUnregister}
                >
                  Hủy đăng ký
                </Button>
              )}
              {eventFinished && attendanceCertificate && (
                <Button onClick={() => navigate("certificates")}>
                  <FileText className="h-4 w-4" /> Xem chứng nhận
                </Button>
              )}
            </div>
          )}
          {conference.require_accepted_paper && profile?.role === "author" && !isRegistered && <p className="mt-4 text-sm text-amber-200">Tác giả cần có bài được chấp nhận trước khi đăng ký tham dự.</p>}
          {profile && canRegisterRole && !isRegistered && registrationOpen && (
            <Button onClick={handleRegister}>
              <UserPlus className="h-4 w-4" /> Đăng ký tham gia
            </Button>
          )}
          {profile && canRegisterRole && !isRegistered && !registrationOpen && (
            <p className="mt-5 text-sm text-amber-200">Đã đóng đăng ký</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "info" && (
        <Card className="p-6">
          <h3 className="font-semibold text-slate-900 mb-3">Mô tả chi tiết</h3>
          <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">
            {conference.description || "Chưa có mô tả"}
          </p>
          <div className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem
              label="Hình thức"
              value={formatEventFormat(conference.event_format)}
            />
            <DetailItem
              label="Lĩnh vực"
              value={conference.field || "Chưa cập nhật"}
            />
            <DetailItem
              label="Chủ đề"
              value={conference.topics?.join(", ") || "Chưa cập nhật"}
            />
            <DetailItem
              label="Thời hạn kết thúc đăng ký"
              value={formatOptionalDateTime(conference.registration_deadline)}
            />
            <DetailItem
              label="Hạn nộp bài"
              value={formatOptionalDateTime(conference.submission_deadline)}
            />
            <DetailItem
              label="Hạn phản biện"
              value={formatOptionalDateTime(conference.review_deadline)}
            />
            <DetailItem
              label="Hạn nộp bản hoàn thiện"
              value={formatOptionalDateTime(conference.camera_ready_deadline)}
            />
          </div>
        </Card>
      )}

      {activeTab === "papers" && (
        <div className="space-y-3">
          {paperLoadError ? (
            <Card className="p-8 text-center">
              <p role="alert" className="mb-3 text-rose-700">
                {paperLoadError}
              </p>
              <Button variant="outline" onClick={() => void load()}>
                Thử lại
              </Button>
            </Card>
          ) : papers.length === 0 ? (
            <Card className="p-8 text-center">
              <FileText className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-slate-500">
                Chưa có bài báo nào được nộp
              </p>
            </Card>
          ) : (
            papers.map((paper) => (
              <Card key={paper.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-slate-900">
                      {paper.title}
                    </h4>
                    <p className="mt-1 text-sm text-slate-500 line-clamp-1">
                      {paper.abstract}
                    </p>
                    {paper.can_open ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() =>
                          navigate("paper-detail", { id: paper.id })
                        }
                      >
                        Xem chi tiết
                      </Button>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        Nội dung chi tiết chưa được công bố.
                      </p>
                    )}
                  </div>
                  <Badge className={PAPER_STATUS_COLORS[paper.status]}>
                    {PAPER_STATUS_LABELS[paper.status]}
                  </Badge>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "sessions" && <AgendaView sessions={sessions} />}
      {activeTab === "resources" && <ResourceCenter conferenceId={conferenceId} />}

      {activeTab === "participants" && (
        <div className="space-y-4">
          {filteredParticipants.length === 0 ? (
            <Card className="p-8 text-center">
              <Users className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-slate-500">
                Không có người tham dự phù hợp
              </p>
            </Card>
          ) : (
            filteredParticipants.map((part) => (
              <Card
                key={part.id}
                className="flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {part.user?.full_name?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      {part.user?.full_name ?? "N/A"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {part.user ? ROLE_LABELS[part.user.role] : ""} • Đăng ký:{" "}
                      {new Date(part.registered_at).toLocaleDateString("vi-VN")}
                    </p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "staff" && canManageStaff && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Ban tổ chức</h3>
              <p className="mt-1 text-sm text-slate-500">
                {staff.length} staff đang hỗ trợ vận hành hội thảo này.
              </p>
            </div>
            <Button onClick={openStaffModal}>
              <UserPlus className="h-4 w-4" /> Thêm staff
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase text-slate-500">
                Chủ hội thảo
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">1</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase text-slate-500">
                Staff
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {staff.length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase text-slate-500">
                Quyền quản lý
              </p>
              <p className="mt-1 text-sm font-medium text-teal-700">
                Nội dung hội thảo
              </p>
            </Card>
          </div>

          <Card className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
              {conference.organizer?.full_name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div>
              <p className="font-medium text-slate-900">
                {conference.organizer?.full_name ?? "Chủ hội thảo"}
              </p>
              <p className="flex items-center gap-1 text-xs text-teal-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Chủ hội thảo
              </p>
            </div>
          </Card>

          {staff.length > 0 && (
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={staffSearch}
                onChange={(event) => setStaffSearch(event.target.value)}
                placeholder="Tìm staff theo tên hoặc đơn vị..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
          )}

          {staff.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-500">
              Chưa có staff nào được thêm vào hội thảo này.
            </Card>
          ) : filteredStaff.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-500">
              Không tìm thấy staff phù hợp.
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredStaff.map((staffMember) => (
                <Card
                  key={staffMember.id}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                      {staffMember.user?.full_name?.charAt(0).toUpperCase() ??
                        "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {staffMember.user?.full_name ?? "Chưa đặt tên"}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {staffMember.user?.organization ||
                          "Chưa cập nhật đơn vị"}
                      </p>
                      <p className="mt-1 text-xs font-medium text-teal-700">
                        Staff quản lý hội thảo
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveStaff(staffMember)}
                    className="rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-700"
                    aria-label="Gỡ staff"
                    title="Gỡ staff"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        title="Thêm staff hội thảo"
        size="md"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={candidateSearch}
              onChange={(event) => setCandidateSearch(event.target.value)}
              placeholder="Tìm tài khoản theo tên hoặc đơn vị..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Chọn tài khoản
            <select
              value={selectedStaffId}
              onChange={(event) => setSelectedStaffId(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">Chọn tài khoản</option>
              {availableStaffCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.full_name || "Chưa đặt tên"}
                  {candidate.organization ? ` - ${candidate.organization}` : ""}
                </option>
              ))}
            </select>
          </label>
          {availableStaffCandidates.length === 0 && (
            <p className="text-sm text-slate-500">
              Không còn tài khoản phù hợp để thêm vào ban tổ chức.
            </p>
          )}
          <div className="rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Staff có thể quản lý bài báo, lịch trình, người tham dự và chứng
            nhận của hội thảo này. Quyền chuyển chủ hội thảo chỉ dành cho admin.
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setStaffModalOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleAddStaff} disabled={savingStaff}>
              {savingStaff ? "Đang thêm..." : "Thêm staff"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function formatOptionalDateTime(value?: string | null) {
  return value ? formatConferenceDateTime(value) : "Chưa đặt";
}

function formatEventFormat(value?: string | null) {
  return value === "online"
    ? "Trực tuyến"
    : value === "hybrid"
      ? "Kết hợp"
      : "Trực tiếp";
}

function formatConferenceDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
