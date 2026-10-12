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
import { renderCertificate } from '@/lib/certificatePrint';
import { PostSeminarStatus } from '@/components/PostSeminarStatus';
import type { Certificate, Paper, UserRole } from "@/types";

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
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [certType, setCertType] = useState<"attendance" | "presentation">(
    "attendance",
  );
  const [issuing, setIssuing] = useState(false);

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

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data, error } = await fetchAll((from, to) => supabase
      .from("certificates")
      .select("*, user:profile_directory(*), conference:conferences(*), paper:papers(*)", { count: "exact" })
      .order("issued_at", { ascending: false }).order("id").range(from, to));
    if (error) {
      showToast("error", "Không thể tải danh sách chứng nhận");
    } else {
      setCertificates((data ?? []) as unknown as Certificate[]);
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setSelectedUser(""); setSelectedUsers([]);
    setParticipants([]);
    setPapers([]);

    if (!selectedConf || !issueModalOpen) { setLoadingRecipients(false); return; }
    setLoadingRecipients(true);
    void Promise.all([
      certType === 'presentation'
        ? (selectedPaperId ? fetchAll((from, to) => supabase.rpc('paper_certificate_recipients', { conf_id: selectedConf, target_paper_id: selectedPaperId }, { count: 'exact' }).order('user_id').range(from, to)) : Promise.resolve({ data: [], error: null }))
        : fetchAll((from, to) => supabase.rpc('certificate_eligible_recipients', { conf_id: selectedConf, cert_type: certType }, { count: 'exact' }).order('user_id').range(from, to)),
      fetchAll((from, to) => supabase.from("papers").select("*", { count: "exact" }).eq("conference_id", selectedConf).eq("status", "accepted").order("title").order("id").range(from, to)),
    ]).then(([recipientResult, paperResult]) => {
      if (cancelled) return;
      if (recipientResult.error) showToast('error', 'Không thể tải danh sách người đủ điều kiện nhận chứng nhận');
      else setParticipants((recipientResult.data ?? []) as EligibleRecipient[]);
      if (paperResult.error) showToast("error", "Không thể tải bài báo được chấp nhận");
      setPapers((paperResult.data ?? []) as Paper[]);
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
    if (loadingRecipients || !selectedConf || !ids.length || (certType === "presentation" && !selectedPaperId)) {
      showToast("error", "Vui lòng chọn đầy đủ thông tin");
      return;
    }
    setIssuing(true);
    try {
    const { data: issued, error } = certType === "presentation"
      ? await supabase.rpc("issue_paper_certificates", { conf_id: selectedConf, target_paper_id: selectedPaperId, recipient_ids: ids })
      : await supabase.rpc("issue_certificates_bulk", { conf_id: selectedConf, cert_type: certType, recipient_ids: ids });
    if (error) {
      if (error.code === "23505") {
        showToast("error", "Chứng nhận này đã được cấp");
      } else {
        showToast("error", "Cấp chứng nhận thất bại: " + error.message);
      }
    } else {
      showToast("success", `Đã cấp ${issued ?? 0} chứng nhận`);
      setIssueModalOpen(false);
      load();
    }
    } catch {
      showToast("error", "Không thể cấp chứng nhận. Vui lòng thử lại.");
    } finally {
      setIssuing(false);
    }
  }

  async function downloadCertificate(cert: Certificate) {
    if(cert.revoked_at){showToast("error","Chứng nhận đã thu hồi");return;}
    if (cert.pdf_path && !seal && !cert.verification_token) {
      const {data,error}=await supabase.storage.from("certificate-pdfs").createSignedUrl(cert.pdf_path,60,{download:true});
      if(error || !data){showToast("error","Không thể tải PDF chứng nhận");return;}
      const link=document.createElement("a");link.href=data.signedUrl;link.target="_blank";link.rel="noopener noreferrer";link.click();return;
    }
    const certWindow = window.open("", "_blank");
    if (!certWindow) { showToast("error", "Trình duyệt chặn cửa sổ in. Vui lòng cho phép cửa sổ bật lên và thử lại."); return; }
    let verificationQr: string | undefined;
    const verificationUrl=cert.verification_token?`${window.location.origin}/?certificate=${encodeURIComponent(cert.verification_token)}`:undefined;
    try{if(verificationUrl)verificationQr=await QRCode.toDataURL(verificationUrl,{width:180,margin:1,errorCorrectionLevel:"M"});}
    catch{certWindow.close();showToast("error","Không tạo được mã QR tra cứu");return;}
    const conf = cert.conference;
    const user = cert.user;
    certWindow.onload = () => { certWindow.focus(); certWindow.print(); };
    certWindow.document.write(renderCertificate({
      name: user?.full_name ?? '', organization: user?.organization,
      title: conf?.title ?? '', paper: cert.paper?.title, type: cert.certificate_type,
      start: conf?.start_date ?? cert.issued_at, end: conf?.end_date ?? cert.issued_at,
      issued: cert.issued_at, location: conf?.location, number: cert.certificate_number,
      minutes: cert.attendance_minutes, seal, verificationQr, verificationUrl,
    }));
    certWindow.document.close();
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
      {loading ? (
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
                    disabled={Boolean(cert.revoked_at)}
                    onClick={() => downloadCertificate(cert)}
                  >
                    <Download className="h-3.5 w-3.5" /> In
                  </Button>
                </div>
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
          {certType === "presentation" && <Select label="Bài báo được chứng nhận" value={selectedPaperId} onChange={(event) => { setSelectedUser(""); setSelectedUsers([]); setParticipants([]); setSelectedPaperId(event.target.value); }} disabled={!selectedConf || issuing}>
            <option value="">Chọn bài báo được chấp nhận</option>
            {papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}
          </Select>}
          <Select
            label="Người nhận"
            value={selectedUser}
            onChange={(e) => { setSelectedUsers([]); setSelectedUser(e.target.value); }}
            disabled={!selectedConf || loadingRecipients || issuing}
          >
            <option value="">Chọn người nhận</option>
            {participants.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.full_name} ({ROLE_LABELS[p.role]})
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
          {participants.length > 0 && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={issuing || loadingRecipients} onClick={() => { setSelectedUser(""); setSelectedUsers(participants.map((p) => p.user_id)); }}>Chọn tất cả đủ điều kiện</Button><Button type="button" variant="outline" onClick={() => setSelectedUsers([])}>Bỏ chọn</Button><span className="text-sm text-slate-500">Đã chọn {selectedUsers.length} người</span></div>}
          <p className="text-sm text-slate-500">
            {certType === 'attendance' ? 'Hội thảo phải kết thúc, không bị hủy và người nhận đã điểm danh. Mỗi người được cấp một chứng nhận tham dự.' : 'Hội thảo phải kết thúc, không bị hủy; người nhận đã điểm danh, là tác giả tham gia của bài được chấp nhận và có phiên báo cáo đã kết thúc. Cấp riêng cho từng bài.'}
          </p>
          {selectedConf && <p className="text-sm text-slate-500">{loadingRecipients ? 'Đang tải người đủ điều kiện...' : participants.length === 0 ? 'Không có người đủ điều kiện chưa được cấp loại chứng nhận này.' : `${participants.length} người đủ điều kiện`}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={issuing} onClick={() => setIssueModalOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleIssue} disabled={issuing || loadingRecipients || (certType === "presentation" && !selectedPaperId) || (!selectedUser && !selectedUsers.length)}>
              {issuing ? "Đang cấp..." : "Cấp"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
