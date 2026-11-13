import QRCode from "qrcode";
import { exportExcel } from "@/lib/exportExcel";
import { useCallback, useEffect, useState } from "react";
import { Award, Plus, Download, Calendar, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from '@/context/useConferenceAccess';
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import { CERTIFICATE_TYPE_LABELS, ROLE_LABELS } from "@/lib/constants";
import { fetchAll } from '@/lib/fetchAll';
import { certificateOrganization, renderCertificate } from '@/lib/certificatePrint';
import defaultSealAsset from '@/assets/con-dau.png';
import { PostSeminarStatus } from '@/components/PostSeminarStatus';
import type { Certificate, Paper, PaperAuthor, UserRole } from "@/types";

import { Pagination } from "@/components/ui/Pagination";
import { listPage, normalizeSearch } from "@/lib/listPage";

interface EligibleRecipient {
  user_id: string;
  full_name: string;
  role: UserRole;
}

export function CertificatesPage() {
  const { profile } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const { conferences, canManage } = useConferenceAccess();
  const [seal, setSeal] = useState(() => { try { return localStorage.getItem('certificate-seal') ?? ''; } catch { return ''; } });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [conferenceFilter, setConferenceFilter] = useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[search,conferenceFilter]);
  const query=normalizeSearch(search);
  const visibleCertificates = certificates.filter((cert) => (!conferenceFilter || cert.conference_id === conferenceFilter) && (!query || [cert.user?.full_name,cert.certificate_number,cert.conference?.title].some(value=>normalizeSearch(value ?? "").includes(query))));
  const pagination=listPage(visibleCertificates,page,12);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [selectedConf, setSelectedConf] = useState("");
  const [participants, setParticipants] = useState<EligibleRecipient[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [existingPaperCertificates, setExistingPaperCertificates] = useState<Certificate[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [certType, setCertType] = useState<"attendance" | "presentation">(
    "attendance",
  );
  const [issuing, setIssuing] = useState(false);
  const [confirming, setConfirming] = useState<Certificate | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirmOrganization, setConfirmOrganization] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [reviewing, setReviewing] = useState<Certificate | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const [revoking,setRevoking]=useState<Certificate|null>(null);
  const [revokeReason,setRevokeReason]=useState("");
  const [revokeBusy,setRevokeBusy]=useState(false);

  async function revoke(){
    if(!revoking || revokeBusy)return;
    setRevokeBusy(true);
    try{const {error}=await supabase.rpc("revoke_certificate",{target_certificate_id:revoking.id,reason:revokeReason.trim()});if(error)throw error;showToast("success","Đã thu hồi chứng nhận");setRevoking(null);await load();}
    catch{showToast("error","Không thể thu hồi. Kiểm tra quyền, kết nối và bản cập nhật database.");}
    finally{setRevokeBusy(false);}
  }

  const canIssue = conferences.length > 0;

  const load = useCallback(async (background = false) => {
    if (!profile?.id) return;
    if (!background) setLoading(true);
    setLoadError("");
    const { data, error } = await fetchAll((from, to) => supabase
      .from("certificates")
      .select("*, user:profile_directory!certificates_user_id_fkey(*), conference:conferences(*)", { count: "exact" })
      .order("issued_at", { ascending: false }).order("id").range(from, to));
    if (error) {
      if (!background) {
        setCertificates([]);
        setLoadError(error.message || "Không thể tải danh sách chứng nhận");
        showToast("error", "Không thể tải danh sách chứng nhận");
      }
    } else {
      const rows = (data ?? []) as unknown as Certificate[];
      const paperIds = [...new Set(rows.map((certificate) => certificate.paper_id).filter((id): id is string => Boolean(id)))];
      if (paperIds.length) {
        const papersResult = await supabase.from("papers").select("*").in("id", paperIds);
        if (papersResult.error) {
          showToast("error", "Không thể tải thông tin bài báo trên chứng nhận");
        } else {
          const papersById = new Map((papersResult.data ?? []).map((paper) => [paper.id, paper]));
          rows.forEach((certificate) => { certificate.paper = papersById.get(certificate.paper_id ?? ""); });
          const { data: authorRows, error: authorsError } = await supabase
            .from("paper_authors")
            .select("paper_id,user_id,author_order")
            .in("paper_id", paperIds)
            .order("author_order");
          if (authorsError) {
            showToast("error", "Không thể tải danh sách tác giả trên chứng nhận");
          } else {
            const authorIds = [...new Set((authorRows ?? []).map((author) => author.user_id))];
            const { data: authorProfiles, error: profilesError } = authorIds.length
              ? await supabase.from("profile_directory").select("id,full_name").in("id", authorIds)
              : { data: [], error: null };
            if (profilesError) {
              showToast("error", "Không thể tải tên đồng tác giả trên chứng nhận");
            } else {
              const namesById = new Map((authorProfiles ?? []).map((author) => [author.id, author.full_name]));
              rows.forEach((certificate) => {
                if (!certificate.paper) return;
                const names = (authorRows ?? [])
                  .filter((author) => author.paper_id === certificate.paper_id)
                  .sort((left, right) => left.author_order - right.author_order)
                  .map((author) => namesById.get(author.user_id))
                  .filter((name): name is string => Boolean(name));
                const submitterName = certificate.user?.full_name;
                certificate.paper.authors = [
                  ...(submitterName && !names.includes(submitterName)
                    ? [{ user: { full_name: submitterName } } as PaperAuthor]
                    : []),
                  ...names.map((name) => ({ user: { full_name: name } }) as PaperAuthor),
                ];
              });
            }
          }
        }
      }
      setCertificates(rows);
    }
    if (!background) setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile?.id) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const channel = supabase
      .channel(`certificates-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "certificates" }, refresh)
      .subscribe();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [load, profile?.id]);

  useEffect(() => {
    let cancelled = false;
    setSelectedUser(""); setSelectedUsers([]);
    setParticipants([]);
    setPapers([]);
    setExistingPaperCertificates([]);

    if (!selectedConf || !issueModalOpen) { setLoadingRecipients(false); return; }
    setLoadingRecipients(true);
    void Promise.all([
      certType === 'presentation'
        ? (selectedPaperId ? fetchAll((from, to) => supabase.rpc('paper_certificate_recipients', { conf_id: selectedConf, target_paper_id: selectedPaperId }, { count: 'exact' }).order('user_id').range(from, to)) : Promise.resolve({ data: [], error: null }))
        : fetchAll((from, to) => supabase.rpc('certificate_eligible_recipients', { conf_id: selectedConf, cert_type: certType }, { count: 'exact' }).order('user_id').range(from, to)),
      fetchAll((from, to) => supabase.from("papers").select("*", { count: "exact" }).eq("conference_id", selectedConf).eq("status", "accepted").order("title").order("id").range(from, to)),
      certType === 'presentation' && selectedPaperId
        ? supabase
            .from("certificates")
            .select("*, user:profile_directory!certificates_user_id_fkey(*), conference:conferences(*)")
            .eq("conference_id", selectedConf)
            .eq("paper_id", selectedPaperId)
            .eq("certificate_type", "presentation")
            .order("issued_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]).then(([recipientResult, paperResult, existingResult]) => {
      if (cancelled) return;
      if (recipientResult.error) showToast('error', 'Không thể tải danh sách người đủ điều kiện nhận chứng nhận');
      else setParticipants((recipientResult.data ?? []) as EligibleRecipient[]);
      if (paperResult.error) showToast("error", "Không thể tải bài báo được chấp nhận");
      setPapers((paperResult.data ?? []) as Paper[]);
      if (existingResult.error) showToast("error", "Không thể kiểm tra chứng nhận đã cấp cho bài báo");
      else setExistingPaperCertificates((existingResult.data ?? []) as unknown as Certificate[]);
      setLoadingRecipients(false);
    }).catch(() => {
      if (!cancelled) { showToast('error', 'Không thể tải người nhận. Vui lòng chọn lại hội thảo để thử lại.'); setLoadingRecipients(false); }
    });
    return () => { cancelled = true; };
  }, [selectedConf, certType, issueModalOpen, selectedPaperId]);

  async function handleIssue() {
    if (issuing) return;
    if (!canManage(selectedConf)) {
      showToast('error', 'Bạn không có quyền cấp chứng nhận cho hội thảo này');
      return;
    }
    const ids = selectedUsers.length ? selectedUsers : (selectedUser ? [selectedUser] : []);
    if (loadingRecipients || !selectedConf || (certType === "attendance" && !ids.length) || (certType === "presentation" && !selectedPaperId)) {
      showToast("error", "Vui lòng chọn đầy đủ thông tin");
      return;
    }
    setIssuing(true);
    try {
    if (certType === "presentation") {
      const { data: currentRecipients, error: recipientError } = await supabase.rpc(
        "paper_certificate_recipients",
        { conf_id: selectedConf, target_paper_id: selectedPaperId },
      );
      if (recipientError) {
        showToast("error", `Không thể kiểm tra người nhận: ${recipientError.message}`);
        return;
      }
      const availableIds = new Set(
        ((currentRecipients ?? []) as Array<{ user_id: string }>).map((recipient) => recipient.user_id),
      );
      const invalidIds = ids.filter((id) => !availableIds.has(id));
      if (invalidIds.length) {
        showToast("error", "Người nhận không còn đủ điều kiện hoặc bài báo đã được cấp chứng nhận. Hãy chọn lại bài báo và người nhận.");
        setSelectedUser("");
        setSelectedUsers([]);
        return;
      }
    }
    const { data: issued, error } = certType === "presentation"
      ? await supabase.rpc("issue_paper_certificates", { conf_id: selectedConf, target_paper_id: selectedPaperId, recipient_ids: participants.map((participant) => participant.user_id) })
      : await supabase.rpc("issue_certificates_bulk", { conf_id: selectedConf, cert_type: certType, recipient_ids: ids });
    if (error) {
      if (error.code === "23505") {
        showToast("error", "Chứng nhận này đã được cấp");
      } else if (error.code === "42501") {
        showToast("error", "Bạn không có quyền cấp chứng nhận cho hội thảo này");
      } else if (error.code === "23514" || error.message.includes("không đủ điều kiện")) {
        showToast("error", "Người nhận chưa đủ điều kiện: bài phải được chấp nhận, hội thảo phải kết thúc và đại diện phải đăng ký tham dự.");
      } else {
        showToast("error", "Cấp chứng nhận thất bại: " + error.message);
      }
    } else {
      const issuedCount = issued ?? 0;
      await load();
      if (issuedCount === 0) {
        showToast("error", "Không tạo được chứng nhận mới. Có thể chứng nhận này đã tồn tại.");
      } else {
        showToast("success", `Đã cấp ${issuedCount} chứng nhận`);
        setIssueModalOpen(false);
      }
    }
    } catch {
      showToast("error", "Không thể cấp chứng nhận. Vui lòng thử lại.");
    } finally {
      setIssuing(false);
    }
  }

  function openConfirmation(cert: Certificate) {
    setConfirming(cert);
    setConfirmationError("");
    setConfirmName(cert.confirmed_name || cert.user?.full_name || profile?.full_name || "");
    setConfirmOrganization(
      cert.confirmed_organization || cert.user?.organization || profile?.organization || "",
    );
  }

  async function submitConfirmation() {
    if (!confirming) return;
    setConfirmationError("");
    if (confirmName.trim().length < 2) {
      setConfirmationError("Họ tên trên chứng nhận phải có ít nhất 2 ký tự.");
      return;
    }
    const { error } = await supabase.rpc("submit_certificate_confirmation", {
      target_certificate_id: confirming.id,
      recipient_name: confirmName.trim(),
      recipient_organization: confirmOrganization.trim(),
    });
    if (error) {
      const message = error.message || "Không thể gửi xác nhận";
      setConfirmationError(`Không thể gửi cho Ban tổ chức: ${message}`);
      showToast("error", message);
      return;
    }
    showToast("success", "Đã gửi thông tin chứng nhận cho Ban tổ chức");
    setConfirming(null);
    await load();
  }

  async function reviewCertificate(approve: boolean) {
    if (!reviewing || reviewBusy) return;
    setReviewError("");
    if (!approve && reviewNote.trim().length < 3) {
      setReviewError("Vui lòng nhập lý do yêu cầu chỉnh sửa (ít nhất 3 ký tự).");
      return;
    }
    setReviewBusy(true);
    const { error } = await supabase.rpc(
      approve ? "approve_certificate_confirmation" : "request_certificate_changes",
      approve
        ? { target_certificate_id: reviewing.id, approval_note: reviewNote.trim() }
        : { target_certificate_id: reviewing.id, change_note: reviewNote.trim() },
    );
    if (error) {
      const message = error.message || "Không thể xử lý chứng nhận";
      setReviewError(`Không thể ${approve ? "duyệt và phát hành" : "yêu cầu chỉnh sửa"}: ${message}`);
      showToast("error", message);
    } else {
      showToast("success", approve ? "Đã duyệt và phát hành chứng nhận" : "Đã yêu cầu tác giả chỉnh sửa");
      setReviewing(null);
      await load();
    }
    setReviewBusy(false);
  }

  async function downloadCertificate(cert: Certificate) {
    if (cert.workflow_status && cert.workflow_status !== "issued") {
      showToast("error", "Chứng nhận chưa được Ban tổ chức phát hành");
      return;
    }
    if(cert.revoked_at){showToast("error","Chứng nhận đã thu hồi");return;}
    let printableSeal = seal;
    if (!printableSeal) {
      try {
        const response = await fetch(new URL(defaultSealAsset, window.location.origin));
        if (!response.ok) throw new Error(`Không tải được ảnh con dấu (${response.status})`);
        const blob = await response.blob();
        printableSeal = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Không đọc được ảnh con dấu"));
          reader.readAsDataURL(blob);
        });
      } catch {
        showToast("error", "Không tải được ảnh con dấu mặc định");
        return;
      }
    }
    const certWindow = window.open("", "_blank");
    if (!certWindow) { showToast("error", "Trình duyệt chặn cửa sổ in. Vui lòng cho phép cửa sổ bật lên và thử lại."); return; }
    let verificationQr: string | undefined;
    const verificationUrl=cert.verification_token?`${window.location.origin}/?certificate=${encodeURIComponent(cert.verification_token)}`:undefined;
    try{if(verificationUrl)verificationQr=await QRCode.toDataURL(verificationUrl,{width:180,margin:1,errorCorrectionLevel:"M"});}
    catch{certWindow.close();showToast("error","Không tạo được mã QR tra cứu");return;}
    const conf = cert.conference;
    const user = cert.user;
    certWindow.document.open();
    certWindow.document.write(renderCertificate({
      name: user?.full_name ?? '', organization: certificateOrganization(user?.organization),
      title: conf?.title ?? '', paper: cert.paper?.title, authorGroup: cert.paper?.author_group,
      authorNames: cert.paper?.authors?.map((author) => author.user?.full_name).filter((name): name is string => Boolean(name)),
      type: cert.certificate_type,
      start: conf?.start_date ?? cert.issued_at, end: conf?.end_date ?? cert.issued_at,
      issued: cert.issued_at, location: conf?.location, number: cert.certificate_number,
      seal: printableSeal, verificationQr, verificationUrl,
    }));
    certWindow.document.close();
    certWindow.onload = () => { certWindow.focus(); certWindow.print(); };
  }

  return (
    <div className="space-y-6">
      {conferenceFilter && canManage(conferenceFilter) && <PostSeminarStatus key={conferenceFilter} conferenceId={conferenceFilter} />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{canIssue ? 'Quản lý chứng nhận' : 'Chứng nhận của tôi'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý và cấp chứng nhận tham dự, báo cáo
          </p>
        </div>
        {canIssue && (
          <Button
            onClick={() => {
              setSelectedConf("");
              setSelectedUser("");
              setParticipants([]);
              setCertType("attendance");
              setIssueModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Cấp chứng nhận
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select label="Lọc chứng nhận theo hội thảo" value={conferenceFilter} onChange={(event) => setConferenceFilter(event.target.value)}><option value="">Tất cả hội thảo</option>{[...new Map(certificates.map((cert) => [cert.conference_id, cert.conference?.title ?? cert.conference_id])).entries()].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select>
        <Button variant="outline" disabled={loading || visibleCertificates.length===0} onClick={()=>exportExcel("chung-nhan",["Số chứng nhận","Người nhận","Hội thảo","Loại","Ngày cấp","Trạng thái"],visibleCertificates.map(cert=>[cert.certificate_number,cert.user?.full_name ?? "",cert.conference?.title ?? "",CERTIFICATE_TYPE_LABELS[cert.certificate_type],new Date(cert.issued_at).toLocaleDateString("vi-VN"),cert.revoked_at?"Đã thu hồi":"Có hiệu lực"]))}>Xuất Excel</Button>
        <Input label="Tìm chứng nhận" placeholder="Họ tên, số chứng nhận, hội thảo" value={search} onChange={event=>setSearch(event.target.value)} />
        <a href="/certificate-template.html" download="mau-chung-nhan.html" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">Tải mẫu chứng nhận để điền</a>
      </div>
      {canIssue && <Card className="p-4"><label className="block text-sm font-medium text-slate-700">Ảnh con dấu cho bản in<input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block text-sm" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { showToast('error', 'Chọn ảnh PNG, JPG hoặc WebP tối đa 2 MB'); return; }
        const reader = new FileReader();
        reader.onload = () => { const value = String(reader.result); setSeal(value); try { localStorage.setItem('certificate-seal', value); } catch { showToast('error', 'Ảnh dùng được trong phiên này nhưng không lưu được trên trình duyệt'); } };
        reader.onerror = () => showToast('error', 'Không đọc được ảnh con dấu');
        reader.readAsDataURL(file);
      }} /></label>{seal && <div className="mt-3 flex items-center gap-3"><img src={seal} alt="Con dấu đã chọn" className="h-24 w-24 object-contain" /><Button variant="outline" onClick={() => { setSeal(''); try { localStorage.removeItem('certificate-seal'); } catch { /* Storage unavailable. */ } }}>Bỏ ảnh con dấu</Button></div>}<p className="mt-2 text-xs text-slate-500">Ảnh được lưu trên trình duyệt này và đưa vào bản in / Lưu PDF. PDF gửi qua email dùng mẫu của máy chủ.</p></Card>}
      {loadError ? (
        <Card className="p-6">
          <p role="alert" className="font-medium text-rose-700">Không thể tải danh sách chứng nhận</p>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>Thử lại</Button>
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : visibleCertificates.length === 0 ? (
        <Card className="p-12 text-center">
          <Award className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Chưa có chứng nhận nào</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pagination.items.map((cert) => (
            <Card key={cert.id} className="overflow-hidden">
              <div className="bg-gradient-to-br from-teal-600 to-blue-700 p-5">
                <Award className="h-8 w-8 text-white/80" />
                <h3 className="mt-2 font-semibold text-white">
                  {cert.conference?.title ?? "N/A"}
                </h3>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <User className="h-4 w-4 text-slate-400" />
                  {cert.user?.full_name ?? "N/A"}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  {new Date(cert.issued_at).toLocaleDateString("vi-VN")}
                </div>
                {cert.certificate_type === "presentation" && cert.paper?.title && (
                  <div className="text-sm text-slate-600">
                    <span className="font-medium">Bài báo:</span> {cert.paper.title}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2">
                  <Badge
                    className={
                      cert.certificate_type === "attendance"
                        ? "bg-teal-100 text-teal-700"
                        : "bg-blue-100 text-blue-700"
                    }
                  >
                    {CERTIFICATE_TYPE_LABELS[cert.certificate_type]}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(cert.revoked_at) || Boolean(cert.workflow_status && cert.workflow_status !== "issued")}
                    onClick={() => downloadCertificate(cert)}
                  >
                    <Download className="h-3.5 w-3.5" /> {cert.workflow_status && cert.workflow_status !== "issued" ? "Chưa phát hành" : "In"}
                  </Button>
                </div>
                {cert.workflow_status && cert.workflow_status !== "issued" && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-semibold">
                      {cert.workflow_status === "submitted"
                        ? "Đã gửi, chờ Ban tổ chức duyệt"
                        : cert.workflow_status === "needs_changes"
                          ? "Cần cập nhật lại thông tin"
                          : "Chờ tác giả xác nhận thông tin"}
                    </p>
                    {cert.review_notes && <p className="mt-1">{cert.review_notes}</p>}
                    {!canManage(cert.conference_id) &&
                      ["pending_confirmation", "needs_changes"].includes(cert.workflow_status) && (
                        <Button size="sm" className="mt-2" onClick={() => openConfirmation(cert)}>
                          Xác nhận và gửi
                        </Button>
                      )}
                    {canManage(cert.conference_id) && cert.workflow_status === "submitted" && (
                      <Button size="sm" className="mt-2" onClick={() => { setReviewNote(""); setReviewError(""); setReviewing(cert); }}>
                        Duyệt hồ sơ
                      </Button>
                    )}
                  </div>
                )}
                {cert.revoked_at && <p className="text-sm font-semibold text-rose-700">Đã thu hồi · {cert.revocation_reason}</p>}
                {cert.verification_token && <a className="block text-sm text-teal-700 underline" href={`/?certificate=${encodeURIComponent(cert.verification_token)}`} target="_blank" rel="noopener noreferrer">Tra cứu chứng nhận</a>}
                {cert.verification_token && !cert.revoked_at && canManage(cert.conference_id) && <Button size="sm" variant="outline" onClick={()=>{setRevokeReason("");setRevoking(cert);}}>Thu hồi</Button>}
                  <p className="text-xs text-slate-400 font-mono pt-1">
                    Số: {cert.certificate_number}{cert.signature_hash ? ` · Mã đối chiếu: ${cert.signature_hash.slice(0, 16)}` : ""}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && <Pagination {...pagination} onChange={setPage} />}

      <Modal open={Boolean(revoking)} onClose={()=>{if(!revokeBusy)setRevoking(null);}} title="Thu hồi chứng nhận"><div className="space-y-4"><p>Thu hồi {revoking?.certificate_number}. Chứng nhận vẫn được lưu để đối chiếu và không thể khôi phục.</p><Input label="Lý do thu hồi" minLength={5} maxLength={1000} value={revokeReason} disabled={revokeBusy} onChange={event=>setRevokeReason(event.target.value)} /><Button disabled={revokeBusy || revokeReason.trim().length<5} onClick={()=>void revoke()}>{revokeBusy?"Đang thu hồi...":"Xác nhận thu hồi"}</Button></div></Modal>
      <Modal open={Boolean(confirming)} onClose={() => { setConfirmationError(""); setConfirming(null); }} title="Xác nhận thông tin chứng nhận">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Kiểm tra chính xác họ tên và đơn vị. Thông tin này sẽ được dùng để phát hành chứng nhận.</p>
          {confirmationError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{confirmationError}</p>}
          <Input label="Họ và tên trên chứng nhận" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} />
          <Input label="Đơn vị công tác" value={confirmOrganization} onChange={(event) => setConfirmOrganization(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(null)}>Hủy</Button>
            <Button onClick={() => void submitConfirmation()}>Gửi cho Ban tổ chức</Button>
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(reviewing)} onClose={() => { if (!reviewBusy) { setReviewError(""); setReviewing(null); } }} title="Duyệt chứng nhận">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Kiểm tra thông tin tác giả đã xác nhận trước khi phát hành.</p>
          {reviewError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{reviewError}</p>}
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p><strong>Họ tên:</strong> {reviewing?.confirmed_name}</p>
            <p><strong>Đơn vị:</strong> {reviewing?.confirmed_organization || "Không có"}</p>
          </div>
          <Input label="Ghi chú" placeholder="Ghi chú duyệt hoặc lý do yêu cầu chỉnh sửa" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={reviewBusy} onClick={() => void reviewCertificate(false)}>Yêu cầu chỉnh sửa</Button>
            <Button disabled={reviewBusy} onClick={() => void reviewCertificate(true)}>Duyệt và phát hành</Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={issueModalOpen}
        onClose={() => { if (!issuing) setIssueModalOpen(false); }}
        title="Cấp chứng nhận"
        size="md"
      >
        <div className="space-y-4">
          <Select
            label="Hội thảo"
            value={selectedConf}
            onChange={(e) => { setSelectedUser(''); setSelectedUsers([]); setParticipants([]); setSelectedPaperId(''); setSelectedConf(e.target.value); }}
            disabled={issuing}
          >
            <option value="">Chọn hội thảo</option>
            {conferences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <Select
            label="Loại chứng nhận"
            value={certType}
            disabled={issuing}
            onChange={(e) => { setSelectedUser(''); setSelectedUsers([]); setParticipants([]); setCertType(e.target.value as "attendance" | "presentation"); }}
          >
            <option value="attendance">Tham dự</option>
            <option value="presentation">Báo cáo</option>
          </Select>
          {certType === "presentation" && <Select label="Bài báo được chứng nhận" value={selectedPaperId} onChange={(event) => { setSelectedUser(""); setSelectedUsers([]); setParticipants([]); setSelectedPaperId(event.target.value); }} disabled={!selectedConf || issuing}>
            <option value="">Chọn bài báo được chấp nhận</option>
            {papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}
          </Select>}
          {certType === "presentation" && selectedPaperId && existingPaperCertificates.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Bài này đã có chứng nhận</p>
              {existingPaperCertificates.map((certificate) => (
                <p key={certificate.id} className="mt-1">
                  {certificate.user?.full_name ?? "Không rõ người nhận"} · {certificate.certificate_number}
                  {certificate.workflow_status && certificate.workflow_status !== "issued"
                    ? ` · ${certificate.workflow_status}`
                    : " · Đã phát hành"}
                </p>
              ))}
            </div>
          )}
          <Select
            label={certType === "presentation" ? "Nhóm tác giả (tự động cấp)" : "Người nhận"}
            value={selectedUser}
            onChange={(e) => { setSelectedUsers([]); setSelectedUser(e.target.value); }}
            disabled={certType === "presentation" || !selectedConf || loadingRecipients || issuing}
          >
            <option value="">Chọn người nhận</option>
            {participants.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.full_name} ({ROLE_LABELS[p.role]})
              </option>
            ))}
          </Select>
          {certType !== "presentation" && participants.length > 0 && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={issuing || loadingRecipients} onClick={() => { setSelectedUser(""); setSelectedUsers(participants.map((p) => p.user_id)); }}>Chọn tất cả đủ điều kiện</Button><Button type="button" variant="outline" onClick={() => { setSelectedUser(""); setSelectedUsers([]); }}>Bỏ chọn</Button><span className="text-sm text-slate-500">Đã chọn {selectedUsers.length || (selectedUser ? 1 : 0)} người</span></div>}
          <p className="text-sm text-slate-500">
            {certType === 'attendance' ? 'Hội thảo phải kết thúc, không bị hủy và người nhận đã điểm danh. Mỗi người được cấp một chứng nhận tham dự.' : 'Hội thảo phải kết thúc, không bị hủy; bài được chấp nhận và từng thành viên tham gia trong nhóm tác giả sẽ nhận một chứng nhận riêng.'}
          </p>
          {selectedConf && <p className="text-sm text-slate-500">{loadingRecipients ? 'Đang tải người đủ điều kiện...' : participants.length === 0 ? certType === "presentation" ? existingPaperCertificates.length > 0 ? 'Các thành viên đủ điều kiện của nhóm đã được cấp chứng nhận.' : 'Chưa có thành viên đủ điều kiện: bài phải được chấp nhận, hội thảo phải kết thúc và thành viên phải được đánh dấu tham gia trong nhóm tác giả.' : 'Không có người đủ điều kiện chưa được cấp loại chứng nhận này.' : `${participants.length} thành viên nhóm đủ điều kiện`}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={issuing} onClick={() => setIssueModalOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleIssue} disabled={issuing || loadingRecipients || (certType === "presentation" && !selectedPaperId) || (certType === "attendance" && !selectedUser && !selectedUsers.length)}>
              {issuing ? "Đang cấp..." : "Cấp"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
