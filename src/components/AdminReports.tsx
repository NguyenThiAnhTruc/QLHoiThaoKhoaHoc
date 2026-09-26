import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { buildReport, presetRange, reportCsv, type ReportData, type ReportFilter } from '@/lib/reportAnalytics';
import { CONFERENCE_STATUS_LABELS, PAPER_STATUS_LABELS, ROLE_LABELS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/context/useAuth';

const paperLabels: Record<string, string> = { ...PAPER_STATUS_LABELS, camera_ready: 'Camera-ready' };
const colors = ['#0d9488', '#3b82f6', '#f59e0b', '#8b5cf6', '#f43f5e', '#64748b'];
const number = (value: number | null, suffix = '') => value === null ? 'Chưa có dữ liệu' : `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}${suffix}`;
type Metric = { label: string; value: number | null; suffix?: string };

export function AdminReports() {
  const { profile } = useAuth();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [preset, setPreset] = useState('30');
  const [filter, setFilter] = useState<ReportFilter>(() => ({ ...presetRange('30'), conference: '', status: '' }));
  const [draft, setDraft] = useState(filter);
  const [dateError, setDateError] = useState('');
  const [lineSeries, setLineSeries] = useState<'papers' | 'registrations'>('papers');
  const [ranking, setRanking] = useState<'registrations' | 'papers' | 'rate'>('registrations');
  useEffect(() => {
    if (profile?.role !== 'admin') return;
    let cancelled = false;
    setLoading(true); setError('');
    void (async () => {
      try {
        const results = await Promise.all([
          fetchAll((from, to) => supabase.from('conferences').select('*', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('papers').select('id, conference_id, status, created_at', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('participants').select('id, conference_id, user_id, registered_at, attended', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('certificates').select('id, conference_id, user_id, certificate_type, issued_at', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('profiles').select('id, role, created_at', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('reviews').select('id, paper_id, status, assigned_at, completed_at', { count: 'exact' }).order('id').range(from, to)),
          fetchAll((from, to) => supabase.from('reporting_events').select('*', { count: 'exact' }).order('id').range(from, to)),
        ]);
        if (results.slice(0, 6).some(result => result.error)) throw new Error('Không thể tải đầy đủ số liệu báo cáo.');
        if (!cancelled) setData({ conferences: results[0].data, papers: results[1].data, participants: results[2].data, certificates: results[3].data, profiles: results[4].data, reviews: results[5].data, events: results[6].error ? null : results[6].data } as unknown as ReportData);
      } catch { if (!cancelled) setError('Không thể tải báo cáo. Kiểm tra kết nối và thử lại.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [profile?.role, reload]);
  const report = useMemo(() => data ? buildReport(data, filter) : null, [data, filter]);
  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to) { setDateError('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'); return; }
    setDateError(''); setFilter(draft);
  }
  if (profile?.role !== 'admin') return null;
  if (loading) return <p role="status" className="py-12 text-center text-slate-500">Đang tổng hợp báo cáo...</p>;
  if (error || !data || !report) return <Card className="p-6"><p role="alert">{error || 'Chưa có dữ liệu'}</p><Button onClick={() => setReload(value => value + 1)}>Thử lại</Button></Card>;
  const groups: { title: string; metrics: Metric[]; note?: string }[] = [
    { title: 'Thống kê hội thảo', metrics: [...Object.entries(report.conferenceStatuses).map(([key, value]) => ({ label: CONFERENCE_STATUS_LABELS[key as keyof typeof CONFERENCE_STATUS_LABELS], value })), { label: 'Đăng ký trung bình / hội thảo trong phạm vi chọn', value: report.averageRegistrations }] },
    { title: 'Thống kê bài báo', metrics: [{ label: 'Tổng bài đã nộp', value: report.totals.papers }, ...Object.entries(report.paperStatuses).map(([key, value]) => ({ label: paperLabels[key], value: key === 'camera_ready' && data.events === null ? null : value })), { label: 'Tỷ lệ Accept', value: report.acceptRate, suffix: '%' }, { label: 'Tỷ lệ Reject', value: report.rejectRate, suffix: '%' }], note: 'Tỷ lệ tính trên bài đã có quyết định Accept hoặc Reject. Camera-ready là bài được chấp nhận và đã tải phiên bản mới sau khi chấp nhận; được tách khỏi Accepted để tránh đếm trùng.' },
    { title: 'Thống kê phản biện', metrics: [{ label: 'Bài đã phân reviewer', value: report.assigned }, { label: 'Bài chưa phân reviewer', value: report.unassigned }, { label: 'Review hoàn thành', value: report.completedReviews }, { label: 'Review đang chờ / đang thực hiện', value: report.pendingReviews }, { label: 'Review quá hạn', value: report.overdue }, { label: 'Thời gian phản biện trung bình', value: report.averageReviewDays, suffix: ' ngày' }], note: `Theo các bài nộp trong khoảng chọn. Quá hạn là review chưa hoàn thành và đã qua hạn phản biện của hội thảo tại thời điểm xem; nằm trong số đang chờ. Trung bình dựa trên ${report.durationSamples} review có đủ mốc phân công và hoàn thành.` },
    { title: 'Thống kê người tham dự', metrics: [{ label: 'Lượt đăng ký còn hiệu lực', value: report.totals.registrations }, { label: 'Đã check-in', value: report.totals.checkins }, { label: 'Chưa check-in', value: report.unchecked }, { label: 'Lượt hủy đăng ký', value: report.cancelled }, { label: 'Tỷ lệ check-in', value: report.checkinRate, suffix: '%' }], note: 'Check-in phản ánh trạng thái hiện tại của các lượt đăng ký trong khoảng ngày chọn. Hủy đăng ký tính theo ngày hủy; một người có thể đăng ký và hủy nhiều lần.' },
    { title: 'Thống kê người dùng', metrics: [...Object.entries(report.roles).map(([key, value]) => ({ label: ROLE_LABELS[key as keyof typeof ROLE_LABELS], value })), { label: 'Tài khoản mới trong kỳ', value: report.newUsers }], note: 'Tổng tài khoản và vai trò là số hiện tại trên toàn hệ thống, độc lập với bộ lọc. Tài khoản mới và bảng theo tháng áp dụng khoảng ngày tạo tài khoản đã chọn.' },
    { title: 'Thống kê chứng nhận', metrics: [{ label: 'Tổng đã cấp', value: report.totals.certificates }, { label: 'Chứng nhận tham dự', value: report.attendanceCertificates }, { label: 'Chứng nhận tác giả / báo cáo viên', value: report.presentationCertificates }, { label: 'Đã check-in nhưng chưa có chứng nhận tham dự', value: report.missingCertificates }], note: 'Chứng nhận đã cấp tính theo ngày cấp. Mục còn thiếu kiểm tra mọi chứng nhận tham dự hiện có cho các lượt đăng ký đã check-in trong kỳ, không chỉ chứng nhận cấp trong kỳ.' },
  ];
  const totals = [
    { label: 'Tổng hội thảo', value: report.totals.conferences }, { label: 'Tổng bài báo', value: report.totals.papers },
    { label: 'Tổng người dùng · Toàn hệ thống', value: report.totals.users }, { label: 'Tổng lượt đăng ký', value: report.totals.registrations },
    { label: 'Tổng check-in', value: report.totals.checkins }, { label: 'Tổng chứng nhận đã cấp', value: report.totals.certificates },
  ];
  const ranked = [...report.top].sort((a, b) => b[ranking] - a[ranking] || a.title.localeCompare(b.title, 'vi'));
  const topRegistrations = [...report.top].sort((a, b) => b.registrations - a.registrations || a.title.localeCompare(b.title, 'vi')).slice(0, 5);
  const conferenceName = data.conferences.find(c => c.id === filter.conference)?.title || 'Tất cả hội thảo';
  function download() {
    if (!report) return;
    const rows: (string | number | null)[][] = [
      ['BÁO CÁO THỐNG KÊ'], ['Từ ngày', filter.from], ['Đến ngày', filter.to], ['Hội thảo', conferenceName],
      ['Trạng thái hội thảo', filter.status ? CONFERENCE_STATUS_LABELS[filter.status as keyof typeof CONFERENCE_STATUS_LABELS] : 'Tất cả'],
      ['Thời điểm xuất', new Date().toISOString()], ['Ghi nhận hủy / camera-ready từ', report.trackingSince],
      ['Quy ước', 'Hội thảo: ngày bắt đầu; bài: ngày nộp; đăng ký: ngày đăng ký; chứng nhận: ngày cấp. Tổng người dùng và vai trò: toàn hệ thống hiện tại; tài khoản mới: theo ngày tạo trong kỳ. Trạng thái hiện tại.'],
      ['Giới hạn', 'Không phục dựng hủy đăng ký hoặc camera-ready trước thời điểm bắt đầu ghi nhận.'],
      [], ['TỔNG QUAN', 'Số lượng'], ...totals.map(metric => [metric.label, metric.value]),
      ...groups.flatMap(group => [[], [group.title, 'Giá trị', 'Đơn vị'], ...group.metrics.map(metric => [metric.label, metric.value, metric.suffix || '']), ...(group.note ? [['Ghi chú', group.note]] : [])]),
      [], ['THEO THÁNG', 'Bài báo', 'Đăng ký', 'Tài khoản mới'], ...report.months.map(month => [month.label, month.papers, month.registrations, month.users]),
      [], ['XẾP HẠNG HỘI THẢO', 'Đăng ký', 'Bài nộp', 'Check-in', 'Tỷ lệ check-in (%)'], ...ranked.map(c => [c.title, c.registrations, c.papers, c.checkins, c.rate]),
    ];
    const url = URL.createObjectURL(new Blob([reportCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `bao-cao-${filter.from}-${filter.to}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Thống kê & Báo cáo</h2><p className="mt-1 text-sm text-slate-500">Số liệu trong kỳ và tình trạng xử lý hiện tại.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw className="h-4 w-4" />Làm mới</Button><Button onClick={download}><Download className="h-4 w-4" />Xuất CSV</Button></div></div>
    <form onSubmit={apply} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap gap-2">{[{ key: '7', label: '7 ngày' }, { key: '30', label: '30 ngày' }, { key: '3months', label: '3 tháng' }, { key: 'year', label: 'Năm nay' }, { key: 'custom', label: 'Tùy chỉnh' }].map(item => <button key={item.key} type="button" aria-pressed={preset === item.key} onClick={() => { setPreset(item.key); if (item.key !== 'custom') { const next = { ...draft, ...presetRange(item.key) }; setDraft(next); setFilter(next); setDateError(''); } }} className={`rounded-lg px-3 py-2 text-sm ${preset === item.key ? 'bg-teal-600 text-white' : 'bg-white text-slate-600'}`}>{item.label}</button>)}</div>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-600">Từ ngày<input type="date" required className="mt-1 block rounded-lg border p-2 text-sm" value={draft.from} onChange={e => { setPreset('custom'); setDraft({ ...draft, from: e.target.value }); }} /></label><label className="text-xs font-medium text-slate-600">Đến ngày<input type="date" required min={draft.from || undefined} className="mt-1 block rounded-lg border p-2 text-sm" value={draft.to} onChange={e => { setPreset('custom'); setDraft({ ...draft, to: e.target.value }); }} /></label><label className="min-w-40 flex-1 text-xs font-medium text-slate-600">Hội thảo<select className="mt-1 block w-full rounded-lg border p-2 text-sm" value={draft.conference} onChange={e => setDraft({ ...draft, conference: e.target.value })}><option value="">Tất cả hội thảo</option>{data.conferences.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Trạng thái<select className="mt-1 block rounded-lg border p-2 text-sm" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">Tất cả trạng thái</option>{Object.entries(CONFERENCE_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><Button type="submit">Áp dụng</Button></div>
      {dateError && <p role="alert" className="text-sm text-rose-600">{dateError}</p>}
    </form>
    <div className="space-y-2 text-xs leading-5 text-slate-500"><p className="font-semibold text-teal-800">Đang xem: {filter.from} → {filter.to} · {conferenceName} · {filter.status ? CONFERENCE_STATUS_LABELS[filter.status as keyof typeof CONFERENCE_STATUS_LABELS] : 'Tất cả trạng thái'}</p><p>Khoảng ngày tính cả hai đầu theo giờ trên thiết bị. Hội thảo tính theo ngày bắt đầu; bài báo theo ngày nộp; đăng ký theo ngày đăng ký; chứng nhận theo ngày cấp. Trạng thái và check-in là hiện tại. Tổng người dùng và vai trò là số hiện tại toàn hệ thống; tài khoản mới tính theo ngày tạo trong kỳ. “3 tháng” gồm tháng hiện tại và hai tháng trước, đến hôm nay.</p>
      <p className="rounded-lg bg-amber-50 p-3 text-amber-800">{data.events === null ? 'Chưa tải được lịch sử hủy đăng ký / camera-ready. Các chỉ số này chưa đủ dữ liệu; cần áp dụng migration báo cáo và tải lại.' : `Hủy đăng ký và camera-ready được ghi nhận từ ${report.trackingSince ? new Date(report.trackingSince).toLocaleString('vi-VN') : 'khi bắt đầu theo dõi'}. Không có lịch sử đầy đủ trước thời điểm này.`}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{totals.map(metric => <Card key={metric.label} className="p-5"><p className="text-xs font-medium text-slate-500">{metric.label}</p><p className="mt-2 text-3xl font-bold text-teal-700">{number(metric.value)}</p></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Xu hướng theo tháng</h3><select aria-label="Chỉ số biểu đồ đường" className="rounded border p-1 text-sm" value={lineSeries} onChange={e => setLineSeries(e.target.value as typeof lineSeries)}><option value="papers">Bài báo</option><option value="registrations">Lượt đăng ký</option></select></div><LineChart data={report.months.map(m => ({ label: m.label, value: m[lineSeries] }))} /><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Xem số liệu biểu đồ</summary>{report.months.map(m => <p key={m.key}>{m.label}: {m[lineSeries]}</p>)}</details></Card>
      <Card className="p-5"><h3 className="mb-5 font-semibold">Hội thảo theo trạng thái</h3><Bars data={Object.entries(report.conferenceStatuses).map(([key, value]) => ({ label: CONFERENCE_STATUS_LABELS[key as keyof typeof CONFERENCE_STATUS_LABELS], value }))} /></Card>
      <Card className="p-5"><h3 className="mb-5 font-semibold">Tỷ lệ trạng thái bài báo</h3><Donut data={Object.entries(report.paperStatuses).map(([key, value]) => ({ label: paperLabels[key], value }))} /></Card>
      <Card className="p-5"><h3 className="mb-5 font-semibold">Top 5 hội thảo theo lượt đăng ký</h3><Bars data={topRegistrations.map(c => ({ label: c.title, value: c.registrations }))} /></Card>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">{groups.map(group => <Card key={group.title} className="p-5"><h3 className="mb-4 font-semibold text-slate-900">{group.title}</h3><dl className="divide-y divide-slate-100">{group.metrics.map(metric => <div key={metric.label} className="flex justify-between gap-4 py-2 text-sm"><dt className="text-slate-600">{metric.label}</dt><dd className="shrink-0 font-semibold tabular-nums">{number(metric.value, metric.suffix)}</dd></div>)}</dl>{group.note && <p className="mt-3 text-xs leading-5 text-slate-500">{group.note}</p>}</Card>)}</div>
    <Card className="overflow-hidden p-5"><h3 className="mb-4 font-semibold">Tài khoản mới theo tháng · Toàn hệ thống</h3><div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Tháng</th><th>Tài khoản mới</th></tr></thead><tbody>{report.months.map(m => <tr key={m.key} className="border-t"><td className="py-2">{m.label}</td><td>{m.users}</td></tr>)}</tbody></table></div></Card>
    <Card className="p-5"><div className="mb-4 flex flex-wrap justify-between gap-3"><h3 className="font-semibold">Top hội thảo</h3><select aria-label="Xếp hạng hội thảo" className="rounded-lg border p-2 text-sm" value={ranking} onChange={e => setRanking(e.target.value as typeof ranking)}><option value="registrations">Nhiều đăng ký nhất</option><option value="papers">Nhiều bài nộp nhất</option><option value="rate">Tỷ lệ check-in cao nhất</option></select></div><div className="overflow-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead><tr>{['Hội thảo', 'Đăng ký', 'Bài nộp', 'Check-in', 'Tỷ lệ'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{ranked.slice(0, 5).map(c => <tr key={c.id} className="border-t"><td className="p-2">{c.title}</td><td className="p-2">{c.registrations}</td><td className="p-2">{c.papers}</td><td className="p-2">{c.checkins}</td><td className="p-2">{c.registrations ? number(c.rate, '%') : '—'}</td></tr>)}</tbody></table>{!ranked.length && <p className="py-6 text-center text-slate-500">Không có hội thảo phù hợp.</p>}</div></Card>
  </section>;
}

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return <div className="space-y-4">{data.map((d, i) => <div key={d.label}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="line-clamp-2" title={d.label}>{d.label}</span><strong>{d.value}</strong></div><div className="h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${d.value / max * 100}%`, background: colors[i % colors.length] }} /></div></div>)}{!data.length && <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>}</div>;
}
function LineChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const width = Math.max(500, data.length * 55);
  const point = (value: number, i: number) => ({ x: data.length === 1 ? width / 2 : 45 + i * (width - 65) / (data.length - 1), y: 170 - value / max * 130 });
  return <div className="mt-4 overflow-x-auto"><svg role="img" aria-label="Biểu đồ xu hướng theo tháng; số liệu chi tiết ở dưới" viewBox={`0 0 ${width} 210`} style={{ minWidth: width }} className="h-56 w-full"><line x1="40" y1="170" x2={width - 10} y2="170" stroke="#cbd5e1" /><text x="10" y="45" fontSize="11" fill="#64748b">{max}</text><text x="20" y="170" fontSize="11" fill="#64748b">0</text><polyline points={data.map((d, i) => { const p = point(d.value, i); return `${p.x},${p.y}`; }).join(' ')} fill="none" stroke="#0d9488" strokeWidth="3" />{data.map((d, i) => { const p = point(d.value, i); return <g key={d.label}><circle cx={p.x} cy={p.y} r="4" fill="#0d9488"><title>{d.label}: {d.value}</title></circle><text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11">{d.value}</text><text x={p.x} y="195" textAnchor="middle" fontSize="10" fill="#64748b">{d.label}</text></g>; })}</svg></div>;
}
function Donut({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let offset = 0;
  const gradient = data.map((d, i) => { const start = offset; offset += total ? d.value / total * 100 : 0; return `${colors[i]} ${start}% ${offset}%`; }).join(',');
  return <div className="flex flex-wrap items-center gap-6"><div role="img" aria-label={`Phân bố ${total} bài báo; chi tiết trong chú giải`} className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full" style={{ background: total ? `conic-gradient(${gradient})` : '#e2e8f0' }}><div className="flex h-28 w-28 items-center justify-center rounded-full bg-white text-2xl font-bold">{total}</div></div><ul className="space-y-2 text-xs">{data.map((d, i) => <li key={d.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i] }} />{d.label}: {d.value} ({total ? number(d.value / total * 100) : '0'}%)</li>)}</ul></div>;
}
