import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from "@/context/useConferenceAccess";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, ConferenceFund, FeePayment } from "@/types";

const labels = { pending: "Chờ duyệt", accepted: "Đã chấp nhận", rejected: "Từ chối" };
const validAmount = (value: string, zero = false) => value.trim() !== "" && Number.isFinite(Number(value)) && (zero ? Number(value) >= 0 : Number(value) > 0);
const mimeExtensions: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function FundingPage() {
  const { profile } = useAuth();
  const { canManage } = useConferenceAccess();
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [conferenceId, setConferenceId] = useState("");
  const [funds, setFunds] = useState<ConferenceFund[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [fundId, setFundId] = useState("");
  const [fundName, setFundName] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [fundDescription, setFundDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const uploadedProof = useRef<{ file: File; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("conferences").select("*").order("start_date").then(({ data, error }) => {
      if (error) showToast("error", "Không thể tải hội thảo");
      if (!cancelled) setConferences((data ?? []) as Conference[]);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setFunds([]); setPayments([]); setFundId(""); setProofFile(null); setProofUrl(""); uploadedProof.current = null;
    if (conferenceId) void loadData(conferenceId);
    const requests = requestId;
    return () => { requests.current++; };
  }, [conferenceId]);

  async function loadData(id: string) {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const [fundResult, paymentResult] = await Promise.all([
        supabase.from("conference_funds").select("*").eq("conference_id", id).order("created_at"),
        supabase.from("fee_payments").select("*, fund:conference_funds(*)").eq("conference_id", id).order("created_at", { ascending: false }),
      ]);
      if (request !== requestId.current) return;
      if (fundResult.error || paymentResult.error) throw fundResult.error ?? paymentResult.error;
      setFunds((fundResult.data ?? []) as ConferenceFund[]);
      setPayments((paymentResult.data ?? []) as unknown as FeePayment[]);
    } catch { if (request === requestId.current) showToast("error", "Không thể tải dữ liệu kinh phí"); }
    finally { if (request === requestId.current) setLoading(false); }
  }
  async function createFund(event: React.FormEvent) {
    event.preventDefault();
    if (!conferenceId || !canManage(conferenceId) || !fundName.trim() || !validAmount(fundAmount, true) || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("conference_funds").insert({ conference_id: conferenceId, name: fundName.trim(), amount: Number(fundAmount), description: fundDescription.trim(), created_by: profile?.id });
      if (error) throw error;
      showToast("success", "Đã tạo quỹ phí"); setFundName(""); setFundAmount(""); setFundDescription(""); await loadData(conferenceId);
    } catch { showToast("error", "Không thể tạo quỹ phí"); }
    finally { setBusy(false); }
  }
  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!conferenceId || !fundId || !profile?.id || !validAmount(amount) || busy) return;
    if (!proofFile && !/^https?:\/\/\S+$/i.test(proofUrl.trim())) { showToast("error", "Chọn file hoặc nhập liên kết HTTP/HTTPS hợp lệ"); return; }
    if (proofFile && (proofFile.size > 10 * 1024 * 1024 || !mimeExtensions[proofFile.type])) { showToast("error", "Chọn PDF, JPG, PNG hoặc WEBP, tối đa 10 MB"); return; }
    setBusy(true);
    try {
      let proof = proofUrl.trim();
      if (proofFile) {
        if (uploadedProof.current?.file !== proofFile) {
          const path = `${profile.id}/${conferenceId}/${crypto.randomUUID()}.${mimeExtensions[proofFile.type]}`;
          const { error } = await supabase.storage.from("fee-proofs").upload(path, proofFile, { upsert: false });
          if (error) throw error;
          uploadedProof.current = { file: proofFile, path };
        }
        proof = uploadedProof.current.path;
      }
      const { error } = await supabase.from("fee_payments").insert({ fund_id: fundId, conference_id: conferenceId, payer_id: profile.id, amount: Number(amount), purpose: purpose.trim(), proof_url: proof });
      if (error) throw error;
      showToast("success", "Đã gửi minh chứng"); setAmount(""); setPurpose(""); setProofUrl(""); setProofFile(null); uploadedProof.current = null; await loadData(conferenceId);
    } catch { showToast("error", "Không thể gửi minh chứng. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  async function reviewPayment(payment: FeePayment, status: "accepted" | "rejected") {
    if (!canManage(payment.conference_id) || reviewingId) return;
    setReviewingId(payment.id);
    try {
      const { error } = await supabase.from("fee_payments").update({ status }).eq("id", payment.id).eq("status", "pending").select("id").single();
      if (error) throw error;
      showToast("success", "Đã duyệt khoản nộp"); await loadData(payment.conference_id);
    } catch { showToast("error", "Không thể duyệt. Khoản nộp có thể đã được xử lý."); }
    finally { setReviewingId(""); }
  }
  async function openProof(payment: FeePayment) {
    if (/^https?:\/\//i.test(payment.proof_url)) { window.open(payment.proof_url, "_blank", "noopener,noreferrer"); return; }
    const { data, error } = await supabase.storage.from("fee-proofs").createSignedUrl(payment.proof_url, 60);
    if (error || !data) { showToast("error", "Không thể mở minh chứng"); return; }
    const link = document.createElement("a"); link.href = data.signedUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click();
  }
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Kinh phí hội thảo</h1><p className="mt-1 text-sm text-slate-500">Tạo quỹ phí, nộp minh chứng và duyệt khoản đóng góp.</p></header>
    <Card className="p-5"><Select label="Hội thảo" disabled={busy || !!reviewingId} value={conferenceId} onChange={(event) => setConferenceId(event.target.value)}><option value="">Chọn hội thảo</option>{conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}</Select>
      {canManage(conferenceId) && <form onSubmit={createFund} className="mt-5 grid gap-3 border-t border-slate-200 pt-5 md:grid-cols-3"><Input label="Tên quỹ/khoản phí" required value={fundName} onChange={(event) => setFundName(event.target.value)} /><Input label="Số tiền" required type="number" min="0" step="0.01" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} /><Input label="Mô tả" value={fundDescription} onChange={(event) => setFundDescription(event.target.value)} /><Button type="submit" disabled={busy}>Tạo quỹ phí</Button></form>}
    </Card>
    {loading ? <p role="status">Đang tải kinh phí...</p> : conferenceId && <>
      <Card className="p-5"><h2 className="font-semibold">Các quỹ phí</h2>{funds.length === 0 ? <p className="mt-3 text-sm text-slate-500">Chưa có quỹ phí.</p> : <div className="mt-3 divide-y divide-slate-100">{funds.map((fund) => <div key={fund.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium">{fund.name}</p><p className="text-sm text-slate-500">{Number(fund.amount).toLocaleString("vi-VN")} đồng · {fund.description}</p></div><Button size="sm" disabled={busy} onClick={() => { setFundId(fund.id); setAmount(String(fund.amount)); }}>Chọn khoản này</Button></div>)}</div>}</Card>
      {funds.length > 0 && <Card className="p-5"><h2 className="font-semibold">Nộp minh chứng đóng kinh phí</h2><form onSubmit={submitPayment} className="mt-4"><fieldset disabled={busy} className="space-y-4"><Select label="Quỹ phí" required value={fundId} onChange={(event) => setFundId(event.target.value)}><option value="">Chọn quỹ phí</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</Select><Input label="Số tiền đã đóng" required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /><Input label="Nội dung" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Phí tham dự, in ấn..." /><Input label="File minh chứng (tối đa 10 MB)" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { setProofFile(event.target.files?.[0] ?? null); uploadedProof.current = null; }} />{proofFile && <p className="text-sm">Đã chọn: {proofFile.name}</p>}<Textarea label="Hoặc liên kết minh chứng" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="https://..." /><Button type="submit" disabled={busy}>{busy ? "Đang gửi..." : "Gửi minh chứng"}</Button></fieldset></form></Card>}
      <Card className="p-5"><h2 className="font-semibold">Danh sách khoản nộp</h2><p className="mt-2 text-sm text-slate-600">Đã duyệt: {payments.filter((payment) => payment.status === "accepted").reduce((sum, payment) => sum + Number(payment.amount), 0).toLocaleString("vi-VN")} đồng</p>{payments.length === 0 ? <p className="mt-3 text-sm text-slate-500">Chưa có khoản nộp.</p> : <div className="mt-3 divide-y divide-slate-100">{payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{payment.purpose || "Khoản đóng góp"}</p><p className="text-sm text-slate-500">{payment.fund?.name} · {Number(payment.amount).toLocaleString("vi-VN")} đồng</p>{payment.proof_url && <Button variant="outline" size="sm" onClick={() => void openProof(payment)}>Xem minh chứng</Button>}</div><div className="flex items-center gap-2"><Badge>{labels[payment.status]}</Badge>{canManage(payment.conference_id) && payment.status === "pending" && <><Button size="sm" disabled={!!reviewingId} onClick={() => void reviewPayment(payment, "accepted")}>Chấp nhận</Button><Button size="sm" variant="outline" disabled={!!reviewingId} onClick={() => void reviewPayment(payment, "rejected")}>Từ chối</Button></>}</div></div>)}</div>}</Card>
    </>}
  </div>;
}
