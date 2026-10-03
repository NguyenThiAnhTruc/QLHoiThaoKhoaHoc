import type { PaperStatus } from "@/types";

export const PAPER_STATUS_DISPLAY_ORDER: PaperStatus[] = [
  "accepted",
  "rejected",
  "revision_required",
  "under_review",
  "submitted",
];

export const PAPER_STATUS_NUMBERS: Partial<Record<PaperStatus, number>> = {
  accepted: 1,
  rejected: 2,
  revision_required: 3,
  under_review: 4,
};

export function getPaperStatusTransitions(
  currentStatus: PaperStatus,
  hasReviewAssignment: boolean,
  hasCompletedReview: boolean,
): PaperStatus[] {
  if (currentStatus === "submitted")
    return hasReviewAssignment ? ["under_review"] : [];
  if (currentStatus === "under_review")
    return hasCompletedReview
      ? ["accepted", "rejected", "revision_required"]
      : [];
  if (currentStatus === "revision_required") return ["under_review"];
  return [];
}
