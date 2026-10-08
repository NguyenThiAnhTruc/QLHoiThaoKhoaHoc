import type { Conference, Paper, Participant, Certificate, Profile, Review } from '@/types';
import { getConferenceDisplayStatus } from './constants';

export interface ReportingEvent {
  id: string; event_type: 'tracking_started' | 'registration_cancelled' | 'camera_ready';
  conference_id: string | null; paper_id: string | null; occurred_at: string;
}
export interface ReportData {
  conferences: Conference[]; papers: Paper[]; participants: Participant[];
  certificates: Certificate[]; profiles: Pick<Profile, 'id' | 'role' | 'created_at'>[];
  reviews: Review[]; events: ReportingEvent[] | null;
}
export interface ReportFilter { from: string; to: string; conference: string; status: string; allTime?: boolean }
export function dateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function presetRange(preset: string, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === '7') start.setDate(start.getDate() - 6);
  if (preset === '30') start.setDate(start.getDate() - 29);
  // Current month and the preceding two calendar months.
  if (preset === '3months') { start.setDate(1); start.setMonth(start.getMonth() - 2); }
  if (preset === 'year') { start.setMonth(0, 1); }
  return { from: dateInput(start), to: dateInput(now) };
}
const countBy = (values: string[], keys: string[]) => Object.fromEntries(keys.map(key => [key, values.filter(value => value === key).length]));
export function buildReport(data: ReportData, filter: ReportFilter, now = new Date()) {
  let start = new Date(`${filter.from}T00:00:00`);
  const end = new Date(`${filter.to}T00:00:00`); end.setDate(end.getDate() + 1);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end) throw new Error('Khoảng ngày không hợp lệ');
  if (filter.allTime) {
    const dates = [...data.papers.map(p => p.created_at), ...data.participants.map(p => p.registered_at), ...data.profiles.map(p => p.created_at)]
      .map(value => new Date(value)).filter(date => Number.isFinite(+date));
    start = new Date(Math.min(+now, ...dates.map(Number)));
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    const latest = new Date(Math.max(+now, ...dates.map(Number)));
    end.setTime(+new Date(latest.getFullYear(), latest.getMonth() + 1, 1));
  }
  const inRange = (value: string) => {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return filter.allTime ? Number.isFinite(+date) : date >= start && date < end;
  };
  const scope = data.conferences.filter(c => (!filter.conference || c.id === filter.conference) && (!filter.status || getConferenceDisplayStatus(c, now) === filter.status));
  const ids = new Set(scope.map(c => c.id));
  const conferences = scope;
  const papers = data.papers.filter(p => ids.has(p.conference_id) && inRange(p.created_at));
  const registrations = data.participants.filter(p => ids.has(p.conference_id) && inRange(p.registered_at));
  const certificates = data.certificates.filter(c => ids.has(c.conference_id) && inRange(c.issued_at));
  // New-account activity uses creation dates; total users/roles remain system-wide.
  const users = data.profiles.filter(p => inRange(p.created_at));
  const paperIds = new Set(papers.map(p => p.id));
  const reviews = data.reviews.filter(r => paperIds.has(r.paper_id));
  const assignedIds = new Set(reviews.filter(r => r.status !== 'declined').map(r => r.paper_id));
  const readyIds = new Set((data.events ?? []).filter(e => e.event_type === 'camera_ready').map(e => e.paper_id));
  const paperStatuses = countBy(papers.map(p => p.status === 'accepted' && readyIds.has(p.id) ? 'camera_ready' : p.status), ['submitted', 'under_review', 'revision_required', 'accepted', 'rejected', 'camera_ready']);
  const checked = registrations.filter(p => p.attended);
  const attendanceKeys = new Set(data.certificates.filter(c => c.certificate_type === 'attendance').map(c => `${c.conference_id}:${c.user_id}`));
  const missingCertificates = checked.filter(p => !attendanceKeys.has(`${p.conference_id}:${p.user_id}`)).length;
  const durations = reviews.filter(r => r.status === 'completed' && r.completed_at && +new Date(r.completed_at) >= +new Date(r.assigned_at)).map(r => (+new Date(r.completed_at!) - +new Date(r.assigned_at)) / 86400000);
  const deadlineByConference = new Map(scope.map(c => [c.id, c.review_deadline]));
  const paperConference = new Map(papers.map(p => [p.id, p.conference_id]));
  const overdue = reviews.filter(r => {
    const deadline = deadlineByConference.get(paperConference.get(r.paper_id) || '');
    return (r.status === 'assigned' || r.status === 'in_progress') && deadline && +new Date(deadline) < +now;
  }).length;
  const months: { key: string; label: string; papers: number; registrations: number; users: number }[] = [];
  const monthKey = (value: string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
  const monthlyPapers = new Map<string, number>(); const monthlyRegistrations = new Map<string, number>(); const monthlyUsers = new Map<string, number>();
  for (const [dates, map] of [[papers.map(p => p.created_at), monthlyPapers], [registrations.map(p => p.registered_at), monthlyRegistrations], [users.map(p => p.created_at), monthlyUsers]] as const) {
    dates.forEach(date => { const key = monthKey(date); map.set(key, (map.get(key) || 0) + 1); });
  }
  for (const cursor = new Date(start.getFullYear(), start.getMonth(), 1); cursor < end; cursor.setMonth(cursor.getMonth() + 1)) {
    const key = dateInput(cursor).slice(0, 7);
    months.push({ key, label: `${cursor.getMonth() + 1}/${cursor.getFullYear()}`, papers: monthlyPapers.get(key) || 0, registrations: monthlyRegistrations.get(key) || 0, users: monthlyUsers.get(key) || 0 });
  }
  const top = scope.map(c => {
    const entries = registrations.filter(p => p.conference_id === c.id);
    return { id: c.id, title: c.title, registrations: entries.length, papers: papers.filter(p => p.conference_id === c.id).length, checkins: entries.filter(p => p.attended).length, rate: entries.length ? entries.filter(p => p.attended).length / entries.length * 100 : 0 };
  }).filter(c => c.registrations || c.papers || conferences.some(item => item.id === c.id));
  const accepted = paperStatuses.accepted + paperStatuses.camera_ready;
  const decisions = accepted + paperStatuses.rejected;
  return {
    totals: { conferences: conferences.length, papers: papers.length, users: data.profiles.length, registrations: registrations.length, checkins: checked.length, certificates: certificates.length },
    conferenceStatuses: countBy(conferences.map(c => getConferenceDisplayStatus(c, now)), ['draft', 'open', 'closed', 'ongoing', 'completed', 'cancelled']),
    averageRegistrations: scope.length ? registrations.length / scope.length : 0,
    paperStatuses, acceptRate: decisions ? accepted / decisions * 100 : null, rejectRate: decisions ? paperStatuses.rejected / decisions * 100 : null,
    assigned: papers.filter(p => assignedIds.has(p.id)).length, unassigned: papers.filter(p => !assignedIds.has(p.id)).length,
    completedReviews: reviews.filter(r => r.status === 'completed').length, pendingReviews: reviews.filter(r => r.status === 'assigned' || r.status === 'in_progress').length,
    overdue, averageReviewDays: durations.length ? durations.reduce((sum, days) => sum + days, 0) / durations.length : null, durationSamples: durations.length,
    unchecked: registrations.length - checked.length, checkinRate: registrations.length ? checked.length / registrations.length * 100 : null,
    cancelled: data.events === null ? null : data.events.filter(e => e.event_type === 'registration_cancelled' && e.conference_id && ids.has(e.conference_id) && inRange(e.occurred_at)).length,
    trackingSince: data.events?.find(e => e.event_type === 'tracking_started')?.occurred_at ?? null,
    newUsers: users.length,
    roles: countBy(data.profiles.map(u => u.role), ['admin', 'organizer', 'author', 'reviewer', 'participant']),
    attendanceCertificates: certificates.filter(c => c.certificate_type === 'attendance').length,
    presentationCertificates: certificates.filter(c => c.certificate_type === 'presentation').length,
    missingCertificates, months, top,
  };
}

export function reportCsv(rows: (string | number | null)[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = value === null ? 'Chưa có dữ liệu' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
