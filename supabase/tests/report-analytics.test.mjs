import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../../src/lib/reportAnalytics.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { buildReport, presetRange, reportCsv } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const filter = { from: '2026-09-01', to: '2026-09-30', conference: '', status: '' };
function fixture() {
  return {
    conferences: [{ id: 'c1', title: 'A', status: 'open', start_date: '2026-09-01', review_deadline: '2026-09-10T00:00:00' }, { id: 'c2', title: 'B', status: 'completed', start_date: '2026-09-30' }],
    papers: [{ id: 'p1', conference_id: 'c1', status: 'accepted', created_at: '2026-09-30T23:59:59' }, { id: 'p2', conference_id: 'c1', status: 'rejected', created_at: '2026-09-01T00:00:00' }, { id: 'p3', conference_id: 'c2', status: 'submitted', created_at: '2026-10-01T00:00:00' }],
    participants: [{ id: 'r1', conference_id: 'c1', user_id: 'u1', registered_at: '2026-09-01T00:00:00', attended: true }, { id: 'r2', conference_id: 'c1', user_id: 'u2', registered_at: '2026-09-30T23:59:59', attended: false }, { id: 'r3', conference_id: 'c2', user_id: 'u1', registered_at: '2026-09-12T00:00:00', attended: true }],
    certificates: [{ id: 'cert1', conference_id: 'c1', user_id: 'u1', certificate_type: 'attendance', issued_at: '2026-10-01T00:00:00' }, { id: 'cert2', conference_id: 'c2', user_id: 'u1', certificate_type: 'presentation', issued_at: '2026-09-30T23:59:59' }],
    profiles: [{ id: 'u1', role: 'author', created_at: '2026-09-01T00:00:00' }, { id: 'u2', role: 'admin', created_at: '2025-01-01T00:00:00' }],
    reviews: [{ id: 'v1', paper_id: 'p1', status: 'completed', assigned_at: '2026-09-01T00:00:00', completed_at: '2026-09-03T00:00:00' }, { id: 'v2', paper_id: 'p1', status: 'assigned', assigned_at: '2026-09-01T00:00:00', completed_at: null }],
    events: [{ id: 'e0', event_type: 'tracking_started', occurred_at: '2026-09-01T00:00:00' }, { id: 'e1', event_type: 'camera_ready', conference_id: 'c1', paper_id: 'p1', occurred_at: '2026-09-30T00:00:00' }, { id: 'e2', event_type: 'camera_ready', conference_id: 'c1', paper_id: 'p1', occurred_at: '2026-09-30T01:00:00' }, { id: 'e3', event_type: 'registration_cancelled', conference_id: 'c2', occurred_at: '2026-09-30T23:59:59' }],
  };
}
test('includes the entire last day, excludes the following day, and avoids camera-ready double counting', () => {
  const r = buildReport(fixture(), filter, new Date('2026-09-24T12:00:00'));
  assert.deepEqual(r.totals, { conferences: 2, papers: 2, users: 2, registrations: 3, checkins: 2, certificates: 1 });
  assert.equal(r.newUsers, 1); assert.equal(r.roles.admin, 1);
  assert.equal(r.paperStatuses.camera_ready, 1); assert.equal(r.paperStatuses.accepted, 0);
  assert.equal(Object.values(r.paperStatuses).reduce((a,b) => a+b, 0), 2);
  assert.equal(r.acceptRate, 50); assert.equal(r.rejectRate, 50);
  assert.equal(r.assigned, 1); assert.equal(r.unassigned, 1);
  assert.equal(r.overdue, 1); assert.equal(r.averageReviewDays, 2);
  assert.equal(r.missingCertificates, 1); // later certificate counts for eligibility, not issuance totals
  assert.equal(r.cancelled, 1);
});
test('applies conference/status filters to related data, while user counts stay system-wide', () => {
  const r = buildReport(fixture(), { ...filter, conference: 'c1', status: 'open' });
  assert.equal(r.totals.registrations, 2); assert.equal(r.cancelled, 0); assert.equal(r.missingCertificates, 0);
  assert.equal(r.totals.users, 2); assert.equal(r.top.length, 1);
  const empty = buildReport(fixture(), { ...filter, conference: 'c1', status: 'completed' });
  assert.equal(empty.totals.papers, 0); assert.equal(empty.checkinRate, null); assert.equal(empty.averageReviewDays, null);
});
test('distinguishes unavailable tracking from zero and supplies empty months', () => {
  const data = fixture(); data.events = null;
  const r = buildReport(data, { ...filter, from: '2026-07-01' });
  assert.equal(r.cancelled, null); assert.equal(r.trackingSince, null);
  assert.equal(r.paperStatuses.accepted, 1);
  assert.equal(r.months.length, 3); assert.equal(r.months[0].papers, 0);
  assert.equal(r.months[2].users, 1);
});
test('supports same-day ranges, rejects reversed ranges and computes year-crossing presets', () => {
  assert.equal(buildReport(fixture(), { ...filter, from: '2026-09-30' }).totals.papers, 1);
  assert.throws(() => buildReport(fixture(), { ...filter, from: '2026-10-01' }));
  assert.deepEqual(presetRange('7', new Date(2026, 0, 3)), { from: '2025-12-28', to: '2026-01-03' });
  assert.deepEqual(presetRange('3months', new Date(2026, 0, 31)), { from: '2025-11-01', to: '2026-01-31' });
});
test('CSV preserves Vietnamese, quotes/newlines and blocks spreadsheet formula injection', () => {
  const csv = reportCsv([['Hội thảo, "AI"\n2026', '=HYPERLINK("x")', ' +1', 0, null]]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"Hội thảo, ""AI""\n2026"'));
  assert.ok(csv.includes('"\'=HYPERLINK')); assert.ok(csv.includes('"\' +1"')); assert.ok(csv.includes('"0"'));
  assert.ok(csv.includes('Chưa có dữ liệu'));
});

test('declined assignments do not count as pending, overdue or staffed papers', () => {
  const data = fixture();
  data.reviews = [{ id: 'declined', paper_id: 'p1', status: 'declined', assigned_at: '2026-09-01T00:00:00', completed_at: null }];
  const report = buildReport(data, filter, new Date('2026-09-24T12:00:00'));
  assert.equal(report.pendingReviews, 0);
  assert.equal(report.overdue, 0);
  assert.equal(report.assigned, 0);
  assert.equal(report.unassigned, 2);
});
