import { DateInput } from "@/components/ui/DateInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { TransferConferenceOwner } from "@/components/TransferConferenceOwner";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Users,
  Clock,
  UserPlus,
  QrCode,
  FileText,
  CalendarClock as ScheduleIcon,
  Trash2,
  Check,
  X,
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
import { exportExcel } from "@/lib/exportExcel";
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
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [myRegistration, setMyRegistration] = useState<Participant | null>(
    null,
  );
  const [attendanceSession, setAttendanceSession] = useState<{
    code: string;
    starts_at: string;
    ends_at: string;
  } | null>(null);
  const [attendanceStartsAt, setAttendanceStartsAt] = useState("");
  const [attendanceEndsAt, setAttendanceEndsAt] = useState("");
  const [savingAttendanceSession, setSavingAttendanceSession] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffCandidates, setStaffCandidates] = useState<Profile[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [savingStaff, setSavingStaff] = useState(false);
  const [selfCheckinCode, setSelfCheckinCode] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scannerVideoRef = useRef<HTMLVideoElement>(null);
  const [attendanceCertificate, setAttendanceCertificate] = useState<{
    id: string;
  } | null>(null);
  const [attendanceFilter, setAttendanceFilter] = useState<
    "all" | "attended" | "pending"
  >("all");

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

    const { data: attendance } = await supabase
      .from("attendance_sessions")
      .select("code, starts_at, ends_at")
      .eq("conference_id", conferenceId)
      .maybeSingle();
    setAttendanceSession(attendance);
    if (attendance) {
      setAttendanceStartsAt(toDateTimeInput(attendance.starts_at));
      setAttendanceEndsAt(toDateTimeInput(attendance.ends_at));
    }

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
      setMyRegistration(myReg as unknown as Participant | null);
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
      setMyRegistration(null);
    }

    setLoading(false);
  }, [conferenceId, profileId]);

  async function saveAttendanceSession() {
    if (!attendanceStartsAt || !attendanceEndsAt || savingAttendanceSession)
      return;
    setSavingAttendanceSession(true);
    const { data, error } = await supabase.rpc("create_attendance_session", {
      target_conference_id: conferenceId,
      session_starts_at: new Date(attendanceStartsAt).toISOString(),
      session_ends_at: new Date(attendanceEndsAt).toISOString(),
    });
    setSavingAttendanceSession(false);
    if (error) {
      showToast("error", error.message);
      return;
    }
    setAttendanceSession(
      data as { code: string; starts_at: string; ends_at: string },
    );
    showToast("success", "Đã lưu phiên điểm danh");
  }

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

  async function handleSelfCheckin(codeOverride?: string) {
    const code = (codeOverride ?? selfCheckinCode).trim();
    if (!code || checkingIn) return;
    setCheckingIn(true);
    const { error } = await supabase.rpc("check_in_self", {
      attendance_code_input: code,
    });
    setCheckingIn(false);
    if (error) {
      showToast("error", error.message);
      return;
    }
    showToast("success", "Điểm danh thành công");
    setQrModalOpen(false);
    setSelfCheckinCode("");
    load();
  }

  const selfCheckinHandler = useRef(handleSelfCheckin);
  selfCheckinHandler.current = handleSelfCheckin;

  useEffect(() => {
    if (!scannerOpen || !scannerVideoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;
    void reader
      .decodeFromVideoDevice(undefined, scannerVideoRef.current, (result) => {
        if (!result) return;
        setSelfCheckinCode(result.getText());
        setScannerOpen(false);
        void selfCheckinHandler.current(result.getText());
      })
      .then((value) => {
        controls = value;
      })
      .catch(() => showToast("error", "Không thể mở camera để quét QR"));
    return () => controls?.stop();
  }, [scannerOpen]);

  async function handleToggleAttendance(part: Participant) {
    const { error } = await supabase
      .from("participants")
      .update({
        attended: !part.attended,
        checked_in_at: !part.attended ? new Date().toISOString() : null,
        checked_in_by: !part.attended ? (profile?.id ?? null) : null,
      })
      .eq("id", part.id);
    if (error) {
      showToast("error", "Cập nhật điểm danh thất bại");
    } else {
      showToast("success", "Đã cập nhật điểm danh");
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
  const checkinOpen =
    !!attendanceSession &&
    new Date() >= new Date(attendanceSession.starts_at) &&
    new Date() <= new Date(attendanceSession.ends_at);
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
  const filteredParticipants = participants.filter(
    (participant) =>
      attendanceFilter === "all" ||
      (attendanceFilter === "attended"
        ? participant.attended
        : !participant.attended),
  );
  const attendedCount = participants.filter(
    (participant) => participant.attended,
  ).length;
  function exportParticipants() {
    exportExcel(
      `nguoi-tham-du-${conferenceId}`,
      ["Họ tên", "Email", "Vai trò", "Ngày đăng ký", "Trạng thái điểm danh"],
      participants.map((participant) => [
        participant.user?.full_name ?? "Chưa đặt tên",
        participant.user?.email ?? "",
        participant.user ? ROLE_LABELS[participant.user.role] : "",
        new Date(participant.registered_at).toLocaleDateString("vi-VN"),
        participant.attended ? "Đã điểm danh" : "Chưa điểm danh",
      ]),
    );
  }
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
              {checkinOpen && !myRegistration?.attended && (
                <Button onClick={() => setQrModalOpen(true)}>
                  <QrCode className="h-4 w-4" /> Điểm danh
                </Button>
              )}
              {myRegistration?.attended && (
                <span className="rounded-lg bg-teal-500/20 px-4 py-2 text-sm font-semibold text-teal-100">
                  Đã điểm danh
                </span>
              )}
              {eventFinished && attendanceCertificate && (
                <Button onClick={() => navigate("certificates")}>
                  <FileText className="h-4 w-4" /> Xem chứng nhận
                </Button>
              )}
            </div>
          )}
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
              label="Hạn đăng ký"
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
              label="Hạn camera-ready"
              value={formatOptionalDateTime(conference.camera_ready_deadline)}
            />
          </div>
          {canManageStaff && (
            <div className="border-t border-slate-100 pt-5">
              <h4 className="font-semibold text-slate-900">
                Phiên điểm danh QR
              </h4>
              <p className="mt-1 text-sm text-slate-500">
                Mỗi hội thảo có một mã dùng chung trong thời gian phiên.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm text-slate-600">
                  Bắt đầu
                  <DateInput
                    type="datetime-local"
                    value={attendanceStartsAt}
                    onValueChange={setAttendanceStartsAt}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Kết thúc
                  <DateInput
                    type="datetime-local"
                    value={attendanceEndsAt}
                    onValueChange={setAttendanceEndsAt}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <Button
                  className="self-end"
                  disabled={
                    savingAttendanceSession ||
                    !attendanceStartsAt ||
                    !attendanceEndsAt
                  }
                  onClick={() => void saveAttendanceSession()}
                >
                  {savingAttendanceSession ? "Đang lưu..." : "Lưu phiên"}
                </Button>
              </div>
              {attendanceSession && (
                <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg bg-teal-50 p-3">
                  <span className="text-sm text-teal-800">
                    Mã điểm danh:{" "}
                    <strong className="font-mono">
                      {attendanceSession.code}
                    </strong>
                  </span>
                  <img
                    className="h-24 w-24 rounded bg-white p-1"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(attendanceSession.code)}`}
                    alt="QR điểm danh"
                  />
                  <span className="text-xs text-slate-500">
                    {formatConferenceDateTime(attendanceSession.starts_at)} –{" "}
                    {formatConferenceDateTime(attendanceSession.ends_at)}
                  </span>
                </div>
              )}
            </div>
          )}
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

      {activeTab === "sessions" && (
        <div className="space-y-3">
          {sessions.length === 0 ? (
            <Card className="p-8 text-center">
              <ScheduleIcon className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-slate-500">Chưa có phiên báo cáo nào</p>
            </Card>
          ) : (
            sessions.map((session) => (
              <Card key={session.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-medium text-slate-900">
                      {session.title}
                    </h4>
                    {session.description && (
                      <p className="mt-1 text-sm text-slate-500">
                        {session.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(session.start_time).toLocaleString(
                          "vi-VN",
                        )} -{" "}
                        {new Date(session.end_time).toLocaleTimeString("vi-VN")}
                      </span>
                      {session.room && <span>Phòng: {session.room}</span>}
                      {session.speaker && (
                        <span>Diễn giả: {session.speaker.full_name}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "participants" && (
        <div className="space-y-4">
          {canEdit && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Điểm danh</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {attendedCount}/{participants.length} người đã điểm danh
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!participants.length}
                  onClick={exportParticipants}
                >
                  Xuất danh sách
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["all", "Tất cả"],
                    ["attended", "Đã điểm danh"],
                    ["pending", "Chưa điểm danh"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAttendanceFilter(value)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${attendanceFilter === value ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Card>
          )}
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
                {canEdit ? (
                  <button
                    onClick={() => handleToggleAttendance(part)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      part.attended
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {part.attended ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                    {part.attended ? "Đã điểm danh" : "Chưa điểm danh"}
                  </button>
                ) : (
                  <Badge
                    className={
                      part.attended
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-700"
                    }
                  >
                    {part.attended ? "Đã điểm danh" : "Chưa điểm danh"}
                  </Badge>
                )}
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

      {/* QR Code Modal */}
      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="Mã điểm danh của bạn"
        size="sm"
      >
        <div className="flex flex-col items-center py-4">
          {myRegistration && attendanceSession && (
            <>
              <div className="rounded-xl border-2 border-slate-200 bg-white p-6">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(attendanceSession.code)}`}
                  alt="QR Code"
                  className="h-48 w-48"
                />
              </div>
              <p className="mt-4 text-center text-sm text-slate-500">
                Hãy trình mã này cho ban tổ chức khi điểm danh
              </p>
              <p className="mt-2 font-mono text-xs text-slate-400">
                {attendanceSession.code}
              </p>
              {checkinOpen && !myRegistration.attended && (
                <div className="mt-5 w-full border-t pt-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Mã điểm danh
                    <input
                      value={selfCheckinCode}
                      onChange={(event) =>
                        setSelfCheckinCode(event.target.value)
                      }
                      placeholder="Nhập mã do ban tổ chức cung cấp"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <Button
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => setScannerOpen((value) => !value)}
                  >
                    <QrCode className="h-4 w-4" />{" "}
                    {scannerOpen ? "Đóng camera" : "Quét QR bằng camera"}
                  </Button>
                  {scannerOpen && (
                    <video
                      ref={scannerVideoRef}
                      className="mt-3 aspect-video w-full rounded-lg bg-slate-900 object-cover"
                      autoPlay
                      muted
                      playsInline
                    />
                  )}
                  <Button
                    className="mt-3 w-full"
                    disabled={checkingIn || !selfCheckinCode.trim()}
                    onClick={() => void handleSelfCheckin()}
                  >
                    {checkingIn ? "Đang điểm danh..." : "Xác nhận điểm danh"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

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

function toDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatConferenceDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
