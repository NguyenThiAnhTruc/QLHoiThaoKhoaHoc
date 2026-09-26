import { useEffect, useState } from 'react';
import { useAuth } from '@/context/useAuth';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useRouter } from '@/context/useRouter';
import { REVIEW_STATUS_LABELS } from '@/lib/constants';
import type { ReviewStatus } from '@/types';

export function ReviewerDashboard() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    const states: ReviewStatus[] = ['assigned', 'in_progress', 'completed', 'declined'];
    void Promise.all(states.map(status => supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('reviewer_id', profile?.id ?? '').eq('status', status)))
      .then(results => { if (!active) return; setError(results.some(r => !!r.error)); setCounts(Object.fromEntries(states.map((s, i) => [s, results[i].count ?? 0]))); setLoading(false); });
    return () => { active = false; };
  }, [profile?.id, reload]);
  return <div className="space-y-6">
    <header><p className="text-sm font-medium text-teal-700">KHÔNG GIAN PHẢN BIỆN</p><h1 className="mt-1 text-2xl font-bold">Xin chào, {profile?.full_name}</h1><p className="mt-2 text-slate-500">Theo dõi lời mời, nhận phân công và hoàn thành đánh giá bài báo.</p></header>
    {loading ? <p>Đang tải dữ liệu...</p> : error ? <Card className="p-5"><p role="alert">Không thể tải thống kê phản biện.</p><Button onClick={() => setReload(v => v + 1)}>Thử lại</Button></Card> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(counts).map(([status, count]) => <Card key={status} className="p-5"><p className="text-3xl font-bold">{count}</p><p className="mt-2 text-slate-500">{REVIEW_STATUS_LABELS[status as ReviewStatus]}</p></Card>)}</div>}
    <Button onClick={() => navigate('reviews')}>Mở phản biện được giao</Button>
  </div>;
}
