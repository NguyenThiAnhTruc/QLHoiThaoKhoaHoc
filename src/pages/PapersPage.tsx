import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, FileText, Calendar, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/useAuth';
import { useRouter } from '@/context/useRouter';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { showToast } from '@/components/ui/toastStore';
import {
  PAPER_STATUS_LABELS,
  PAPER_STATUS_COLORS,
  ALL_PAPER_STATUSES,
} from '@/lib/constants';
import type { Paper, PaperStatus } from '@/types';

export function PapersPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaperStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const canSubmit = profile?.role === 'author' || profile?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .rpc('read_papers')
      .select('*, conference:conferences(*), submitted_by:profile_directory(*)')
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error('Failed to load papers:', error);
      showToast('error', `Không thể tải danh sách bài báo: ${error.message}`);
    } else {
      setPapers((data ?? []) as unknown as Paper[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = papers.filter((p) => {
    const matchesSearch = !search || p.title.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  function exportCSV() {
    const csv = [
      ['Tiêu đề', 'Hội thảo', 'Trạng thái', 'Từ khóa', 'Ngày nộp'],
      ...filtered.map((paper) => [
        paper.title,
        paper.conference?.title ?? '',
        PAPER_STATUS_LABELS[paper.status],
        paper.keywords ?? '',
        new Date(paper.created_at).toLocaleDateString('vi-VN'),
      ]),
    ]
      .map((row) => row.map(escapeCSVCell).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'danh-sach-bai-bao.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bài báo khoa học</h1>
          <p className="mt-1 text-sm text-slate-500">Đọc các bài báo đã được chấp nhận và quản lý những bài bạn được cấp quyền.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Xuất CSV
          </Button>
          {canSubmit && (
            <Button onClick={() => navigate('paper-form')}>
              <Plus className="h-4 w-4" /> Nộp bài báo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm bài báo..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as PaperStatus | 'all');
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        >
          <option value="all">Tất cả trạng thái</option>
          {ALL_PAPER_STATUSES.map((s) => (
            <option key={s} value={s}>{PAPER_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Không tìm thấy bài báo nào</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {paginated.map((paper) => (
            <button
              key={paper.id}
              onClick={() => navigate('paper-detail', { id: paper.id })}
              className="block w-full rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-teal-300"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900">{paper.title}</h3>
                  <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{paper.abstract}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {paper.conference?.title ?? 'N/A'}
                    </span>
                    {paper.keywords && (
                      <span className="text-slate-400">Từ khóa: {paper.keywords}</span>
                    )}
                  </div>
                </div>
                <Badge className={PAPER_STATUS_COLORS[paper.status]}>
                  {PAPER_STATUS_LABELS[paper.status]}
                </Badge>
              </div>
            </button>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Trước
              </Button>
              <span className="text-sm text-slate-500">
                Trang {page}/{totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page === totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                Sau
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function escapeCSVCell(value: string) {
  const text = value.replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}
