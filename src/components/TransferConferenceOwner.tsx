import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { showToast } from '@/components/ui/toastStore';

export function TransferConferenceOwner({ conferenceId, ownerId, onTransferred }: {
  conferenceId: string; ownerId: string; onTransferred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [owners, setOwners] = useState<{ id: string; full_name: string; organization: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  async function loadOwners() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fetchAll((from, to) => supabase.from('profiles').select('id, full_name, organization', { count: 'exact' }).in('role', ['admin', 'organizer']).neq('id', ownerId).order('full_name').order('id').range(from, to));
      if (result.error) throw result.error;
      setOwners(result.data ?? []); setSelected(''); setSearch(''); setOpen(true);
    } catch { showToast('error', 'Không thể tải danh sách chủ hội thảo'); }
    finally { setBusy(false); }
  }
  async function transfer() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('transfer_conference_ownership', { conference_id: conferenceId, new_owner_id: selected, expected_owner_id: ownerId });
      if (error) throw error;
      setOpen(false); showToast('success', 'Đã chuyển chủ hội thảo và ghi lịch sử'); onTransferred();
    } catch (error) { showToast('error', (error as { message?: string }).message || 'Chuyển chủ hội thảo thất bại'); }
    finally { setBusy(false); }
  }
  const candidates = owners.filter(owner => `${owner.full_name} ${owner.organization}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><Button variant="outline" disabled={busy} onClick={() => void loadOwners()}>Chuyển chủ hội thảo</Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Chuyển chủ hội thảo">
      <div className="space-y-4 text-slate-800">
        <p>Chủ mới sẽ có quyền quản lý hội thảo. Chủ cũ không còn quyền từ việc sở hữu; quyền admin hoặc staff hiện có vẫn áp dụng.</p>
        <input aria-label="Tìm chủ mới" className="w-full rounded-lg border p-2" placeholder="Tìm theo tên hoặc đơn vị" value={search} onChange={e => setSearch(e.target.value)} disabled={busy} />
        <label className="block">Chủ mới<select className="mt-2 w-full rounded-lg border p-2" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Chọn admin hoặc ban tổ chức</option>{owners.filter(owner => owner.id === selected || candidates.includes(owner)).map(owner => <option key={owner.id} value={owner.id}>{owner.full_name} — {owner.organization}</option>)}</select></label>
        {!candidates.length && <p>Không có tài khoản phù hợp.</p>}
        <div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Hủy</Button><Button disabled={busy || !selected} onClick={() => void transfer()}>{busy ? 'Đang chuyển...' : 'Xác nhận chuyển chủ'}</Button></div>
      </div>
    </Modal></>;
}
