// President hour grants (POST /api/hours/grant) and officer QR check-in (POST /api/events/checkin):
// permissions, validation, duplicates, totals everywhere, and the screens that drive them. Run: node grants.js
const { loadApp, openAs } = require('./harness');
process.env.SESSION_SECRET = 'test-secret';
let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : JSON.stringify(d).slice(0, 300))); };

const U = (id, role, sector = null, name = role + id) => ({ id, name, email: name.replace(/\W/g, '').toLowerCase() + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0, created_at: `2026-01-0${id}T00:00:00Z` });
const admin = U(1, 'admin', null, 'Ann Admin'), pres = U(2, 'pres', null, 'Pat President'), lead = U(3, 'lead', 'Events', 'Lee Lead'), mia = U(4, 'member', 'Events', 'Mia Member'),
  max = U(5, 'member', 'Creative', 'Max Member'), vic = U(6, 'volunteer', null, 'Vic Volunteer'), fay = U(7, 'lead', 'Finance', 'Fay Finance');
const ev = o => ({ id: 1, title: 'Library Drive', sector: 'Events', hours: 2, capacity: 9, volunteer_slots: 1, location: 'Hall', date_label: 'Nov 14', type: 'out', verification: '["qr"]',
  shifts: null, points: null, days: null, waiver_required: 0, is_setup: 0, is_active: 1, lat: null, lng: null, created_by: 3, created_at: '2026-01-01T00:00:00Z', ...o });
const world = (events = [ev()], signed = [4, 5, 2]) => {
  const T = { users: [admin, pres, lead, mia, max, vic, fay].map(u => ({ ...u })), events, signups: [], hour_logs: [], log_cheers: [], log_comments: [] };
  for (const e of events) for (const uid of signed) T.signups.push({ id: T.signups.length + 1, user_id: uid, event_id: e.id, is_volunteer: 0, shift: null });
  const a = loadApp(T); return { ...a, T, app: { call: a.call } };
};
const TODAY = new Date().toISOString().slice(0, 10);
const G = o => ({ memberId: 4, hours: 3, date: TODAY, reason: 'Designed the gala posters', notes: 'Checked by Pat', ...o });
const row = (T, id) => T.users.find(u => u.id === id);

