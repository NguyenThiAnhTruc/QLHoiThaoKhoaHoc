import { useCallback, useEffect, useState } from "react";
import { Award, Plus, Download, Calendar, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from '@/context/useConferenceAccess';
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import { CERTIFICATE_TYPE_LABELS, ROLE_LABELS } from "@/lib/constants";
import { escapeCertificateText } from '@/lib/certificatePrint';
import type { Certificate, UserRole } from "@/types";

interface EligibleRecipient {
  user_id: string;
  full_name: string;
  role: UserRole;
}

export function CertificatesPage() {
  const { profile } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const { conferences, canManage } = useConferenceAccess();
  const [loading, setLoading] = useState(true);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [selectedConf, setSelectedConf] = useState("");
  const [participants, setParticipants] = useState<EligibleRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [certType, setCertType] = useState<"attendance" | "presentation">(
    "attendance",
  );
  const [issuing, setIssuing] = useState(false);

  const canIssue = conferences.length > 0;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const query = supabase
      .from("certificates")
      .select("*, user:profile_directory(*), conference:conferences(*)")
      .order("issued_at", { ascending: false });

    const { data, error } = await query;
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
    if (!selectedConf || !issueModalOpen) { setLoadingRecipients(false); return; }
    setLoadingRecipients(true);
    void supabase.rpc('certificate_eligible_recipients', {
      conf_id: selectedConf, cert_type: certType,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) showToast('error', 'Không thể tải danh sách người đủ điều kiện nhận chứng nhận');
      else setParticipants((data ?? []) as EligibleRecipient[]);
      setLoadingRecipients(false);
    });
    return () => { cancelled = true; };
  }, [selectedConf, certType, issueModalOpen]);

  async function handleIssue() {
    if (issuing) return;
    if (!canManage(selectedConf)) {
      showToast('error', 'Bạn không có quyền cấp chứng nhận cho hội thảo này');
      return;
    }
    const ids = selectedUsers.length ? selectedUsers : (selectedUser ? [selectedUser] : []);
    if (loadingRecipients || !selectedConf || !ids.length) {
      showToast("error", "Vui lòng chọn đầy đủ thông tin");
      return;
    }
    setIssuing(true);
    try {
    const { data: issued, error } = await supabase.rpc("issue_certificates_bulk", {
      conf_id: selectedConf, cert_type: certType, recipient_ids: ids,
    });
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

  function downloadCertificate(cert: Certificate) {
    const certWindow = window.open("", "_blank");
    if (!certWindow) return;
    const conf = cert.conference;
    const user = cert.user;
    certWindow.document.write(`
      <html>
      <head>
        <title>Chứng nhận - ${escapeCertificateText(user?.full_name)}</title>
        <style>
          @page { size: landscape; margin: 0; }
          body { margin: 0; padding: 40px; font-family: 'Times New Roman', serif; }
          .cert {
            border: 8px double #0f766e;
            padding: 60px;
            text-align: center;
            background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 50%, #f0fdfa 100%);
            min-height: 500px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          h1 { font-size: 36px; color: #0f766e; margin-bottom: 10px; }
          h2 { font-size: 22px; color: #334155; font-weight: normal; margin-bottom: 30px; }
          .name { font-size: 32px; color: #1e293b; margin: 20px 0; font-weight: bold; }
          .conf-title { font-size: 24px; color: #334155; margin: 10px 0; }
          .type { font-size: 18px; color: #64748b; margin: 20px 0; }
          .date { font-size: 16px; color: #64748b; margin-top: 30px; }
          .number { font-size: 12px; color: #94a3b8; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="cert">
          <h1>GIẤY CHỨNG NHẬN</h1>
          <h2>${CERTIFICATE_TYPE_LABELS[cert.certificate_type] === "Tham dự" ? "THAM DỰ HỘI THẢO" : "BÁO CÁO KHOA HỌC"}</h2>
          <p>Chứng nhận rằng:</p>
          <div class="name">${escapeCertificateText(user?.full_name)}</div>
          <p>Đơn vị: ${escapeCertificateText(user?.organization)}</p>
          <p>Đã ${CERTIFICATE_TYPE_LABELS[cert.certificate_type] === "Tham dự" ? "tham dự" : "trình bày báo cáo tại"} hội thảo:</p>
          <div class="conf-title">${escapeCertificateText(conf?.title)}</div>
          <p>Thời gian: ${conf ? new Date(conf.start_date).toLocaleDateString("vi-VN") : ""} - ${conf ? new Date(conf.end_date).toLocaleDateString("vi-VN") : ""}</p>
          <p>Địa điểm: ${escapeCertificateText(conf?.location)}</p>
          <div class="date">Ngày cấp: ${new Date(cert.issued_at).toLocaleDateString("vi-VN")}</div>
          <div class="number">Số: ${escapeCertificateText(cert.certificate_number)}</div>
        </div>
        <script>window.onload = () => window.print();</script>
      </body>
      </html>
    `);
    certWindow.document.close();
  }

  return (
    <div className="space-y-6">
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

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : certificates.length === 0 ? (
        <Card className="p-12 text-center">
          <Award className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Chưa có chứng nhận nào</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {certificates.map((cert) => (
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
                    onClick={() => downloadCertificate(cert)}
                  >
                    <Download className="h-3.5 w-3.5" /> In
                  </Button>
                </div>
                <p className="text-xs text-slate-400 font-mono pt-1">
                  Số: {cert.certificate_number}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

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
            onChange={(e) => { setSelectedUser(''); setSelectedUsers([]); setParticipants([]); setSelectedConf(e.target.value); }}
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
            label="Người nhận"
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
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
          {participants.length > 0 && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => setSelectedUsers(participants.map((p) => p.user_id))}>Chọn tất cả đủ điều kiện</Button><Button type="button" variant="outline" onClick={() => setSelectedUsers([])}>Bỏ chọn</Button><span className="text-sm text-slate-500">Đã chọn {selectedUsers.length} người</span></div>}
          <p className="text-sm text-slate-500">
            {certType === 'attendance' ? 'Chỉ người đã điểm danh mới đủ điều kiện nhận chứng nhận tham dự.' : 'Cần đã điểm danh và là diễn giả của phiên đã kết thúc, gắn với bài báo được chấp nhận.'}
          </p>
          {selectedConf && <p className="text-sm text-slate-500">{loadingRecipients ? 'Đang tải người đủ điều kiện...' : participants.length === 0 ? 'Không có người đủ điều kiện chưa được cấp loại chứng nhận này.' : `${participants.length} người đủ điều kiện`}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" disabled={issuing} onClick={() => setIssueModalOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleIssue} disabled={issuing || loadingRecipients || (!selectedUser && !selectedUsers.length)}>
              {issuing ? "Đang cấp..." : "Cấp"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
