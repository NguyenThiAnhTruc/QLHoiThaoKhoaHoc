import { useRef, useState } from "react";
import { useAuth } from "@/context/useAuth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/toastStore";
import type { Review } from "@/types";

export function ReviewResponseActions({
  review,
  onChanged,
}: {
  review: Review;
  onChanged: () => void | Promise<void>;
}) {
  const { profile } = useAuth();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function respond(accept: boolean) {
    if (submitting.current || (!accept && !reason.trim())) return;
    submitting.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("respond_review_assignment", {
        target_review_id: review.id,
        accept_assignment: accept,
        reason: reason.trim(),
      });
      if (error) {
        const message =
          error.code === "42883" || error.code === "PGRST202"
            ? "Database chưa triển khai luồng reviewer. Hãy chạy migration 20260925_reviewer_workflow.sql trong Supabase SQL Editor."
            : error.code === "42501"
              ? "Tài khoản reviewer chưa có quyền phản hồi phân công. Hãy kiểm tra RLS và migration reviewer."
              : error.message;
        showToast("error", message);
        return;
      }
      showToast(
        "success",
        accept
          ? "Đã nhận phân công phản biện"
          : "Đã từ chối phân công và thông báo cho ban tổ chức",
      );
      setDeclining(false);
      setReason("");
      await onChanged();
    } catch {
      showToast("error", "Không thể phản hồi phân công. Vui lòng thử lại.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (review.status === "declined")
    return (
      <p className="text-sm text-rose-700">
        Lý do từ chối: {review.decline_reason || "Không có thông tin"}
      </p>
    );
  if (review.reviewer_id !== profile?.id || review.status !== "assigned")
    return null;
  const deadline = review.paper?.conference?.review_deadline;
  if (deadline && new Date(deadline) < new Date())
    return (
      <p className="text-sm text-amber-700">
        Đã hết hạn phản biện. Vui lòng liên hệ ban tổ chức.
      </p>
    );
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-sm text-slate-600">
        Xác nhận nhận phân công trước khi gửi đánh giá.
      </p>
      {declining ? (
        <>
          <label className="block text-sm">
            Lý do từ chối
            <textarea
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block w-full rounded border p-2"
              rows={2}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => void respond(false)}
            >
              Xác nhận từ chối
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setDeclining(false)}
            >
              Hủy
            </Button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void respond(true)}
          >
            Nhận phản biện
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            Từ chối phân công
          </Button>
        </div>
      )}
    </div>
  );
}
