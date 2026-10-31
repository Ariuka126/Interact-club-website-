// Presidential specification, part 3: overtime + audit override, role caps, promotion, and the full permission matrix.
// Run: node tests/spec3.js
const { loadApp } = require('./harness');
process.env.SESSION_SECRET = 'test-secret';
process.env.FEEDBACK_KEY = 'm'.repeat(40) + '-matrix-key';
let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : JSON.stringify(d).slice(0, 400))); };

const U = (id, role, sector = null, name = role + id) => ({ id, name, email: name.replace(/\W/g, '').toLowerCase() + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0,
  demoted_at: null, demotion_reason: null, attendance_reset_at: null, created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z` });
const admin = U(1, 'admin', null, 'Ann'), pres = U(2, 'pres', null, 'Pat'), pres2 = U(10, 'pres', null, 'Pia'),
  eHead = U(3, 'lead', 'Events', 'Eli'), fHead = U(7, 'lead', 'Finance', 'Fay'), cHead = U(11, 'lead', 'Community', 'Cam'), rHead = U(12, 'lead', 'Creative', 'Rae'),
  mia = U(4, 'member', 'Events', 'Mia'), max = U(5, 'member', 'Events', 'Max'), nia = U(13, 'member', null, 'Nia'), vic = U(6, 'volunteer', null, 'Vic');
const ALL = [admin, pres, pres2, eHead, fHead, cHead, rHead, mia, max, nia, vic];
const ev = o => ({ id: 1, title: 'Fair', sector: 'Events', hours: 2, capacity: 9, volunteer_slots: 1, location: 'Hall', date_label: 'Oct 31', type: 'in', verification: '["qr","selfie"]', shifts: null, points: null, days: null, waiver_required: 0, is_setup: 0, is_active: 1, lat: null, lng: null, created_by: 1, created_at: '2026-01-01T00:00:00Z', ...o });
const L = o => ({ user_id: 4, event_id: 1, hours: 2, day: 1, status: 'approved', flagged: 0, photo_data: null, work_link: null, overtime_hours: null, overtime_reason: null, overtime_status: null, overtime_proof_url: null, reviewed_by: null, reviewed_at: null, created_at: '2026-02-01T00:00:00Z', ...o });
const world = (extra = {}) => { const a = loadApp({ users: ALL.map(u => ({ ...u })), events: [ev()], signups: [], hour_logs: [], ...extra }); a.row = id => a.T.users.find(u => u.id === id);
  a.as = id => { const r = a.row(id); return { id: r.id, name: r.name, email: r.email, role: r.role, sector: r.sector }; };
  a.api = (who, method, path, body, query) => a.call(method, '/api' + path, { user: who == null ? null : a.as(who), body, query }); return a; };

(async () => {
  /* ===================== OVERTIME: proof, privacy, President-only ===================== */
  let w = world(), { T } = w, api = w.api, r;
  T.hour_logs.push(L({ id: 1, user_id: 4, overtime_hours: 1.5, overtime_reason: 'Stayed late to pack up the hall', overtime_status: 'pending', overtime_proof_url: 'https://photos.example/pack-up.jpg' }),
    L({ id: 2, user_id: 5, status: 'pending', day: 2 }), L({ id: 3, user_id: 2, status: 'approved', day: 3, overtime_hours: 1, overtime_reason: 'x'.repeat(20), overtime_status: 'pending', overtime_proof_url: 'https://p.example/2' }));
  const otOf = async who => (await api(who, 'GET', '/bootstrap')).json.logs.find(l => l.id === 1).ot;
  r = await otOf(4); t('overtime privacy: the member sees their own reason and proof', r.reason === 'Stayed late to pack up the hall' && r.proof === 'https://photos.example/pack-up.jpg' && r.hrs === 1.5);
  r = await otOf(2); t('overtime privacy: a President sees the reason and the proof link', r.reason === 'Stayed late to pack up the hall' && r.proof === 'https://photos.example/pack-up.jpg');
  for (const [who, n] of [[5, 'another member'], [3, 'a Sector Head']]) { r = await otOf(who); t(`overtime privacy: ${n} sees only that overtime exists`, r.status === 'pending' && r.hrs === 1.5 && r.reason === null && r.proof === null, r); }
  t('overtime: only a President decides (heads, members, admin accounts refused)', (await api(3, 'POST', '/hours/1/overtime', { decision: 'approved' })).code === 403 && (await api(4, 'POST', '/hours/1/overtime', { decision: 'approved' })).code === 403 && (await api(1, 'POST', '/hours/1/overtime', { decision: 'approved' })).code === 403 && T.hour_logs[0].overtime_status === 'pending');
  t('overtime: a President cannot decide their own', (await api(2, 'POST', '/hours/3/overtime', { decision: 'approved' })).code === 403 && (await api(10, 'POST', '/hours/3/overtime', { decision: 'approved' })).code === 200);
  r = await api(2, 'POST', '/hours/1/overtime', { decision: 'approved' });
  t('overtime: approved by a President; counted in the member\'s hours; recorded in the audit log', r.code === 200 && (await api(2, 'GET', '/bootstrap')).json.members.find(m => x => 1, true) !== undefined && (await api(2, 'GET', '/bootstrap')).json.members.find(m => m.id === 4).in === 3.5 && T.audit_logs.at(-1).action === 'overtime.approve' && T.audit_logs.at(-1).actor_name === 'Pat' && T.audit_logs.at(-1).details.hours === 1.5);
  t('overtime: already decided -> 409', (await api(10, 'POST', '/hours/1/overtime', { decision: 'denied' })).code === 409);

  /* ===================== AUDIT OVERRIDE ===================== */
  const ov = (who, id, body) => api(who, 'POST', `/hours/${id}/override`, body);
  t('override: only a President (heads, members, admin accounts refused)', (await ov(3, 2, { status: 'approved', reason: 'I was there as well' })).code === 403 && (await ov(4, 2, { status: 'approved', reason: 'I was there as well' })).code === 403 && (await ov(1, 2, { status: 'approved', reason: 'I was there as well' })).code === 403 && (await ov(null, 2, { status: 'approved', reason: 'I was there as well' })).code === 401);
  t('override: needs a valid status and a written reason', (await ov(2, 2, { status: 'maybe', reason: 'because I said so' })).code === 400 && (await ov(2, 2, { status: 'approved' })).code === 400 && (await ov(2, 2, { status: 'approved', reason: 'short' })).code === 400 && T.hour_logs[1].status === 'pending');
  t('override: unknown entry 404; own hours 403; no change 409', (await ov(2, 99, { status: 'approved', reason: 'no such entry here' })).code === 404 && (await ov(2, 3, { status: 'rejected', reason: 'overriding myself here' })).code === 403 && (await ov(2, 1, { status: 'approved', reason: 'already approved so no change' })).code === 409);
  r = await ov(10, 1, { status: 'rejected', reason: 'Photo proof does not match the event' });
  t('override: a President reverses an approved decision', r.code === 200 && T.hour_logs[0].status === 'rejected' && T.hour_logs[0].reviewed_by === 10 && !!T.hour_logs[0].reviewed_at);
  const ao = T.audit_logs.at(-1);
  t('override: the audit entry holds who, what, before, after and why', ao.action === 'hours.override' && ao.actor_name === 'Pia' && ao.details.from === 'approved' && ao.details.to === 'rejected' && ao.details.reason === 'Photo proof does not match the event' && ao.details.userId === 4 && ao.entity_id === '1', ao);
  t('override: the member\'s total drops accordingly', (await api(2, 'GET', '/bootstrap')).json.members.find(m => m.id === 4).in === 0);
  r = await ov(2, 1, { status: 'pending', reason: 'Sending it back for another look' });
  t('override: a decision can be put back to pending (review time cleared)', r.code === 200 && T.hour_logs[0].status === 'pending' && T.hour_logs[0].reviewed_at === null);
  t('override: the same change twice cannot slip through (stale view -> 409)', (await ov(2, 1, { status: 'pending', reason: 'doing it again now' })).code === 409);
  r = await api(2, 'GET', '/hours/decided');
  t('override list: the latest decisions with names, newest first, for Presidents only', r.code === 200 && r.json.logs.length >= 1 && r.json.logs[0].member && r.json.logs[0].event === 'Fair' && r.json.logs.every((l, i, a) => !i || a[i - 1].id > l.id) && r.json.logs.find(l => l.id === 3).own === true
    && (await api(3, 'GET', '/hours/decided')).code === 403 && (await api(1, 'GET', '/hours/decided')).code === 403 && (await api(4, 'GET', '/hours/decided')).code === 403);
  // routine decisions are audited too
  await api(3, 'POST', '/hours/2/review', { status: 'approved' });
  t('audit: a Sector Head\'s review is recorded', T.audit_logs.at(-1).action === 'hours.approve' && T.audit_logs.at(-1).actor_name === 'Eli' && T.audit_logs.at(-1).details.userId === 5);
  T.hour_logs.push(L({ id: 4, user_id: 5, day: 4, status: 'pending' }), L({ id: 5, user_id: 4, day: 5, status: 'pending' }));
  await api(3, 'POST', '/events/1/approve-all'); t('audit: bulk approval is recorded with the count', T.audit_logs.at(-1).action === 'hours.approve_all' && T.audit_logs.at(-1).details.count === 3, T.audit_logs.at(-1));
  T.hour_logs.push(L({ id: 6, user_id: 5, day: 6, flagged: 1 })); await api(2, 'POST', '/hours/6/unflag'); await api(2, 'POST', '/hours/6/remove-hours');
  t('audit: flag decisions are recorded', T.audit_logs.some(a => a.action === 'hours.unflag') && T.audit_logs.some(a => a.action === 'hours.remove'));
  const ev1 = await api(3, 'POST', '/events', { title: 'Open day', hours: 2, capacity: 10, type: 'in', verification: ['qr'] });
  t('audit: publishing an event is recorded', ev1.code === 201 && T.audit_logs.at(-1).action === 'event.create' && T.audit_logs.at(-1).details.sector === 'Events');
  await api(3, 'DELETE', `/events/${ev1.json.event.id}`); t('audit: deleting an event is recorded', T.audit_logs.at(-1).action === 'event.delete');

  /* ===================== CAPS: 2 PRESIDENTS, 1 HEAD PER SECTOR ===================== */
  w = world(); ({ T } = w); api = w.api;
  const role = (id, newRole, sector) => api(1, 'POST', '/admin/update-role', { targetUserId: id, newRole, sector });
  r = await role(13, 'pres');
  t('caps: a third President is refused', r.code === 409 && /only be 2 Presidents/.test(r.json.error) && w.row(13).role === 'member', r.json);
  t('caps: an existing President can be re-saved (still two)', (await role(2, 'pres')).code === 200);
  t('caps: demoting one President makes room for another, and it is audited', (await role(10, 'member')).code === 200 && (await role(13, 'pres')).code === 200 && w.row(13).role === 'pres' && T.audit_logs.at(-1).action === 'role.change' && T.audit_logs.at(-1).details.to === 'pres' && T.audit_logs.at(-1).actor_name === 'Ann');
  r = await role(5, 'lead', 'Events');
  t('caps: a second Head for the same sector is refused', r.code === 409 && /Events & Operations already has a Sector Head/.test(r.json.error) && w.row(5).role === 'member', r.json);
  t('caps: a Head needs a sector (a member with none on file is refused; one with a sector on file uses it)', (await role(13, 'lead')).code === 400);
  t('caps: a Head for a sector with nobody in charge is fine', (await role(rHead.id, 'member')).code === 200 && (await role(5, 'lead', 'Creative')).code === 200 && w.row(5).role === 'lead' && w.row(5).sector === 'Creative');
  t('caps: the one-head rule also holds for the current Head being re-saved', (await role(3, 'lead', 'Events')).code === 200);
  t('caps: only admin accounts change roles (Presidents use their own tools)', (await api(2, 'POST', '/admin/update-role', { targetUserId: 4, newRole: 'volunteer' })).code === 403 && (await api(3, 'POST', '/admin/update-role', { targetUserId: 4, newRole: 'volunteer' })).code === 403);

  /* ===================== PROMOTION ===================== */
  w = world(); ({ T } = w); api = w.api;
  Object.assign(w.row(6), { demoted_at: '2026-02-01T00:00:00Z', demotion_reason: '3 consecutive absences' });
  r = await api(2, 'POST', '/roster/promote', { userId: 6 });
  t('promotion: a President promotes; the demotion is wiped and the record starts fresh; audited', r.code === 200 && w.row(6).role === 'member' && w.row(6).demoted_at === null && w.row(6).demotion_reason === null && !!w.row(6).attendance_reset_at && T.audit_logs.at(-1).action === 'member.promote');
  t('promotion: only Presidents (and admin accounts); heads and members refused', (await api(3, 'POST', '/roster/promote', { userId: 6 })).code === 403 && (await api(4, 'POST', '/roster/promote', { userId: 6 })).code === 403);

  /* ===================== THE PERMISSION MATRIX ===================== */
  // For each endpoint: who may use it. "Allowed" means the request gets past the role check (a 400 or 404 for the
  // empty body is fine). "Denied" means 401 when logged out and 403 when logged in.
  w = world({ events: [ev({ id: 1, sector: 'Events' })] }); ({ T } = w); api = w.api;
  const WHO = { anon: null, volunteer: 6, member: 4, 'Events head': 3, 'Finance head': 7, president: 2, admin: 1 };
  const P = ['president'], HEADS = ['Events head', 'Finance head', 'president'], MEM = ['member', 'Events head', 'Finance head', 'president', 'admin'];
  const M = [
    ['GET', '/treasury', null, ['president', 'Finance head']], ['POST', '/treasury', {}, ['president', 'Finance head']], ['POST', '/treasury/1/reverse', {}, ['president', 'Finance head']],
    ['GET', '/audit', null, P], ['GET', '/feedback', null, P], ['POST', '/feedback/1/status', {}, P], ['POST', '/vault', {}, P], ['POST', '/vault/1/archive', {}, P],
    ['POST', '/proposals/1/decision', {}, P], ['POST', '/hours/1/overtime', {}, P], ['POST', '/hours/1/override', {}, P], ['GET', '/hours/decided', null, P],
    ['POST', '/members/4/reinstate', {}, P], ['POST', '/members/4/assign-sector', {}, P],
    ['GET', '/meetings', null, HEADS], ['POST', '/meetings', {}, HEADS], ['GET', '/attendance/summary', null, HEADS], ['POST', '/meetings/1/rollcall', { marks: [] }, ['Events head', 'Finance head', 'president'].filter(x => true)],
    ['POST', '/sector-roles', {}, HEADS], ['POST', '/events', {}, [...HEADS, 'admin']],   // admin accounts could publish events before this spec; that older power is kept
    ['POST', '/events/1/tasks', {}, ['Events head', 'president']],
    ['GET', '/sector-roles', null, MEM], ['GET', '/vault', null, MEM], ['POST', '/feedback', {}, MEM], ['GET', '/proposals', null, MEM], ['GET', '/events/1/tasks', null, MEM], ['POST', '/tasks/1/claim', {}, MEM],
    ['POST', '/proposals', {}, ['member', 'Events head', 'Finance head']], ['POST', '/sector-roles/1/apply', {}, ['member']],
    ['POST', '/roster/promote', {}, ['president', 'admin']], ['GET', '/export', null, ['president', 'admin']],
    ['GET', '/admin/users', null, ['admin']], ['POST', '/admin/update-role', {}, ['admin']], ['GET', '/admin/pending-hours', null, ['admin']],
  ];
  for (const [method, path, body, allowed] of M) {
    const wrong = [];
    for (const [who, id] of Object.entries(WHO)) {
      const res = await api(id, method, path, body);
      const blocked = res.code === 401 || res.code === 403, should = allowed.includes(who);
      if (who === 'anon' ? (res.code !== 401) : (should === blocked)) wrong.push(`${who}: got ${res.code}, ${should ? 'should be allowed' : 'should be refused'}`);
    }
    t(`matrix ${method.padEnd(6)} ${path}  [${allowed.join(', ')}]`, wrong.length === 0, wrong);
  }
  // Sector Heads are bound to their own sector even where heads may act at all
  t('matrix: a head cannot run another sector (roll-call, roles, checklist)', (await api(7, 'GET', '/meetings/999')).code !== 200 && (await api(7, 'POST', '/events/1/tasks', { title: 'Cross sector' })).code === 403 && (await api(3, 'POST', '/events', { title: 'Cross sector event', hours: 2, capacity: 5, type: 'in', verification: ['qr'], sector: 'Finance' })).json.event.sector === 'Events');

  console.log(`\nspec part 3 (overtime, override, caps, matrix): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
