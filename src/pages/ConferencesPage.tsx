import { useEffect, useState } from "react";
import { Plus, Search, CalendarDays, MapPin, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/toastStore";
import {
  CONFERENCE_STATUS_LABELS,
  CONFERENCE_STATUS_COLORS,
  ALL_CONFERENCE_STATUSES,
  getConferenceDisplayStatus,
} from "@/lib/constants";
import type { Conference, ConferenceStatus } from "@/types";

export function ConferencesPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConferenceStatus | "all">(
    "all",
  );

  const canCreate = profile?.role === "admin" || profile?.role === "organizer";

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("conferences")
      .select("*, organizer:profile_directory(*)")
      .order("created_at", { ascending: false });
    if (error) {
      showToast("error", "Không thể tải danh sách hội thảo");
    } else {
      setConferences((data ?? []) as unknown as Conference[]);
    }
    setLoading(false);
  }

  const filtered = conferences.filter((c) => {
    const displayStatus = getConferenceDisplayStatus(c);
    const matchesSearch =
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.location.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || displayStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const grouped = [
    {
      key: "ongoing",
      title: "Đang diễn ra",
      conferences: filtered.filter(
        (conference) => getConferenceDisplayStatus(conference) === "ongoing",
      ),
    },
    {
      key: "registration-open",
      title: "Đang mở đăng ký",
      conferences: filtered
        .filter(
          (conference) => getConferenceDisplayStatus(conference) === "open",
        )
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    },
    {
      key: "upcoming",
      title: "Sắp diễn ra",
      conferences: filtered
        .filter((conference) =>
          ["draft", "closed"].includes(getConferenceDisplayStatus(conference)),
        )
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    },
    {
      key: "ended",
      title: "Đã kết thúc",
      conferences: filtered
        .filter((conference) =>
          ["completed", "cancelled"].includes(
            getConferenceDisplayStatus(conference),
          ),
        )
        .sort((a, b) => b.end_date.localeCompare(a.end_date)),
    },
  ].filter((group) => group.conferences.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hội thảo</h1>
          <p className="mt-1 text-sm text-slate-500">
            {canCreate
              ? "Quản lý và tìm kiếm hội thảo khoa học"
              : "Khám phá hội thảo, xem lịch trình và đăng ký tham dự."}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => navigate("conference-form")}>
            <Plus className="h-4 w-4" /> Tạo hội thảo
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm hội thảo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as ConferenceStatus | "all")
          }
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        >
          <option value="all">Tất cả trạng thái</option>
          {ALL_CONFERENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONFERENCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarDays className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Không tìm thấy hội thảo nào</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.key}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.title}
                </h2>
                <span className="text-xs text-slate-500">
                  {group.conferences.length} hội thảo
                </span>
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {group.conferences.map((conf) => (
                  <button
                    key={conf.id}
                    onClick={() =>
                      navigate("conference-detail", { id: conf.id })
                    }
                    className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:border-teal-300 hover:shadow-md"
                  >
                    <div className="relative h-32 overflow-hidden bg-gradient-to-br from-teal-600 to-blue-700">
                      {conf.cover_image_url && (
                        <img
                          src={conf.cover_image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />
                      <div className="absolute bottom-3 left-4 right-4">
                        <Badge
                          className={
                            CONFERENCE_STATUS_COLORS[
                              getConferenceDisplayStatus(conf)
                            ]
                          }
                        >
                          {
                            CONFERENCE_STATUS_LABELS[
                              getConferenceDisplayStatus(conf)
                            ]
                          }
                        </Badge>
                      </div>
                    </div>
                    <div className="p-5">
                      <h3 className="line-clamp-2 font-semibold text-slate-900 transition-colors group-hover:text-teal-700">
                        {conf.title}
                      </h3>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-500">
                        {conf.description}
                      </p>
                      <div className="mt-4 space-y-1.5 text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {formatConferenceDateTime(conf.start_date)}{" "}
                          -{" "}
                          {formatConferenceDateTime(conf.end_date)}
                        </div>
                        {conf.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5" />
                            {conf.location}
                          </div>
                        )}
                        {conf.max_participants > 0 && (
                          <div className="flex items-center gap-2">
                            <Users className="h-3.5 w-3.5" />
                            Tối đa {conf.max_participants} người
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function formatConferenceDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
