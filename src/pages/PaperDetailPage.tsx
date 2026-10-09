import { useCallback, useEffect, useState } from "react";
import { ReviewResponseActions } from "@/components/ReviewResponseActions";
import {
  ArrowLeft,
  Trash2,
  FileText,
  Calendar,
  Clock,
  ClipboardCheck,
  Plus,
  Star,
  Pencil,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select, Textarea } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import {
  PAPER_STATUS_LABELS,
  PAPER_STATUS_COLORS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_COLORS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_COLORS,
  ROLE_LABELS,
} from "@/lib/constants";
import {
  getPaperStatusTransitions,
  PAPER_STATUS_NUMBERS,
} from "@/lib/paperWorkflow";
import type {
  Paper,
  Review,
  Profile,
  PaperStatus,
  ReviewRecommendation,
  PaperVersion,
} from "@/types";

export function PaperDetailPage() {
  const { route, navigate } = useRouter();
  const { profile } = useAuth();
  const paperId = route.params.id;

  const [paper, setPaper] = useState<Paper | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [authors, setAuthors] = useState<Profile[]>([]);
  const [versions, setVersions] = useState<PaperVersion[]>([]);
  const [fileLinks, setFileLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [loadingReviewers, setLoadingReviewers] = useState(false);
  const [reviewerLoadError, setReviewerLoadError] = useState("");
  const [reviewers, setReviewers] = useState<Profile[]>([]);
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [reviewScore, setReviewScore] = useState(5);
  const [originalityScore, setOriginalityScore] = useState(5);
  const [relevanceScore, setRelevanceScore] = useState(5);
  const [methodologyScore, setMethodologyScore] = useState(5);
  const [presentationScore, setPresentationScore] = useState(5);
  const [reviewComments, setReviewComments] = useState("");
  const [reviewRecommendation, setReviewRecommendation] =
    useState<ReviewRecommendation>("accept");

  const [canEdit, setCanEdit] = useState(false);
  const [canEditSubmission, setCanEditSubmission] = useState(false);
  const isAuthor =
    typeof paper?.submitted_by === "string"
      ? paper?.submitted_by === profile?.id
      : paper?.submitted_by?.id === profile?.id;
  const isPaperAuthor =
    isAuthor || authors.some((author) => author.id === profile?.id);
  const canReview =
    profile?.role === "reviewer" &&
    reviews.some((review) => review.reviewer_id === profile?.id);

  useEffect(
    () => () => {
      Object.values(fileLinks).forEach((link) => {
        if (link.startsWith("blob:")) URL.revokeObjectURL(link);
      });
    },
    [fileLinks],
  );

  const completedReviews = reviews.filter(
    (review) => review.status === "completed",
  );
  const visibleReviews = canEdit
    ? reviews
    : canReview
      ? reviews.filter((review) => review.reviewer_id === profile?.id)
      : isPaperAuthor
        ? completedReviews
        : [];
  const averageScore =
    completedReviews.length > 0
      ? completedReviews.reduce((sum, review) => sum + (review.score ?? 0), 0) /
        completedReviews.length
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    setCanEdit(false);
    setCanEditSubmission(false);
    setFileLinks({});
    setAuthors([]);
    setReviews([]);
    setVersions([]);
    const { data: p } = await supabase
      .rpc("read_papers")
      .eq("id", paperId)
      .select("*, conference:conferences(*), submitted_by:profile_directory(*)")
      .maybeSingle();
    if (p) setPaper(p as unknown as Paper);
    else setPaper(null);
    if (p) {
      const { data: canManage } = await supabase.rpc(
        "is_conference_organizer",
        { conf_id: p.conference_id },
      );
      setCanEdit(canManage === true);
      const { data: editable } = await supabase.rpc(
        "can_edit_paper_submission",
        { target_paper_id: paperId },
      );
      setCanEditSubmission(editable === true);
    }

    const { data: revs } = await supabase
      .from("reviews")
      .select("*, reviewer:profile_directory(*)")
      .eq("paper_id", paperId)
      .order("assigned_at", { ascending: true });
    if (revs) setReviews(revs as unknown as Review[]);

    const { data: auths } = await supabase
      .from("paper_authors")
      .select("user_id")
      .eq("paper_id", paperId)
      .order("author_order", { ascending: true });
    if (auths) {
      const authorIds = auths.map((author) => author.user_id);
      if (authorIds.length > 0) {
        const { data: authorProfiles } = await supabase
          .from("profile_directory")
          .select("*")
          .in("id", authorIds);
        const profilesById = new Map(
          (authorProfiles ?? []).map((author) => [
            author.id,
            author as Profile,
          ]),
        );
        setAuthors(
          authorIds
            .map((authorId) => profilesById.get(authorId))
            .filter((author): author is Profile => Boolean(author)),
        );
      } else {
        setAuthors([]);
      }
    }

    const { data: vers } = await supabase
      .from("paper_versions")
      .select("*, uploader:profile_directory(*)")
      .eq("paper_id", paperId)
      .order("version_number", { ascending: false });
    if (vers) setVersions(vers as unknown as PaperVersion[]);

    const fileReferences = [
      p?.file_url as string | undefined,
      ...(vers ?? []).map((version) => version.file_url as string),
    ].filter((reference): reference is string => Boolean(reference));
    const links = await Promise.all(
      fileReferences.map(
        async (reference) =>
          [reference, await createPaperFileLink(reference)] as const,
      ),
    );
    setFileLinks(Object.fromEntries(links.filter(([, link]) => Boolean(link))));

    setLoading(false);
  }, [paperId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStatusChange(newStatus: PaperStatus) {
    const allowedStatuses = getPaperStatusTransitions(
      paper?.status ?? "submitted",
      reviews.length > 0,
      completedReviews.length > 0,
    );
    if (!allowedStatuses.includes(newStatus)) {
      showToast("error", "Không thể chuyển trạng thái ở bước hiện tại");
      return;
    }
    const { error } = await supabase
      .from("papers")
      .update({ status: newStatus })
      .eq("id", paperId);
    if (error) {
      showToast("error", "Cập nhật trạng thái thất bại");
    } else {
      showToast("success", "Đã cập nhật trạng thái");
      load();
    }
  }

  async function openAssignModal() {
    setAssignModalOpen(true);
    setLoadingReviewers(true);
    setReviewerLoadError("");
    setReviewers([]);
    const { data, error } = await supabase
      .from("profile_directory")
      .select("*")
      .eq("role", "reviewer")
      .order("full_name");
    if (data) setReviewers(data as unknown as Profile[]);
    if (error)
      setReviewerLoadError(
        "Không thể tải danh sách phản biện: " + error.message,
      );
    setLoadingReviewers(false);
    setSelectedReviewers([]);
    setAssignModalOpen(true);
  }

  async function handleAssignReviewer() {
    const reviewerIds = selectedReviewers;
    if (!reviewerIds.length) {
      showToast("error", "Vui lòng chọn phản biện");
      return;
    }
    if (reviewerIds.some((reviewerId) => assignedReviewerIds.has(reviewerId))) {
      showToast("error", "Phản biện này đã được phân công");
      return;
    }
    const { error } = await supabase.from("reviews").insert(
      reviewerIds.map((reviewer_id) => ({
        paper_id: paperId,
        reviewer_id,
        status: "assigned",
      })),
    );
    if (error) {
      if (error.code === "23505") {
        showToast("error", "Phản biện này đã được phân công");
      } else {
        showToast("error", "Phân công thất bại: " + error.message);
      }
    } else {
      showToast("success", `Đã phân công ${reviewerIds.length} reviewer`);
      if (paper?.status === "submitted") {
        const { error: statusError } = await supabase
          .from("papers")
          .update({ status: "under_review" })
          .eq("id", paperId);
        if (statusError) {
          showToast(
            "error",
            "Đã phân công nhưng chưa thể chuyển bài sang trạng thái phản biện",
          );
        }
      }
      setAssignModalOpen(false);
      load();
    }
  }

  const submitterId =
    typeof paper?.submitted_by === "string"
      ? paper.submitted_by
      : paper?.submitted_by?.id;
  const assignedReviewerIds = new Set(
    reviews.map((review) => review.reviewer_id),
  );
  function reviewerUnavailableReason(reviewer: Profile) {
    if (reviewer.id === submitterId) return "Tác giả chính của bài";
    if (authors.some((author) => author.id === reviewer.id))
      return "Đồng tác giả của bài";
    if (assignedReviewerIds.has(reviewer.id)) return "Đã được phân công";
    return "";
  }
  const reviewerCandidates = [...reviewers].sort((left, right) => {
    const roleOrder = { reviewer: 0, author: 1 } as const;
    return (
      roleOrder[left.role as keyof typeof roleOrder] -
        roleOrder[right.role as keyof typeof roleOrder] ||
      (left.full_name ?? "").localeCompare(right.full_name ?? "", "vi")
    );
  });
  const eligibleReviewers = reviewerCandidates.filter(
    (reviewer) => !reviewerUnavailableReason(reviewer),
  );
  const paperFileReference = [
    paper?.file_url,
    ...versions.map((version) => version.file_url),
  ].find((reference) => reference && fileLinks[reference]);

  function openReviewModal(review: Review) {
    setEditingReview(review);
    setReviewScore(review.score ?? 5);
    setOriginalityScore(review.originality_score ?? 5);
    setRelevanceScore(review.relevance_score ?? 5);
    setMethodologyScore(review.methodology_score ?? 5);
    setPresentationScore(review.presentation_score ?? 5);
    setReviewComments(review.comments ?? "");
    setReviewRecommendation(review.recommendation ?? "accept");
    setReviewModalOpen(true);
  }

  async function handleSaveReview(complete: boolean) {
    if (!editingReview || savingReview) return;
    if (complete && !reviewComments.trim()) {
      showToast("error", "Vui lòng nhập nhận xét");
      return;
    }
    setSavingReview(true);
    try {
    const { error } = await supabase
      .from("reviews")
      .update({
        score: reviewScore,
        originality_score: originalityScore,
        relevance_score: relevanceScore,
        methodology_score: methodologyScore,
        presentation_score: presentationScore,
        comments: reviewComments,
        recommendation: reviewRecommendation,
        status: complete ? "completed" : "in_progress",
        completed_at: complete ? new Date().toISOString() : null,
      })
      .eq("id", editingReview.id);
    if (error) {
      showToast("error", "Lưu đánh giá thất bại");
    } else {
      showToast("success", "Đã lưu đánh giá");
      setReviewModalOpen(false);
      load();
    }
    } catch {
      showToast("error", "Không thể lưu đánh giá. Vui lòng thử lại.");
    } finally {
      setSavingReview(false);
    }
  }

  async function handleDeleteReview(reviewId: string) {
    if (!confirm("Xóa phân công phản biện này?")) return;
    const { error } = await supabase
      .from("reviews")
      .delete()
      .eq("id", reviewId);
    if (error) {
      showToast("error", "Xóa thất bại");
    } else {
      showToast("success", "Đã xóa phân công");
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Không tìm thấy bài báo</p>
        <Button className="mt-4" onClick={() => navigate("papers")}>
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("papers")}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1">
          <Badge className={PAPER_STATUS_COLORS[paper.status]}>
            {PAPER_STATUS_LABELS[paper.status]}
          </Badge>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-slate-950">
            {paper.title}
          </h1>
          <div className="mt-4 border-l-4 border-teal-500 pl-3">
            <p className="text-base text-slate-600">
              Tác giả:{" "}
              <span className="font-bold text-slate-950">
                {typeof paper.submitted_by === "object"
                  ? paper.submitted_by?.full_name || "Chưa đặt tên"
                  : "N/A"}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Đồng tác giả:{" "}
              <span className="font-semibold text-slate-800">
                {authors.length > 0
                  ? authors
                      .map((author) => author.full_name || "Chưa đặt tên")
                      .join(", ")
                  : "Không có"}
              </span>
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Hội thảo:{" "}
            <span className="font-medium text-slate-700">
              {paper.conference?.title}
            </span>
          </p>
        </div>
      </div>

      {(canEdit ||
        (isPaperAuthor &&
          ["revision_required", "accepted"].includes(paper.status))) && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                {paper.status === "accepted"
                  ? "Bản hoàn thiện (camera-ready)"
                  : "Chỉnh sửa bài báo"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {canEditSubmission
                  ? "Cập nhật nội dung, đồng tác giả hoặc nộp file phiên bản mới."
                  : "Bài hiện không cho phép chỉnh sửa hoặc đã hết hạn nộp."}
              </p>
            </div>
            {canEditSubmission && (
              <Button onClick={() => navigate("paper-form", { id: paperId })}>
                <Pencil className="h-4 w-4" />
                {paper.status === "accepted"
                  ? "Nộp bản hoàn thiện"
                  : "Sửa / nộp bản mới"}
              </Button>
            )}
          </div>
          <p className="text-sm text-slate-500">
            Hạn chỉnh sửa:{" "}
            {(() => {
              const deadline = ["accepted", "revision_required"].includes(
                paper.status,
              )
                ? paper.conference?.camera_ready_deadline
                : paper.conference?.submission_deadline;
              return deadline
                ? new Date(deadline).toLocaleString("vi-VN")
                : "Chưa đặt thời hạn";
            })()}
          </p>
        </Card>
      )}

      {/* Paper info */}
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1.5">
            Tóm tắt
          </h3>
          <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">
            {paper.abstract || "Chưa có tóm tắt"}
          </p>
        </div>
        {paper.keywords && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-1.5">
              Từ khóa
            </h3>
            <div className="flex flex-wrap gap-2">
              {paper.keywords.split(",").map((kw, i) => (
                <Badge key={i} className="bg-slate-100 text-slate-600">
                  {kw.trim()}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-6 border-t border-slate-100 pt-4 text-sm text-slate-500">
          <span className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            Nộp ngày: {new Date(paper.created_at).toLocaleDateString("vi-VN")}
          </span>
          {paperFileReference && fileLinks[paperFileReference] && (
            <a
              href={fileLinks[paperFileReference]}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-teal-600 hover:text-teal-700"
            >
              <FileText className="h-4 w-4" /> Xem file bài báo
            </a>
          )}
        </div>
      </Card>

      {isPaperAuthor && !canEdit && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900">
                Tiến độ phản biện
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {reviews.length === 0
                  ? "Bài báo đang chờ ban tổ chức phân công phản biện."
                  : `${completedReviews.length}/${reviews.length} phản biện đã hoàn thành.`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Quyết định hiện tại
              </p>
              <Badge className={PAPER_STATUS_COLORS[paper.status]}>
                {PAPER_STATUS_LABELS[paper.status]}
              </Badge>
            </div>
          </div>
        </Card>
      )}

      {canReview && !canEdit && (
        <Card className="p-5">
          <h3 className="font-semibold text-slate-900">Thông tin phản biện</h3>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Hạn phản biện: </span>
              <span className="font-medium text-slate-800">
                {paper.conference?.review_deadline
                  ? new Date(paper.conference.review_deadline).toLocaleString(
                      "vi-VN",
                    )
                  : "Chưa đặt thời hạn"}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Trạng thái: </span>
              <span className="font-medium text-slate-800">
                {visibleReviews[0]
                  ? REVIEW_STATUS_LABELS[visibleReviews[0].status]
                  : "Chưa có nhiệm vụ"}
              </span>
            </div>
          </div>
        </Card>
      )}

      {(canEdit || isPaperAuthor) && completedReviews.length > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                Kết quả phản biện
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {completedReviews.length} phản biện đã hoàn thành
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-slate-900">
                {averageScore === null ? "--" : averageScore.toFixed(1)}
              </p>
              <p className="text-xs text-slate-500">Điểm trung bình / 10</p>
            </div>
          </div>
          {paper.conference?.review_deadline && canEdit && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Clock className="h-4 w-4 shrink-0" />
              Hạn phản biện:{" "}
              {new Date(paper.conference.review_deadline).toLocaleString(
                "vi-VN",
              )}
            </div>
          )}
        </Card>
      )}

      {/* Status management */}
      {canEdit && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700">
            Quy trình bài báo
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Trạng thái hiện tại:{" "}
            <strong className="text-slate-800">
              {PAPER_STATUS_NUMBERS[paper.status]
                ? `${PAPER_STATUS_NUMBERS[paper.status]}. `
                : ""}
              {PAPER_STATUS_LABELS[paper.status]}
            </strong>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {getPaperStatusTransitions(
              paper.status,
              reviews.length > 0,
              completedReviews.length > 0,
            ).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  PAPER_STATUS_COLORS[s] + " hover:opacity-80"
                }`}
              >
                Chuyển sang{" "}
                {PAPER_STATUS_NUMBERS[s] ? `${PAPER_STATUS_NUMBERS[s]}. ` : ""}
                {PAPER_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {getPaperStatusTransitions(
            paper.status,
            reviews.length > 0,
            completedReviews.length > 0,
          ).length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              {paper.status === "submitted"
                ? "Hãy phân công ít nhất một người phản biện để bắt đầu."
                : paper.status === "under_review"
                  ? "Cần ít nhất một phản biện hoàn thành trước khi ra quyết định."
                  : "Bài báo đã ở trạng thái kết thúc."}
            </p>
          )}
        </Card>
      )}

      {/* Reviews */}
      {(canEdit ||
        canReview ||
        (isPaperAuthor && completedReviews.length > 0)) && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-slate-400" />
              {canReview && !canEdit
                ? "Nhiệm vụ phản biện"
                : `Nhận xét phản biện (${visibleReviews.length})`}
            </h3>
            {canEdit && (
              <Button size="sm" onClick={openAssignModal}>
                <Plus className="h-4 w-4" /> Phân công
              </Button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {visibleReviews.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                Chưa có phản biện nào được phân công
              </p>
            ) : (
              visibleReviews.map((review) => (
                <div key={review.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {(!isPaperAuthor || canEdit || canReview) && (
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                            {review.reviewer?.full_name
                              ?.charAt(0)
                              .toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">
                              {review.reviewer?.full_name ?? "N/A"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {review.reviewer
                                ? ROLE_LABELS[review.reviewer.role]
                                : ""}{" "}
                              • Phân công:{" "}
                              {new Date(review.assigned_at).toLocaleDateString(
                                "vi-VN",
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      {review.status === "completed" && (
                        <div className="mt-3 space-y-2 pl-12">
                          {review.score !== null && (
                            <div className="flex items-center gap-2">
                              <Star className="h-4 w-4 text-amber-500" />
                              <span className="text-sm text-slate-600">
                                Điểm:{" "}
                                <span className="font-semibold">
                                  {review.score}/10
                                </span>
                              </span>
                            </div>
                          )}
                          {review.recommendation && (
                            <Badge
                              className={
                                RECOMMENDATION_COLORS[review.recommendation]
                              }
                            >
                              {RECOMMENDATION_LABELS[review.recommendation]}
                            </Badge>
                          )}
                          {review.comments && (
                            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                              {review.comments}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={REVIEW_STATUS_COLORS[review.status]}>
                        {REVIEW_STATUS_LABELS[review.status]}
                      </Badge>
                      <ReviewResponseActions
                        review={{ ...review, paper }}
                        onChanged={load}
                      />
                      {canReview &&
                        review.reviewer_id === profile?.id &&
                        review.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReviewModal(review)}
                          >
                            Đánh giá
                          </Button>
                        )}
                      {canEdit && (
                        <button
                          onClick={() => handleDeleteReview(review.id)}
                          className="text-rose-500 hover:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
      {/* Assign reviewer modal */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Phân công phản biện"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <p className="font-medium text-slate-900">
              Chọn tài khoản phản biện
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Hiển thị {reviewerCandidates.length} tài khoản đã được Admin cấp
              vai trò Phản biện. Những người có xung đột với bài báo được giữ
              trong danh sách để Ban tổ chức nhận biết.
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            {reviewerCandidates.map((r) => {
              const unavailableReason = reviewerUnavailableReason(r);
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-3 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 ${
                    unavailableReason
                      ? "cursor-not-allowed bg-slate-50 opacity-65"
                      : "cursor-pointer hover:bg-teal-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!!unavailableReason}
                    checked={selectedReviewers.includes(r.id)}
                    onChange={(e) =>
                      setSelectedReviewers((current) =>
                        e.target.checked
                          ? [...current, r.id]
                          : current.filter((id) => id !== r.id),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">
                      {r.full_name || "Chưa đặt tên"}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.organization || r.email || "Chưa cập nhật đơn vị"}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      r.role === "reviewer"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {ROLE_LABELS[r.role]}
                  </span>
                  {unavailableReason && (
                    <span className="text-xs font-medium text-slate-500">
                      {unavailableReason}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          {eligibleReviewers.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSelectedReviewers(eligibleReviewers.map((r) => r.id))
              }
            >
              Chọn tất cả có thể phân công
            </Button>
          )}
          {loadingReviewers && (
            <p className="text-sm text-slate-500">
              Đang tải người phản biện...
            </p>
          )}
          {reviewerLoadError && (
            <div role="alert" className="text-sm text-rose-700">
              {reviewerLoadError}
              <Button variant="outline" onClick={() => void openAssignModal()}>
                Thử lại
              </Button>
            </div>
          )}
          {!loadingReviewers &&
            !reviewerLoadError &&
            eligibleReviewers.length === 0 && (
              <p className="text-sm text-slate-500">
                Không còn phản biện phù hợp để phân công cho bài báo này.
              </p>
            )}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setAssignModalOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleAssignReviewer}
              disabled={
                loadingReviewers ||
                !!reviewerLoadError ||
                !selectedReviewers.length ||
                eligibleReviewers.length === 0
              }
            >
              Phân công
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review modal */}
      <Modal
        open={reviewModalOpen}
        onClose={() => { if (!savingReview) setReviewModalOpen(false); }}
        title="Đánh giá phản biện"
        size="md"
      >
        <div className="space-y-4">
          <ScoreSlider
            label="Tổng điểm"
            value={reviewScore}
            onChange={setReviewScore}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ScoreSlider
              label="Tính mới"
              value={originalityScore}
              onChange={setOriginalityScore}
            />
            <ScoreSlider
              label="Độ phù hợp"
              value={relevanceScore}
              onChange={setRelevanceScore}
            />
            <ScoreSlider
              label="Phương pháp"
              value={methodologyScore}
              onChange={setMethodologyScore}
            />
            <ScoreSlider
              label="Trình bày"
              value={presentationScore}
              onChange={setPresentationScore}
            />
          </div>
          <Select
            label="Khuyến nghị"
            value={reviewRecommendation}
            onChange={(e) =>
              setReviewRecommendation(e.target.value as ReviewRecommendation)
            }
          >
            <option value="accept">Chấp nhận</option>
            <option value="revise">Cần sửa đổi</option>
            <option value="reject">Từ chối</option>
          </Select>
          <Textarea
            label="Nhận xét"
            value={reviewComments}
            onChange={(e) => setReviewComments(e.target.value)}
            placeholder="Nhập nhận xét chi tiết..."
            className="min-h-[120px]"
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={savingReview} onClick={() => setReviewModalOpen(false)}>
              Hủy
            </Button>
            <Button variant="outline" disabled={savingReview} onClick={() => handleSaveReview(false)}>
              Lưu nháp
            </Button>
            <Button disabled={savingReview} onClick={() => handleSaveReview(true)}>
              Gửi phản biện
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

async function createPaperFileLink(fileReference: string) {
  const storagePath = getPaperStoragePath(fileReference);
  if (!storagePath) return fileReference;

  const { data, error } = await supabase.storage
    .from("paper-files")
    .createSignedUrl(storagePath, 15 * 60);
  return error ? "" : data.signedUrl;
}

function getPaperStoragePath(fileReference: string) {
  const legacyPublicPath = "/storage/v1/object/public/paper-files/";
  const legacyIndex = fileReference.indexOf(legacyPublicPath);
  if (legacyIndex >= 0) {
    return decodeURIComponent(
      fileReference.slice(legacyIndex + legacyPublicPath.length),
    );
  }

  return /^https?:\/\//i.test(fileReference) ? null : fileReference;
}

function ScoreSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} ({value}/10)
      </label>
      <input
        type="range"
        min={0}
        max={10}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full accent-teal-600"
      />
    </div>
  );
}
