import { useEffect, useState } from "react";
import {
  CalendarDays,
  FileText,
  Plus,
  Users,
  ClipboardCheck,
} from "lucide-react";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConferenceFormPage } from "@/pages/ConferenceFormPage";
import { PaperFormPage } from "@/pages/PaperFormPage";
import {
  PAPER_STATUS_LABELS,
  PAPER_STATUS_COLORS,
  CONFERENCE_STATUS_LABELS,
  getConferenceDisplayStatus,
} from "@/lib/constants";
import type { Conference, Paper } from "@/types";

export function RoleDashboard() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const organizer = profile?.role === "organizer";
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [people, setPeople] = useState(0);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        if (!profile?.id) return;
        if (organizer) {
          const staff = await supabase
            .from("conference_staff")
            .select("conference_id")
            .eq("user_id", profile.id);
          if (staff.error) throw staff.error;
          const all = await supabase
            .from("conferences")
            .select("*")
            .order("start_date");
          if (all.error) throw all.error;
          const ids = new Set(
            (staff.data ?? []).map((item) => item.conference_id),
          );
          const managed = (all.data as Conference[]).filter(
            (item) => item.organizer_id === profile.id || ids.has(item.id),
          );
          const managedIds = managed.map((item) => item.id);
          const [paperResult, participantResult] = managedIds.length
            ? await Promise.all([
                supabase
                  .rpc("read_papers")
                  .in("conference_id", managedIds)
                  .select("*")
                  .order("created_at", { ascending: false }),
                supabase
                  .from("participants")
                  .select("id", { count: "exact", head: true })
                  .in("conference_id", managedIds),
              ])
            : [
                { data: [], error: null },
                { count: 0, error: null },
              ];
          if (paperResult.error || participantResult.error)
            throw new Error("load");
          if (!cancelled) {
            setConferences(managed);
            setPapers((paperResult.data ?? []) as Paper[]);
            setPeople(participantResult.count ?? 0);
          }
        } else {
          const [authored, allPapers, registrations, reviewResult] =
            await Promise.all([
              supabase
                .from("paper_authors")
                .select("paper_id")
                .eq("user_id", profile.id),
              supabase
                .rpc("read_papers")
                .select("*")
                .order("created_at", { ascending: false }),
              supabase
                .from("participants")
                .select("conference:conferences(*)")
                .eq("user_id", profile.id),
              supabase
                .from("reviews")
                .select("id", { count: "exact", head: true })
                .eq("reviewer_id", profile.id)
                .in("status", ["assigned", "in_progress"]),
            ]);
          if (
            [authored, allPapers, registrations, reviewResult].some(
              (result) => result.error,
            )
          )
            throw new Error("load");
          const ids = new Set(
            (authored.data ?? []).map((item) => item.paper_id),
          );
          const own = (allPapers.data as Paper[]).filter(
            (item) => item.submitted_by === profile.id || ids.has(item.id),
          );
          const joined = (registrations.data ?? []) as unknown as {
            conference: Conference | null;
          }[];
          if (!cancelled) {
            setPapers(own);
            setConferences(
              joined.flatMap((item) =>
                item.conference ? [item.conference] : [],
              ),
            );
            setPendingReviews(reviewResult.count ?? 0);
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, organizer, reload]);

  const close = () => {
    if (!saving) setOpen(false);
  };
  const saved = () => {
    setOpen(false);
    setSaving(false);
    setReload((value) => value + 1);
  };
  const revisionCount = papers.filter(
    (paper) => paper.status === "revision_required",
  ).length;
  const stats = organizer
    ? [
        {
          label: "Hội thảo phụ trách",
          value: conferences.length,
          icon: CalendarDays,
        },
        {
          label: "Bài báo trong hội thảo",
          value: papers.length,
          icon: FileText,
        },
        { label: "Lượt đăng ký", value: people, icon: Users },
      ]
    : [
        {
          label: "Bài của tôi và đồng tác giả",
          value: papers.length,
          icon: FileText,
        },
        {
          label: "Bài cần chỉnh sửa",
          value: revisionCount,
          icon: ClipboardCheck,
        },
        {
          label: "Phản biện chưa hoàn thành",
          value: pendingReviews,
          icon: CalendarDays,
        },
      ];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-700">
            {organizer ? "BAN TỔ CHỨC" : "KHÔNG GIAN TÁC GIẢ"}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Xin chào, {profile?.full_name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {organizer
              ? "Theo dõi các hội thảo bạn phụ trách, bài nộp và người đăng ký."
              : "Theo dõi bài nộp, yêu cầu chỉnh sửa và công việc phản biện của bạn."}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {organizer ? "Tạo hội thảo" : "Nộp bài báo"}
        </Button>
      </header>
      <Modal
        open={open}
        onClose={close}
        title={organizer ? "Tạo hội thảo" : "Nộp bài báo"}
        size="lg"
      >
        {organizer ? (
          <ConferenceFormPage
            embedded
            onCancel={close}
            onSaved={saved}
            onSubmittingChange={setSaving}
          />
        ) : (
          <PaperFormPage
            embedded
            onCancel={close}
            onSaved={saved}
            onSubmittingChange={setSaving}
          />
        )}
      </Modal>
      {loading ? (
        <p className="py-12 text-center text-slate-500">Đang tải dữ liệu...</p>
      ) : error ? (
        <Card className="p-6">
          <p role="alert" className="mb-3 text-rose-700">
            Không thể tải dữ liệu tổng quan.
          </p>
          <Button onClick={() => setReload((value) => value + 1)}>
            Thử lại
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-5">
                <Icon className="mb-3 h-6 w-6 text-teal-600" />
                <p className="text-3xl font-bold text-slate-900">{value}</p>
                <p className="mt-1 text-sm text-slate-500">{label}</p>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {organizer ? (
              <>
                <Button variant="outline" onClick={() => navigate("sessions")}>
                  Lịch trình
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("participants")}
                >
                  Quản lý đăng ký
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("certificates")}
                >
                  Cấp chứng nhận
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => navigate("reviews")}>
                  Phản biện được giao
                </Button>
                <Button variant="outline" onClick={() => navigate("papers")}>
                  Đọc bài báo khoa học
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("conferences")}
                >
                  Tìm hội thảo
                </Button>
              </>
            )}
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="border-b border-slate-200 p-5 font-semibold">
                {organizer ? "Hội thảo phụ trách" : "Hội thảo đã đăng ký"}
              </h2>
              {conferences.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  {organizer
                    ? "Chưa có hội thảo được giao. Bạn có thể tạo hội thảo mới."
                    : "Bạn chưa đăng ký hội thảo nào."}
                </p>
              ) : (
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                  {conferences.map((item) => (
                    <button
                      key={item.id}
                      className="block w-full p-4 text-left hover:bg-teal-50"
                      onClick={() =>
                        navigate("conference-detail", { id: item.id })
                      }
                    >
                      <p className="font-medium text-slate-800">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(item.start_date).toLocaleDateString("vi-VN")}{" "}
                        ·{" "}
                        {
                          CONFERENCE_STATUS_LABELS[
                            getConferenceDisplayStatus(item)
                          ]
                        }
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <Card className="overflow-hidden">
              <h2 className="border-b border-slate-200 p-5 font-semibold">
                {organizer
                  ? "Bài báo thuộc hội thảo phụ trách"
                  : "Bài báo của tôi"}
              </h2>
              {papers.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  {organizer
                    ? "Chưa có bài báo trong các hội thảo này."
                    : "Chưa có bài nộp hoặc bài đồng tác giả. Bấm Nộp bài báo để bắt đầu."}
                </p>
              ) : (
                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                  {papers.map((item) => (
                    <button
                      key={item.id}
                      className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left hover:bg-teal-50"
                      onClick={() => navigate("paper-detail", { id: item.id })}
                    >
                      <span className="text-sm font-medium text-slate-800">
                        {item.title}
                      </span>
                      <Badge className={PAPER_STATUS_COLORS[item.status]}>
                        {PAPER_STATUS_LABELS[item.status]}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
