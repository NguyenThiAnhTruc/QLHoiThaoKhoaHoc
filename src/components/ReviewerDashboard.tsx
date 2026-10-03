import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ClipboardCheck } from "lucide-react";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CONFERENCE_STATUS_LABELS, REVIEW_STATUS_COLORS, REVIEW_STATUS_LABELS, getConferenceDisplayStatus } from "@/lib/constants";
import type { Conference, Paper, Review } from "@/types";

export function ReviewerDashboard() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    async function load() {
      setLoading(true); setError(false);
      const [registrations, assigned, readable] = await Promise.all([
        supabase.from("participants").select("conference:conferences(*)").eq("user_id", profile!.id),
        supabase.from("reviews").select("*").eq("reviewer_id", profile!.id).order("assigned_at", { ascending: false }),
        supabase.rpc("read_papers").select("*, conference:conferences(*)").order("created_at", { ascending: false }),
      ]);
      if ([registrations, assigned, readable].some((result) => result.error)) {
        if (active) { setError(true); setLoading(false); }
        return;
      }
      const readablePapers = (readable.data ?? []) as unknown as Paper[];
      const paperById = new Map(readablePapers.map((paper) => [paper.id, paper]));
      if (active) {
        setConferences(((registrations.data ?? []) as unknown as { conference: Conference | null }[]).flatMap((row) => row.conference ? [row.conference] : []));
        setReviews((assigned.data ?? []).map((review) => ({ ...review, paper: paperById.get(review.paper_id) })) as Review[]);
        setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [profile, reload]);

  return <div className="space-y-6">
    <header>
      <p className="text-sm font-medium text-teal-700">KHÔNG GIAN PHẢN BIỆN</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Xin chào, {profile?.full_name}</h1>
      <p className="mt-1 text-sm text-slate-500">Theo dõi hội thảo đã đăng ký và lịch phản biện của bạn.</p>
    </header>
    {loading ? <p className="py-12 text-center text-slate-500">Đang tải dữ liệu...</p> : error ?
      <Card className="p-6"><p role="alert" className="mb-3 text-rose-700">Không thể tải dữ liệu tổng quan.</p><Button onClick={() => setReload(value => value + 1)}>Thử lại</Button></Card> :
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <DashboardList icon={<CalendarDays className="h-5 w-5 text-teal-600" />} title="Hội thảo đã đăng ký" empty="Bạn chưa đăng ký hội thảo nào.">
          {conferences.map((conference) => <button key={conference.id} className="block w-full p-4 text-left hover:bg-teal-50" onClick={() => navigate("conference-detail", { id: conference.id })}>
            <p className="font-medium text-slate-800">{conference.title}</p>
            <p className="mt-1 text-xs text-slate-500">{new Date(conference.start_date).toLocaleDateString("vi-VN")} · {CONFERENCE_STATUS_LABELS[getConferenceDisplayStatus(conference)]}</p>
          </button>)}
        </DashboardList>
        <DashboardList icon={<ClipboardCheck className="h-5 w-5 text-teal-600" />} title="Lịch phản biện" empty="Bạn chưa có lịch phản biện.">
          {reviews.map((review) => <button key={review.id} className="block w-full p-4 text-left hover:bg-teal-50" onClick={() => navigate("paper-detail", { id: review.paper_id })}>
            <p className="font-medium text-slate-800">{review.paper?.title ?? "Bài báo được phân công"}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">Hạn: {review.paper?.conference?.review_deadline ? new Date(review.paper.conference.review_deadline).toLocaleString("vi-VN") : "Chưa đặt"}</span><Badge className={REVIEW_STATUS_COLORS[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge></div>
          </button>)}
        </DashboardList>
      </div>}
  </div>;
}

function DashboardList({ icon, title, empty, children }: { icon: ReactNode; title: string; empty: string; children: ReactNode[] }) {
  return <Card className="overflow-hidden">
    <div className="flex items-center gap-2 border-b border-slate-200 p-5">{icon}<h2 className="font-semibold text-slate-900">{title}</h2></div>
    {children.length === 0 ? <p className="p-6 text-sm text-slate-500">{empty}</p> : <div className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">{children}</div>}
  </Card>;
}
