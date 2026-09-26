import { fetchAll } from '@/lib/fetchAll';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/useAuth';
import { useRouter } from '@/context/useRouter';
import { Card } from '@/components/ui/Card';
import { showToast } from '@/components/ui/toastStore';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string } | null;
}

const actionLabels: Record<string, string> = {
  'conference.ownership_transferred': 'Chuyển chủ hội thảo',
  'conference.created': 'Tạo hội thảo',
  'paper.submitted': 'Nộp bài báo',
  'review.assigned': 'Phân công phản biện',
  'review.completed': 'Hoàn thành phản biện',
  'certificate.issued': 'Cấp chứng nhận',
  'profile.role_changed': 'Thay đổi vai trò',
  'message.support_created': 'Tạo yêu cầu hỗ trợ',
  'message.broadcast_sent': 'Gửi thông báo nội bộ',
};

export function AuditLogsPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  useEffect(() => {
    if (profile && profile.role !== 'admin') navigate('dashboard');
  }, [navigate, profile]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchAll((from, to) => supabase.from('audit_logs').select('id, action, entity_type, entity_id, details, created_at, actor:profiles(full_name)', { count: 'exact' }).order('created_at', { ascending: false }).order('id').range(from, to));
    setLoadError(!!error);
    if (error) showToast('error', 'Không thể tải lịch sử quản trị');
    else setLogs((data ?? []) as unknown as AuditLog[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (profile?.role === 'admin') void load(); }, [load, profile?.role]);

  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))), [logs]);
  const filtered = useMemo(() => logs.filter((log) => {
    const searchable = [actionLabels[log.action] || log.action, log.entity_type, log.actor?.full_name || 'Hệ thống'].join(' ').toLowerCase();
    return (!query || searchable.includes(query.toLowerCase())) && (actionFilter === 'all' || log.action === actionFilter);
  }), [actionFilter, logs, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, totalPages);
  const visibleLogs = filtered.slice((currentPage - 1) * 25, currentPage * 25);

  if (!profile || profile.role !== 'admin') return <div className="py-20 text-center text-sm text-slate-500">Đang chuyển về trang tổng quan...</div>;

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Audit log</h1><p className="mt-1 text-sm text-slate-500">Lịch sử các thao tác quan trọng trong hệ thống.</p></div>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Tìm theo hành động hoặc người thực hiện..." className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" /></div>
      <select value={actionFilter} onChange={(event) => { setActionFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"><option value="all">Tất cả hành động</option>{actions.map((action) => <option key={action} value={action}>{actionLabels[action] || action}</option>)}</select>
    </div>
    <Button variant="outline" disabled={loading} onClick={() => void load()}>Làm mới</Button>
    {loadError && <p role="alert" className="text-rose-700">Không thể tải lịch sử. Hãy thử lại.</p>}
    {loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" /></div> : filtered.length === 0 ? <Card className="p-12 text-center"><ClipboardList className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 text-sm text-slate-500">Chưa có hoạt động phù hợp</p></Card> : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 font-medium">Thời gian</th><th className="px-4 py-3 font-medium">Hành động</th><th className="px-4 py-3 font-medium">Người thực hiện</th><th className="px-4 py-3 font-medium">Đối tượng</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleLogs.map((log) => <tr key={log.id} className="hover:bg-slate-50"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(log.created_at).toLocaleString('vi-VN')}</td><td className="px-4 py-3 font-medium text-slate-900"><button className="text-left hover:underline" onClick={() => setSelected(log)}>{actionLabels[log.action] || log.action}</button></td><td className="px-4 py-3 text-slate-600">{log.actor?.full_name || 'Hệ thống'}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs text-teal-700"><ShieldCheck className="h-3.5 w-3.5" />{log.entity_type}</span></td></tr>)}</tbody></table></div></Card>}
    <div className="flex items-center justify-between"><span>{filtered.length} hoạt động · Trang {currentPage}/{totalPages}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</Button><Button variant="outline" disabled={loading || currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Tiếp</Button></div></div>
    <Modal open={!!selected} onClose={() => setSelected(null)} title="Chi tiết hoạt động">{selected && <div className="space-y-3"><p>Mã đối tượng: {selected.entity_id || '—'}</p><pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs">{JSON.stringify(selected.details, null, 2)}</pre></div>}</Modal>
  </div>;
}
