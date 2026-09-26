import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/useAuth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { showToast } from '@/components/ui/toastStore';

interface RequestRow {
  id: string;
  user_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  created_at: string;
  applicant?: { full_name: string; organization: string } | null;
}
const labels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối' };

export function OrganizerRequests({ admin = false, onReviewed }: { admin?: boolean; onReviewed?: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ row: RequestRow; approve: boolean } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        let query = supabase.from('organizer_requests').select(admin
          ? '*, applicant:profiles!organizer_requests_user_id_fkey(full_name, organization)' : '*');
        if (!admin) query = query.eq('user_id', profile?.id ?? '');
        const result = await query.order('created_at', { ascending: false });
        if (result.error) throw result.error;
        if (!cancelled) setRows((result.data ?? []) as unknown as RequestRow[]);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [admin, profile?.id, reload]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await supabase.rpc('submit_organizer_request', { request_reason: reason.trim() });
      if (result.error) throw result.error;
      setReason('');
      setReload((value) => value + 1);
      showToast('success', 'Đã gửi yêu cầu đến quản trị viên');
    } catch (err) { showToast('error', err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Không thể gửi yêu cầu'); }
    finally { setBusy(false); }
  }

  async function review() {
    if (!decision || busy) return;
    setBusy(true);
    try {
      const result = await supabase.rpc('review_organizer_request', { request_id: decision.row.id, approve: decision.approve, decision_note: note.trim() });
      if (result.error) throw result.error;
      setDecision(null);
      setReload((value) => value + 1);
      onReviewed?.();
      showToast('success', 'Đã xử lý yêu cầu');
    } catch (err) { showToast('error', (err as { message?: string })?.message ?? 'Không thể xử lý yêu cầu'); }
    finally { setBusy(false); }
  }

  const canSubmit = !admin && ['author', 'participant'].includes(profile?.role ?? '') && !rows.some((row) => row.status === 'pending');
  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold text-slate-900">Yêu cầu làm Ban tổ chức{admin ? ` (${rows.filter((row) => row.status === 'pending').length} chờ duyệt)` : ''}</h2>
      <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => { setReload((value) => value + 1); if (!admin) void refreshProfile(); }}>Làm mới</Button>
    </div>
    {loading ? <p className="text-sm text-slate-500">Đang tải yêu cầu...</p> : error ? <p role="alert" className="text-sm text-rose-700">Không thể tải lịch sử yêu cầu. Bạn vẫn có thể gửi yêu cầu mới; nếu gửi thất bại, hãy kiểm tra migration yêu cầu Ban tổ chức trên Supabase.</p> : null}
    {canSubmit && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="text-sm text-slate-500">Nêu đơn vị, nhu cầu tổ chức hội thảo và thông tin để admin xem xét cấp quyền.</p>
        <Textarea label="Lý do xin làm Ban tổ chức" required minLength={10} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
        <Button type="submit" disabled={busy || reason.trim().length < 10}>{busy ? 'Đang gửi...' : 'Gửi yêu cầu'}</Button>
    </form>}
    {!admin && profile && !['author', 'participant', 'organizer'].includes(profile.role) && <p className="text-sm text-slate-500">Vai trò hiện tại ({profile.role}) không thể gửi yêu cầu làm Ban tổ chức.</p>}
    {!error && !loading && <>
      {!admin && profile?.role === 'organizer' && <p className="text-sm text-teal-700">Bạn đã có quyền Ban tổ chức.</p>}
      {rows.length === 0 && <p className="text-sm text-slate-500">Chưa có yêu cầu nào.</p>}
      <div className="space-y-3">{rows.map((row) => <div key={row.id} className="space-y-2 rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{admin ? row.applicant?.full_name || row.user_id : 'Yêu cầu của bạn'}</p><span className={`text-sm font-medium ${row.status === 'approved' ? 'text-teal-700' : row.status === 'rejected' ? 'text-rose-700' : 'text-amber-700'}`}>{labels[row.status]}</span></div>
        {admin && <p className="text-xs text-slate-500">{row.applicant?.organization || 'Chưa cập nhật đơn vị'}</p>}
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{row.reason}</p>
        <p className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString('vi-VN')}</p>
        {row.review_note && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">Phản hồi: {row.review_note}</p>}
        {admin && row.status === 'pending' && <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => { setNote(''); setDecision({ row, approve: true }); }}>Duyệt</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setNote(''); setDecision({ row, approve: false }); }}>Từ chối</Button></div>}
      </div>)}</div>
    </>}
    <Modal open={!!decision} onClose={() => { if (!busy) setDecision(null); }} title={decision?.approve ? 'Duyệt quyền Ban tổ chức' : 'Từ chối yêu cầu'}>
      <div className="space-y-4"><p className="text-sm text-slate-600">{decision?.approve ? 'Sau khi xác nhận, tài khoản sẽ được cấp vai trò Ban tổ chức.' : 'Nhập lý do để người gửi biết cần bổ sung thông tin gì.'}</p><Textarea label={decision?.approve ? 'Ghi chú (không bắt buộc)' : 'Lý do từ chối'} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDecision(null)}>Hủy</Button><Button disabled={busy || (!decision?.approve && !note.trim())} onClick={() => void review()}>{busy ? 'Đang xử lý...' : 'Xác nhận'}</Button></div></div>
    </Modal>
  </Card>;
}
