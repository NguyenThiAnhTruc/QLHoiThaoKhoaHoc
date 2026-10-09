import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Star, Clock, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { showToast } from "@/components/ui/toastStore";
import {
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_COLORS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_COLORS,
  PAPER_STATUS_LABELS,
  PAPER_STATUS_COLORS,
} from "@/lib/constants";
import type { Review } from "@/types";
import { ReviewResponseActions } from '@/components/ReviewResponseActions';

export function ReviewsPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"assigned" | "in_progress" | "declined" | "completed" | "all">("all");

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    let query = supabase
      .from("reviews")
      .select(
        "*, reviewer:profile_directory(*)",
      )
      .order("assigned_at", { ascending: false });
    if (profile.role === 'reviewer') query = query.eq('reviewer_id', profile.id);

    const { data, error } = await query;
    if (error) {
      showToast("error", "Không thể tải danh sách phản biện");
    } else {
      const rows = (data ?? []) as unknown as Review[];
      const paperIds = [...new Set(rows.map((review) => review.paper_id))];
      const result = paperIds.length
        ? await supabase.rpc('read_papers').in('id', paperIds).select('*, conference:conferences(*)')
        : { data: [], error: null };
      if (result.error) showToast('error', 'Không thể tải bài báo được phân công');
      const papers = new Map((result.data ?? []).map((paper) => [paper.id, paper]));
      setReviews(rows.map((review) => ({ ...review, paper: papers.get(review.paper_id) })) as Review[]);
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = reviews.filter((r) => {
    if (tab !== "all") return r.status === tab;
    return true;
  });

  const tabs = [
    { key: "all" as const, label: "Tất cả" },
    { key: "assigned" as const, label: "Chờ xác nhận" },
    { key: "in_progress" as const, label: "Đang thực hiện" },
    { key: "declined" as const, label: "Đã từ chối" },
    { key: "completed" as const, label: "Đã hoàn thành" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Phản biện</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quản lý phân công và đánh giá phản biện
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <ClipboardCheck className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Không có phản biện nào</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <div key={review.id} className="space-y-2">
            <button
              onClick={() => navigate("paper-detail", { id: review.paper_id })}
              className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-teal-300"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-slate-900 truncate">
                    {review.paper?.title ?? "N/A"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {review.paper?.conference?.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {review.reviewer?.full_name ?? "N/A"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(review.assigned_at).toLocaleDateString("vi-VN")}
                    </span>
                    {review.score !== null && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-amber-500" />
                        {review.score}/10
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge className={REVIEW_STATUS_COLORS[review.status]}>
                    {REVIEW_STATUS_LABELS[review.status]}
                  </Badge>
                  {review.recommendation && (
                    <Badge
                      className={RECOMMENDATION_COLORS[review.recommendation]}
                    >
                      {RECOMMENDATION_LABELS[review.recommendation]}
                    </Badge>
                  )}
                  {review.paper && (
                    <Badge className={PAPER_STATUS_COLORS[review.paper.status]}>
                      {PAPER_STATUS_LABELS[review.paper.status]}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
            <ReviewResponseActions review={review} onChanged={load} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