(async () => {
  /* ================= President grant: API ================= */
  let { call, T, app } = world([]), r;
  const grant = (user, body) => call('POST', '/api/hours/grant', { user, body });
  t('grant: logged out -> 401, member/lead/volunteer -> 403, nothing stored',
    (await grant(null, G())).code === 401 && (await grant(mia, G({ memberId: 5 }))).code === 403 && (await grant(lead, G())).code === 403 && (await grant(vic, G())).code === 403 && T.hour_logs.length === 0);
  for (const [n, p] of [['no member', { memberId: '' }], ['0 hours', { hours: 0 }], ['negative hours', { hours: -2 }], ['quarter hours', { hours: 1.25 }], ['101 hours', { hours: 101 }],
    ['hours as text', { hours: 'lots' }], ['no reason', { reason: '' }], ['blank reason', { reason: '   ' }], ['bad date', { date: '2026-02-31' }], ['future date', { date: '2999-01-01' }],
    ['no date', { date: undefined }], ['notes too long', { notes: 'x'.repeat(501) }], ['unknown type', { type: 'space' }]])
    t('grant: rejects ' + n, (await grant(pres, G(p))).code === 400);
  t('grant: unknown member -> 404, yourself -> 403, admin account -> 400, keeplist volunteer -> 409',
    (await grant(pres, G({ memberId: 99 }))).code === 404 && (await grant(pres, G({ memberId: 2 }))).code === 403 && (await grant(pres, G({ memberId: 1 }))).code === 400 && (await grant(pres, G({ memberId: 6 }))).code === 409 && T.hour_logs.length === 0);
  r = await grant(pres, G({ hours: 2.5 }));
  const gl = T.hour_logs[0];
  t('grant: stored as approved with audit metadata (no event)', r.code === 201 && gl && gl.status === 'approved' && gl.event_id === null && gl.hours === 2.5 && gl.user_id === 4 &&
    gl.grant_type === 'manual_president_grant' && gl.granted_by === 2 && gl.reviewed_by === 2 && gl.grant_reason === 'Designed the gala posters' && gl.grant_date === TODAY && gl.grant_scope === 'in', gl);
  t('grant: response names the member and the grant', r.json.grant.member === 'Mia Member' && r.json.grant.grantType === 'manual_president_grant' && r.json.grant.grantedBy === 2 && r.json.grant.status === 'approved', r.json);
  t('grant: recorded in the audit log', T.audit_logs.some(a => a.action === 'hours.grant' && a.actor_id === 2 && a.details.userId === 4 && a.details.hours === 2.5));
  t('grant: an admin may grant too; out-of-school type is kept', (await grant(admin, G({ memberId: 5, hours: 1, type: 'out', notes: '' }))).code === 201 && T.hour_logs[1].grant_scope === 'out' && T.hour_logs[1].grant_notes === null);
  t('grant: a Sector Head can receive a grant', (await grant(pres, G({ memberId: 3, hours: 0.5 }))).code === 201);
  t('grant: counts in /bootstrap totals (in vs out school)', (b => b.members.find(m => m.id === 4).in === 2.5 && b.members.find(m => m.id === 5).out === 1)((await call('GET', '/api/bootstrap', { user: pres })).json));
  t('grant: counts in club stats', (await call('GET', '/api/stats/', { user: pres })).json.totalHours === 4);
  t('grant: counts on the certificate', (c => c.in === 2.5 && c.out === 0)((await call('GET', '/api/certificate/4', { user: mia })).json));
  t('grant: counts in the Rotary CSV', /,Mia Member,active,Events,2\.5,0,2\.5,L1/.test((await call('GET', '/api/export', { user: pres })).text || ''), (await call('GET', '/api/export', { user: pres })).text);
  r = (await call('GET', '/api/bootstrap', { user: mia })).json;
  t('grant: the member sees their grant with its reason; it is not a club-feed post', r.logs.some(l => l.grant && l.grant.type === 'manual_president_grant' && l.grant.reason === 'Designed the gala posters' && l.feed === false));
  t('grant: other members do not get the reason', !(await call('GET', '/api/bootstrap', { user: max })).json.logs.some(l => l.uid === 4 && l.grant));

  /* ================= QR check-in: API ================= */
  ({ call, T, app } = world([ev(), ev({ id: 2, sector: 'Finance', title: 'Bake sale' }), ev({ id: 3, title: 'Book fair', days: 3 }), ev({ id: 4, title: 'Old drive', is_active: 0 })]));
  const ck = (user, body) => call('POST', '/api/events/checkin', { user, body });
  t('checkin: logged out -> 401; member -> 403; other sector lead -> 403',
    (await ck(null, { eventId: 1, userId: 4 })).code === 401 && (await ck(max, { eventId: 1, userId: 4 })).code === 403 && (await ck(fay, { eventId: 1, userId: 4 })).code === 403 && T.hour_logs.length === 0);
  t('checkin: bad ids -> 400, unknown event -> 404, unknown member -> 404',
    (await ck(lead, { eventId: 'x', userId: 4 })).code === 400 && (await ck(lead, { eventId: 1, userId: 'abc' })).code === 400 && (await ck(lead, { eventId: 99, userId: 4 })).code === 404 && (await ck(lead, { eventId: 1, userId: 99 })).code === 404);
  t('checkin: inactive event -> 409; yourself -> 403; volunteer -> 403; not signed up -> 403 naming the member',
    (await ck(lead, { eventId: 4, userId: 4 })).code === 409 && (await ck(pres, { eventId: 1, userId: 2 })).code === 403 && (await ck(lead, { eventId: 1, userId: 6 })).code === 403 &&
    (r = await ck(lead, { eventId: 2, userId: 7 }), r.code === 403) && T.hour_logs.length === 0);
  r = await ck(pres, { eventId: 2, userId: 7 });
  t('checkin: a member who is not on the roster is refused by name', r.code === 403 && /Fay Finance is not signed up for Bake sale/.test(r.json.error), r.json);
  r = await ck(lead, { eventId: 1, userId: 4 });
  const cl = T.hour_logs[0];
  t('checkin: lead scans a signed-up member -> approved hours of the event', r.code === 201 && cl.status === 'approved' && cl.hours === 2 && cl.event_id === 1 && cl.user_id === 4 && cl.reviewed_by === 3 && cl.grant_type === 'qr_checkin' && cl.granted_by === 3, cl);
  t('checkin: response gives the name and hours for the confirmation', r.json.member.name === 'Mia Member' && r.json.hours === 2 && r.json.day === 1, r.json);
  r = await ck(lead, { eventId: 1, userId: 4 });
  t('checkin: scanning the same badge again -> 409 duplicate, nothing new stored', r.code === 409 && r.json.duplicate === true && /already checked in/.test(r.json.error) && T.hour_logs.length === 1, r.json);
  t('checkin: a President can check in at any sector; admin too', (await ck(pres, { eventId: 2, userId: 4 })).code === 201 && (await ck(admin, { eventId: 2, userId: 5 })).code === 201);
  t('checkin: audit log records each scan', T.audit_logs.filter(a => a.action === 'hours.qr_checkin').length === 3);
  T.hour_logs.push({ id: 50, user_id: 5, event_id: 1, hours: 2, day: 1, status: 'pending', created_at: new Date().toISOString() });
  t('checkin: a member who already self-submitted today counts as checked in', (await ck(lead, { eventId: 1, userId: 5 })).code === 409);
  T.hour_logs.find(l => l.id === 50).status = 'rejected';
  r = await ck(lead, { eventId: 1, userId: 5 });
  t('checkin: a rejected day can be redone by scan (same row, now approved)', r.code === 201 && T.hour_logs.find(l => l.id === 50).status === 'approved' && T.hour_logs.filter(l => l.user_id === 5 && l.event_id === 1).length === 1);
  r = await ck(lead, { eventId: 3, userId: 4 });
  t('checkin: multi-day event logs day 1, then refuses a second scan the same day', r.code === 201 && r.json.day === 1 && r.json.days === 3 && (await ck(lead, { eventId: 3, userId: 4 })).code === 409);
  T.hour_logs.find(l => l.event_id === 3).created_at = '2026-01-01T09:00:00Z';
  t('checkin: on a later day the next scan logs day 2', (r = await ck(lead, { eventId: 3, userId: 4 }), r.code === 201 && r.json.day === 2), r.json);
  t('checkin: approved hours show up in totals straight away; door check-ins stay out of the photo feed',
    (b => b.members.find(m => m.id === 4).out === 8 && !b.logs.some(l => l.grant && l.feed))((await call('GET', '/api/bootstrap', { user: mia })).json), (await call('GET', '/api/bootstrap', { user: mia })).json.members);

  /* ================= event management by an admin account (bug: delete refused "own sector") ================= */
  ({ call, T, app } = world([ev({ id: 1, sector: 'Community', title: 'DSADA' }), ev({ id: 2, sector: 'Community', title: 'Used' })], []));
  T.hour_logs.push({ id: 1, user_id: 4, event_id: 2, hours: 2, day: 1, status: 'approved' });
  t('events: an admin can mark any sector\'s event inactive and show its live code', (await call('PATCH', '/api/events/1', { user: admin, body: { active: false } })).code === 200 && T.events[0].is_active === 0 &&
    (await call('GET', '/api/events/1/qr', { user: admin })).code === 200);
  t('events: an admin can delete an event with no hours; one with hours is still kept (409)', (await call('DELETE', '/api/events/2', { user: admin })).code === 409 && (r = await call('DELETE', '/api/events/1', { user: admin }), r.code === 200) && T.events.length === 1, r && r.json);
  t('events: a lead of another sector and a member are still refused', (await call('DELETE', '/api/events/2', { user: lead })).code === 403 && (await call('PATCH', '/api/events/2', { user: mia, body: { active: false } })).code === 403);

  /* ================= screens ================= */
  ({ call, T, app } = world());
  const pat = await openAs(app, T, row(T, 2));
  await pat.go('pres', 'center');
  t('command center: six metrics in one flat strip, actions in the header row', /<div class="statstrip"[^>]*>(<div class="card tile"><b>[^<]*<\/b><span>[^<]*<\/span><\/div>){6}<\/div>/.test(pat.app()) &&
    /class="row between sechead">[\s\S]*Command center[\s\S]*Manage roster[\s\S]*Export report[\s\S]*\+ Grant Hours[\s\S]*<\/div><\/div>\s*<div class="statstrip"/.test(pat.app()), pat.app().slice(0, 1500));
  t('grant dialog is closed until asked for', pat.modal() === '');
  await pat.go('pres', 'roster'); t('roster header also offers + Grant Hours', /<h2>Roster<\/h2><button class="btn gold sm" data-act="grantopen">\+ Grant Hours<\/button>/.test(pat.app()));
  await pat.act('grantopen');
  const opts = [...pat.modal().matchAll(/<option value="(\d+)">([^<]*)</g)].map(m => m[2]);
  t('grant dialog: members come from live data (no volunteers, admins or yourself)', /Grant service hours/.test(pat.modal()) && opts.length === 4 && opts.every(o => /Lee Lead|Mia Member|Max Member|Fay Finance/.test(o)), opts);
  t('grant dialog: hours step 0.5 min 0.5, date defaults to today', /id="gr-h" name="hours" min="0\.5" max="100" step="0\.5"/.test(pat.modal()) && new RegExp('id="gr-d" name="date" value="\\d{4}-\\d{2}-\\d{2}"').test(pat.modal()));
  await pat.act('grantgo'); t('grant dialog: submitting without a member is stopped in the page', T.hour_logs.length === 0 && /Choose a member/.test(pat.el('#gr-err').textContent));
  pat.setVal('gr-m', '4'); pat.setVal('gr-h', '1.5'); pat.setVal('gr-r', 'Ran the bake sale stall'); pat.setVal('gr-y', 'out');
  await pat.act('grantgo');
  t('grant dialog: submit stores the grant, closes the dialog, refreshes totals', T.hour_logs.length === 1 && T.hour_logs[0].hours === 1.5 && T.hour_logs[0].grant_scope === 'out' && pat.modal() === '' && /Granted 1\.5 h to Mia Member/.test(pat.toast()) && pat.X.M.find(m => m.id === '4').out === 1.5);
  await pat.go('member', 'home'); t('a member preview never shows + Grant Hours', !/Grant Hours/.test(pat.app()));
  const lee = await openAs(app, T, row(T, 3)); await lee.go('pres', 'center');
  t('a Sector Head cannot reach the President view or the grant button', lee.X.S.role !== 'pres' || !/Grant Hours/.test(lee.app()));

  const mia2 = await openAs(app, T, row(T, 4));
  t('member home: the grant appears in My recent logs with its reason', /Ran the bake sale stall/.test(mia2.text()) && /President grant/.test(mia2.text()) && /1\.5 h/.test(mia2.text()));
  t('member home: Show My Check-In QR button, no QR box until asked', /data-act="myqr">Show My Check-In QR</.test(mia2.app()) && mia2.modal() === '');
  await mia2.act('myqr');
  t('QR badge dialog opens with the member name (generator loads on demand)', /Check-in badge/.test(mia2.modal()) && /Mia Member/.test(mia2.modal()) && /id="myQr"/.test(mia2.modal()), mia2.modal());
  await mia2.act('cic'); t('QR badge dialog closes', mia2.modal() === '');

  await lee.go('lead', 'events');
  t('lead events: Scan QR Check-In on active events only', /data-act="scanopen" data-id="1">Scan QR Check-In</.test(lee.app()));
  T.events[0].is_active = 0; await lee.act('retry'); await lee.go('lead', 'events');
  t('lead events: no scanner button on an inactive event', !/Scan QR Check-In/.test(lee.app()));
  T.events[0].is_active = 1; await lee.act('retry'); await lee.go('lead', 'events');
  await lee.act('scanopen', { id: '1' });
  t('scanner dialog: camera area, status line, roster fallback; no camera means a clear message', /QR check-in/.test(lee.modal()) && /id="qrReader"/.test(lee.modal()) && /id="scanPick"/.test(lee.modal()) && /Could not load the camera scanner|camera is not available/.test(lee.el('#scanMsg').innerHTML), lee.el('#scanMsg').innerHTML);
  lee.setVal('scanPick', '5'); await lee.act('scanpick');
  t('scanner: checking a member in shows name and hours, keeps the dialog open', /Max Member<\/b> checked in/.test(lee.el('#scanMsg').innerHTML) && /\+2\.0 h/.test(lee.el('#scanMsg').innerHTML) && /id="qrReader"/.test(lee.modal()) && T.hour_logs.some(l => l.user_id === 5 && l.grant_type === 'qr_checkin' && l.status === 'approved'));
  await lee.act('scanpick');
  t('scanner: the same member again shows "already checked in"', /already checked in/.test(lee.el('#scanMsg').innerHTML) && /warn/.test(lee.el('#scanMsg').className) && T.hour_logs.filter(l => l.user_id === 5).length === 1);
  lee.X.A.scanpick && (lee.setVal('scanPick', '4'), await lee.act('scanpick'));
  t('scanner: ready for the next member in line', /Mia Member<\/b> checked in/.test(lee.el('#scanMsg').innerHTML));
  await lee.act('cic'); t('scanner dialog closes cleanly', lee.modal() === '');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(1); });
