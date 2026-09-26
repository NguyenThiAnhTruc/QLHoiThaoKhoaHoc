import { useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  FileText,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "@/context/useRouter";
import { supabase } from "@/lib/supabase";
import { exportExcel } from "@/lib/exportExcel";
import {
  CONFERENCE_STATUS_COLORS,
  CONFERENCE_STATUS_LABELS,
  getConferenceDisplayStatus,
  PAPER_STATUS_COLORS,
  PAPER_STATUS_LABELS,
} from "@/lib/constants";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, Paper, Participant } from "@/types";

export function AdminManagementTable({
  kind,
  conferences,
  papers,
  participants,
  onChanged,
  onEdit,
}: {
  kind: "conferences" | "papers";
  conferences: Conference[];
  papers: Paper[];
  participants: Participant[];
  onChanged: () => void;
  onEdit: (id: string) => void;
}) {
  const { navigate } = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const isConference = kind === "conferences";
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    participants.forEach((p) =>
      result.set(p.conference_id, (result.get(p.conference_id) || 0) + 1),
    );
    return result;
  }, [participants]);
  const rows = (
    isConference
      ? conferences.map((c) => ({
          id: c.id,
          title: c.title,
          subtitle: c.location || "Hội thảo khoa học",
          date: c.start_date,
          status: getConferenceDisplayStatus(c),
          label: CONFERENCE_STATUS_LABELS[getConferenceDisplayStatus(c)],
          color: CONFERENCE_STATUS_COLORS[getConferenceDisplayStatus(c)],
          image: c.cover_image_url,
          count: counts.get(c.id) || 0,
          capacity: c.max_participants,
        }))
      : papers.map((p) => ({
          id: p.id,
          title: p.title,
          subtitle: p.conference?.title || "Chưa xác định hội thảo",
          date: p.created_at,
          status: p.status,
          label: PAPER_STATUS_LABELS[p.status],
          color: PAPER_STATUS_COLORS[p.status],
          image: "",
          count: p.current_version,
          capacity: 0,
        }))
  ).filter(
    (row) =>
      (!status || row.status === status) &&
      `${row.title} ${row.subtitle}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice((currentPage - 1) * 10, currentPage * 10);
  const labels = isConference ? CONFERENCE_STATUS_LABELS : PAPER_STATUS_LABELS;
  const dateLabel = (value: string) =>
    new Date(
      value.length === 10 ? `${value}T00:00:00` : value,
    ).toLocaleDateString("vi-VN");
  async function remove() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from(kind)
        .delete()
        .eq("id", pending.id)
        .select("id")
        .single();
      if (error) throw error;
      showToast("success", isConference ? "Đã xóa hội thảo" : "Đã xóa bài báo");
      setPending(null);
      onChanged();
    } catch (error) {
      showToast(
        "error",
        `Xóa thất bại: ${(error as { message?: string }).message || "Vui lòng thử lại"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    exportExcel(
      isConference ? "danh-sach-hoi-thao" : "danh-sach-bai-bao",
      [
        isConference ? "Hội thảo" : "Bài báo",
        isConference ? "Địa điểm" : "Hội thảo",
        "Ngày",
        isConference ? "Đăng ký" : "Phiên bản",
        ...(isConference ? ["Sức chứa (0 = không giới hạn)"] : []),
        "Trạng thái",
      ],
      rows.map((row) => [
        row.title,
        row.subtitle,
        dateLabel(row.date),
        row.count,
        ...(isConference ? [row.capacity] : []),
        row.label,
      ]),
    );
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">
          {isConference ? "Danh sách hội thảo" : "Danh sách bài báo"}
        </h2>
        <Button
          className="bg-green-600 hover:bg-green-700"
          size="sm"
          disabled={!rows.length}
          onClick={download}
        >
          <Download className="h-4 w-4" />
          Xuất Excel
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            aria-label="Tìm kiếm danh sách"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            placeholder={
              isConference
                ? "Tìm hội thảo, địa điểm..."
                : "Tìm bài báo, hội thảo..."
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Lọc trạng thái"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-slate-600">
              <th className="p-3 font-semibold">
                {isConference ? "Hội thảo" : "Bài báo"}
              </th>
              <th className="p-3 font-semibold">
                {isConference ? "Ngày bắt đầu" : "Ngày nộp"}
              </th>
              <th className="p-3 font-semibold">
                {isConference ? "Đăng ký" : "Phiên bản"}
              </th>
              <th className="p-3 font-semibold">Trạng thái</th>
              <th className="p-3 font-semibold">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="p-3">
                  <button
                    className="flex max-w-md items-center gap-3 text-left"
                    onClick={() =>
                      navigate(
                        isConference ? "conference-detail" : "paper-detail",
                        { id: row.id },
                      )
                    }
                  >
                    <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                      {row.image ? (
                        <img
                          src={row.image}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : isConference ? (
                        <CalendarDays className="h-5 w-5 text-teal-600" />
                      ) : (
                        <FileText className="h-5 w-5 text-blue-500" />
                      )}
                    </span>
                    <span>
                      <span className="line-clamp-2 font-semibold text-slate-800 hover:text-teal-600">
                        {row.title}
                      </span>
                      <span className="mt-1 line-clamp-1 text-xs text-slate-500">
                        {row.subtitle}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="whitespace-nowrap p-3 text-xs text-slate-500">
                  {dateLabel(row.date)}
                </td>
                <td className="p-3 text-xs text-slate-700">
                  {isConference ? (
                    <>
                      <span>
                        {row.count}/
                        {row.capacity > 0 ? row.capacity : "Không giới hạn"}
                      </span>
                      {row.capacity > 0 && (
                        <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full bg-indigo-400"
                            style={{
                              width: `${Math.min(100, (row.count / row.capacity) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    `v${row.count}`
                  )}
                </td>
                <td className="p-3">
                  <Badge className={row.color}>{row.label}</Badge>
                </td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button
                      aria-label={`Sửa ${row.title}`}
                      title="Chỉnh sửa"
                      className="rounded p-2 text-blue-500 hover:bg-blue-50"
                      onClick={() => onEdit(row.id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`Xóa ${row.title}`}
                      title="Xóa"
                      disabled={busy}
                      className="rounded p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                      onClick={() => setPending(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="py-12 text-center text-sm text-slate-500">
            Không có dữ liệu phù hợp.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {rows.length} {isConference ? "hội thảo" : "bài báo"} · Trang{" "}
          {currentPage}/{pages}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Trước
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Tiếp
          </Button>
        </div>
      </div>
      <Modal
        open={!!pending}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title={isConference ? "Xóa hội thảo" : "Xóa bài báo"}
      >
        <p className="text-sm text-slate-600">
          Bạn có chắc muốn xóa “{pending?.title}”? Dữ liệu liên quan cũng có thể
          bị xóa. Thao tác này không thể hoàn tác.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Hủy
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Đang xóa..." : "Xác nhận xóa"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
