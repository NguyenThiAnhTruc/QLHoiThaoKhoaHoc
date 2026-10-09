import { useEffect, useRef, useState } from "react";
import {
  Users,
  Search,
  Check,
  X,
  Download,
  Eye,
  Camera,
  QrCode,
} from "lucide-react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from "@/context/useConferenceAccess";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import { ROLE_LABELS } from "@/lib/constants";
import type { Conference, Participant } from "@/types";

export function ParticipantsPage() {
  const { profile } = useAuth();
  const { canManage, conferences: managedConferences } = useConferenceAccess();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState("all");
  const [attendanceFilter, setAttendanceFilter] = useState<
    "all" | "attended" | "pending"
  >("all");
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrParticipant, setQrParticipant] = useState<Participant | null>(null);
  const [attendanceCode, setAttendanceCode] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [detailParticipant, setDetailParticipant] =
    useState<Participant | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | null>(null);
  const checkInHandler = useRef<(value?: string) => Promise<void>>();

  const canEdit = managedConferences.length > 0;

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const reader = new BrowserQRCodeReader();
    let cancelled = false;
    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, error, controls) => {
          if (cancelled) return;
          scannerControls.current = controls;
          if (!result) return;
          const scannedCode = result.getText();
          setAttendanceCode(scannedCode);
          setScannerOpen(false);
          void checkInHandler.current?.(scannedCode);
        },
      )
      .catch(() => {
        if (!cancelled)
          showToast("error", "Không thể truy cập camera để quét QR");
      });
    return () => {
      cancelled = true;
      scannerControls.current?.stop();
      scannerControls.current = null;
    };
  }, [scannerOpen]);

  useEffect(() => {
    load();
    (async () => {
      const { data } = await supabase
        .from("conferences")
        .select("*")
        .order("title");
      if (data) setConferences(data as unknown as Conference[]);
    })();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("participants")
      .select("*, user:profile_directory!participants_user_id_fkey(*), conference:conferences(*)")
      .order("registered_at", { ascending: false });
    if (error) {
      showToast("error", "Không thể tải danh sách người tham dự");
    } else {
      const rows = (data ?? []) as unknown as Participant[];
      const actorIds = [
        ...new Set(rows.map((participant) => participant.checked_in_by).filter(Boolean)),
      ];
      const { data: actors } = actorIds.length
        ? await supabase.from("profile_directory").select("id, full_name").in("id", actorIds)
        : { data: [] };
      const actorNames = new Map((actors ?? []).map((actor) => [actor.id, actor.full_name]));
      setParticipants(rows.map((participant) => ({
        ...participant,
        checked_in_by_name: participant.checked_in_by
          ? actorNames.get(participant.checked_in_by) ?? participant.checked_in_by
          : undefined,
      })));
    }
    setLoading(false);
  }

  async function handleToggleAttendance(part: Participant) {
    if (!canManage(part.conference_id)) return;
    setUpdatingId(part.id);
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
    setUpdatingId(null);
  }

  async function handleCheckInByCode(value = attendanceCode) {
    const code = value.trim();
    if (!code) {
      showToast("error", "Vui lòng nhập mã điểm danh");
      return;
    }
    if (confFilter === "all") {
      showToast("error", "Vui lòng chọn hội thảo trước khi điểm danh");
      return;
    }

    setCheckingIn(true);
    const { data, error } = await supabase
      .from("participants")
      .select("*, user:profile_directory!participants_user_id_fkey(*), conference:conferences(*)")
      .eq("attendance_code", code)
      .eq("conference_id", confFilter)
      .maybeSingle();

    if (error || !data) {
      showToast(
        "error",
        "Không tìm thấy mã đăng ký hoặc mã không thuộc hội thảo này",
      );
      setCheckingIn(false);
      return;
    }

    const participant = data as unknown as Participant;
    if (!canManage(participant.conference_id)) {
      showToast("error", "Bạn không có quyền điểm danh hội thảo này");
      setCheckingIn(false);
      return;
    }
    if (participant.attended) {
      showToast("info", "Người tham dự này đã được điểm danh");
      setAttendanceCode("");
      setCheckingIn(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("participants")
      .update({
        attended: true,
        checked_in_at: new Date().toISOString(),
        checked_in_by: profile?.id ?? null,
      })
      .eq("id", participant.id);

    if (updateError) {
      showToast("error", "Điểm danh thất bại: " + updateError.message);
    } else {
      showToast(
        "success",
        `Điểm danh thành công: ${participant.user?.full_name ?? "người tham dự"} · ${participant.conference?.title ?? "Hội thảo"} · ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`,
      );
      setAttendanceCode("");
      load();
    }
    setCheckingIn(false);
  }

  checkInHandler.current = handleCheckInByCode;

  function exportCSV() {
    const rows = filtered.map((p) => [
      p.user?.full_name ?? "",
      p.user?.email ?? "",
      p.attendance_code,
      p.user?.role ? ROLE_LABELS[p.user.role] : "",
      p.conference?.title ?? "",
      p.attended ? "Đã điểm danh" : "Chưa điểm danh",
      new Date(p.registered_at).toLocaleDateString("vi-VN"),
      p.checked_in_at ? new Date(p.checked_in_at).toLocaleString("vi-VN") : "",
    ]);
    const csv = [
      [
        "Họ tên",
        "Email",
        "Mã đăng ký",
        "Vai trò",
        "Hội thảo",
        "Điểm danh",
        "Ngày đăng ký",
        "Thời gian điểm danh",
      ],
      ...rows,
    ]
      .map((row) => row.map(escapeCSVCell).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "danh-sach-tham-du.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = participants.filter((p) => {
    const matchesSearch =
      !search ||
      [p.user?.full_name, p.user?.email, p.attendance_code].some((value) =>
        (value ?? "").toLowerCase().includes(search.toLowerCase()),
      );
    const matchesConf = confFilter === "all" || p.conference_id === confFilter;
    const matchesAttendance =
      attendanceFilter === "all" ||
      (attendanceFilter === "attended" ? p.attended : !p.attended);
    return matchesSearch && matchesConf && matchesAttendance;
  });

  const attendedCount = filtered.filter((p) => p.attended).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Người tham dự</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý đăng ký và điểm danh
          </p>
        </div>
        <Button variant="outline" onClick={exportCSV}>
          <Download className="h-4 w-4" /> Xuất CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-slate-500">Tổng đăng ký</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {filtered.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">Đã điểm danh</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {attendedCount}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-500">Chưa điểm danh</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">
            {filtered.length - attendedCount}
          </p>
        </Card>
      </div>

      {canEdit && (
        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <Input
              label="Điểm danh bằng mã"
              value={attendanceCode}
              onChange={(e) => setAttendanceCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCheckInByCode();
              }}
              placeholder="Nhập mã đăng ký/QR"
            />
            <Button
              onClick={() => void handleCheckInByCode()}
              disabled={checkingIn}
            >
              <Check className="h-4 w-4" />
              {checkingIn ? "Đang điểm danh..." : "Điểm danh"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setScannerOpen(true)}
              disabled={checkingIn}
            >
              <Camera className="h-4 w-4" /> Quét QR bằng camera
            </Button>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo tên..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <Select
          value={confFilter}
          onChange={(e) => setConfFilter(e.target.value)}
          className="sm:w-64"
        >
          <option value="all">Tất cả hội thảo</option>
          {conferences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        <Select
          value={attendanceFilter}
          onChange={(e) =>
            setAttendanceFilter(e.target.value as typeof attendanceFilter)
          }
          className="sm:w-52"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="attended">Đã điểm danh</option>
          <option value="pending">Chưa điểm danh</option>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Chưa có người tham dự nào</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Họ tên</th>
                  <th className="px-4 py-3 font-medium">Email / Mã đăng ký</th>
                  <th className="px-4 py-3 font-medium">Hội thảo</th>
                  <th className="px-4 py-3 font-medium">Ngày đăng ký</th>
                  <th className="px-4 py-3 font-medium">Trạng thái</th>
                  <th className="px-4 py-3 font-medium">Thời gian điểm danh</th>
                  <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((part) => (
                  <tr key={part.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {part.user?.full_name?.charAt(0).toUpperCase() ?? "?"}
                        </div>
                        <span className="font-medium text-slate-900">
                          {part.user?.full_name ?? "N/A"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <div>{part.user?.email ?? "Không có email"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {part.conference?.title ?? "N/A"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(part.registered_at).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          part.attended
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }
                      >
                        {part.attended ? "Đã điểm danh" : "Chưa điểm danh"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {part.checked_in_at
                        ? new Date(part.checked_in_at).toLocaleString("vi-VN")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => { setQrParticipant(part); setQrModalOpen(true); }} title="Xem mã điểm danh" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><QrCode className="h-4 w-4" /></button>
                        <button
                          onClick={() => setDetailParticipant(part)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="Xem chi tiết"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {canManage(part.conference_id) && (
                          <button
                            onClick={() => handleToggleAttendance(part)}
                            disabled={updatingId === part.id}
                            className={`rounded-lg p-1.5 transition-colors ${
                              part.attended
                                ? "text-emerald-600 hover:bg-emerald-50"
                                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            }`}
                            title={part.attended ? "Bỏ điểm danh" : "Điểm danh"}
                          >
                            {part.attended ? (
                              <X className="h-4 w-4" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* QR Modal */}
      <Modal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Quét mã QR điểm danh"
        size="sm"
      >
        <div className="space-y-3">
          <video
            ref={videoRef}
            className="aspect-square w-full rounded-lg bg-slate-900 object-cover"
            muted
            playsInline
          />
          <p className="text-center text-sm text-slate-500">
            Đưa mã QR vào giữa khung hình.
          </p>
        </div>
      </Modal>
      <Modal
        open={!!detailParticipant}
        onClose={() => setDetailParticipant(null)}
        title="Chi tiết đăng ký"
        size="sm"
      >
        {detailParticipant && (
          <dl className="space-y-3 text-sm">
            <DetailRow
              label="Người tham dự"
              value={detailParticipant.user?.full_name ?? "N/A"}
            />
            <DetailRow
              label="Email"
              value={detailParticipant.user?.email ?? "N/A"}
            />
            <DetailRow
              label="Hội thảo"
              value={detailParticipant.conference?.title ?? "N/A"}
            />
            <DetailRow
              label="Mã đăng ký"
              value={detailParticipant.attendance_code}
            />
            <DetailRow
              label="Ngày đăng ký"
              value={new Date(detailParticipant.registered_at).toLocaleString(
                "vi-VN",
              )}
            />
            <DetailRow
              label="Trạng thái"
              value={
                detailParticipant.attended ? "Đã điểm danh" : "Chưa điểm danh"
              }
            />
            <DetailRow
              label="Thời gian điểm danh"
              value={
                detailParticipant.checked_in_at
                  ? new Date(detailParticipant.checked_in_at).toLocaleString(
                      "vi-VN",
                    )
                  : "Chưa điểm danh"
              }
            />
            <DetailRow
              label="Người thực hiện"
              value={detailParticipant.checked_in_by_name ?? detailParticipant.checked_in_by ?? "Chưa điểm danh"}
            />
          </dl>
        )}
      </Modal>
      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="Mã điểm danh"
        size="sm"
      >
        <div className="flex flex-col items-center py-4">
          {qrParticipant && (
            <>
              <p className="mb-3 text-center font-medium text-slate-900">
                {qrParticipant.user?.full_name}
              </p>
              <p className="mb-4 text-sm text-slate-500">
                {qrParticipant.conference?.title}
              </p>
              <div className="rounded-xl border-2 border-slate-200 bg-white p-6">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrParticipant.attendance_code)}`}
                  alt="QR Code"
                  className="h-48 w-48"
                />
              </div>
              <p className="mt-4 font-mono text-xs text-slate-400">
                {qrParticipant.attendance_code}
              </p>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function escapeCSVCell(value: string) {
  const text = value.replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
