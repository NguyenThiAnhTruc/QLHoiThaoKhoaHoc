import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Conference, Paper, Session } from "@/types";

export function DashboardTasks({ papers, conferences, organizer }: { papers: Paper[]; conferences: Conference[]; organizer: boolean }) {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void supabase.from("sessions").select("*, conference:conferences(*)").order("start_time").then(({ data, error }) => {
      if (!cancelled) { setSessions((data ?? []) as Session[]); setError(error ? "Không thể tải lịch báo cáo." : ""); }
    });
    return () => { cancelled = true; };
  }, []);
  const now = Date.now();
  const ownIds = new Set(papers.map((paper) => paper.id));
  const managedIds = new Set(conferences.map((conference) => conference.id));
  const upcoming = sessions.filter((session) => new Date(session.end_time).getTime() >= now && (organizer ? managedIds.has(session.conference_id) : session.speaker_id === profile?.id || (session.paper_id && ownIds.has(session.paper_id)))).slice(0, 4);
  const actionPapers = papers.filter((paper) => organizer ? ["submitted", "under_review"].includes(paper.status) : paper.status === "revision_required");
  const deadlines = conferences.flatMap((conference) => [
    { label: "Nộp bài", date: conference.submission_deadline, conference },
    { label: "Bản cuối", date: conference.camera_ready_deadline, conference },
  ]).filter((deadline) => deadline.date && new Date(deadline.date).getTime() >= now).sort((a,b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()).slice(0, 3);
  return <section className="grid gap-4 lg:grid-cols-3" aria-label="Công việc ưu tiên">
    <Card className="border-t-4 border-t-amber-500 p-5"><h2 className="font-semibold">{organizer ? "Bài cần xử lý" : "Bài cần chỉnh sửa"}</h2><p className="mt-1 text-sm text-slate-500">{actionPapers.length} bài đang chờ hành động</p><div className="mt-4 space-y-3">{actionPapers.slice(0,3).map((paper) => <button key={paper.id} className="block w-full text-left text-sm font-medium text-teal-700 hover:underline" onClick={() => navigate("paper-detail", {id:paper.id})}>{paper.title}<span className="mt-1 block text-xs font-normal text-slate-500">{organizer ? "Xem phân công và kết quả để ra quyết định" : "Đọc góp ý và nộp bản chỉnh sửa"}</span></button>)}{!actionPapers.length && <p className="text-sm text-slate-500">Không có bài cần xử lý.</p>}</div></Card>
    <Card className="border-t-4 border-t-teal-600 p-5"><h2 className="font-semibold">{organizer ? "Lịch sắp diễn ra" : "Lịch báo cáo của tôi"}</h2>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}<div className="mt-4 space-y-3">{upcoming.map((session) => <div key={session.id}><p className="text-sm font-medium">{session.title}</p><p className="text-xs text-slate-500">{new Date(session.start_time).toLocaleString("vi-VN")} · {session.room || "Chưa phân phòng"}</p></div>)}{!upcoming.length && !error && <p className="text-sm text-slate-500">Chưa có lịch báo cáo sắp tới.</p>}</div><Button className="mt-4" size="sm" variant="outline" onClick={() => navigate("sessions", {mine: organizer ? "" : "true"})}>Xem lịch trình</Button></Card>
    <Card className="border-t-4 border-t-blue-500 p-5"><h2 className="font-semibold">Hạn sắp tới</h2><div className="mt-4 space-y-3">{deadlines.map((deadline) => <button key={deadline.conference.id+deadline.label} className="block w-full text-left" onClick={() => navigate("conference-detail", {id:deadline.conference.id})}><p className="text-sm font-medium">{deadline.label} · {new Date(deadline.date!).toLocaleString("vi-VN")}</p><p className="text-xs text-slate-500">{deadline.conference.title}</p></button>)}{!deadlines.length && <p className="text-sm text-slate-500">Không có hạn nộp sắp tới.</p>}</div><Button className="mt-4" size="sm" variant="outline" onClick={() => navigate("speaker")}>Báo cáo và tài liệu của tôi</Button></Card>
  </section>;
}
