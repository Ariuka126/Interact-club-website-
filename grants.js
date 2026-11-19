// President hour grants (POST /api/hours/grant) and officer QR check-in (POST /api/events/checkin):
// permissions, validation, duplicates, totals everywhere, and the screens that drive them. Run: node grants.js
const { loadApp, openAs } = require('./harness');
process.env.SESSION_SECRET = 'test-secret';
const K = require('./lib');
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
  const a = loadApp(T); return { ...a, T, app: { call: a.call }, srv: a.app };
};
const TODAY = new Date().toISOString().slice(0, 10);
const G = o => ({ memberId: 4, hours: 3, date: TODAY, reason: 'Designed the gala posters', notes: 'Checked by Pat', ...o });
const row = (T, id) => T.users.find(u => u.id === id);

(async () => {
  /* ================= President grant: API ================= */
  let { call, T, app } = world([]), r;
  const grant = (user, body) => call('POST', '/api/hours/grant', { user, body });
  t('grant: logged out -> 401, member/volunteer -> 403, Sector Head outside their sector -> 403, nothing stored',
    (await grant(null, G())).code === 401 && (await grant(mia, G({ memberId: 5 }))).code === 403 && (await grant(vic, G())).code === 403 &&
    (await grant(lead, G({ memberId: 5 }))).code === 403 && (await grant(fay, G({ memberId: 4 }))).code === 403 && T.hour_logs.length === 0);
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
  t('grant: counts on the certificate, and its reason is listed as a project', (c => c.in === 2.5 && c.out === 0 && c.projects.includes('Designed the gala posters'))((await call('GET', '/api/certificate/4', { user: mia })).json));
  t('grant: counts in the Rotary CSV', /,Mia Member,active,Events,2\.5,0,2\.5,L1/.test((await call('GET', '/api/export', { user: pres })).text || ''), (await call('GET', '/api/export', { user: pres })).text);
  r = await grant(lead, G({ memberId: 4, hours: 1, reason: 'Ran the Events stall' }));
  t('grant: a Sector Head can grant to a member of their own sector', r.code === 201 && T.hour_logs.at(-1).granted_by === 3 && T.audit_logs.at(-1).actor_id === 3, r.json);
  t('grant: a Sector Head with no sector is refused', (await grant({ ...lead, id: 9, sector: null }, G())).code === 403);
  T.hour_logs.pop(); // keep the totals below about the President grants

  /* revoking a grant: Override with a written reason (Recent decisions) */
  r = (await call('GET', '/api/hours/decided', { user: pres })).json.logs.find(l => l.id === gl.id);
  t('decided: a grant is labelled as a grant, not "Deleted event"', r && r.event === null && r.grant && r.grant.type === 'manual_president_grant' && r.grant.reason === 'Designed the gala posters', r);
  const ov = (body, user = pres) => call('POST', `/api/hours/${gl.id}/override`, { user, body });
  t('revoke: needs a written reason (10+ chars), cannot go back to pending', (await ov({ status: 'rejected', reason: 'oops' })).code === 400 && (await ov({ status: 'pending', reason: 'Wrong member was chosen' })).code === 400 && gl.status === 'approved');
  t('revoke: a Sector Head cannot revoke', (await ov({ status: 'rejected', reason: 'Wrong member was chosen' }, lead)).code === 403);
  r = await ov({ status: 'rejected', reason: 'Wrong member was chosen' });
  t('revoke: President revokes with a reason -> rejected, audited, totals drop', r.code === 200 && gl.status === 'rejected' &&
    T.audit_logs.some(a => a.action === 'hours.override' && a.details.reason === 'Wrong member was chosen' && a.details.to === 'rejected') &&
    (await call('GET', '/api/bootstrap', { user: pres })).json.members.find(m => m.id === 4).in === 0, r.json);
  t('restore: the grant can be approved again', (await ov({ status: 'approved', reason: 'Checked again, it was right' })).code === 200 && gl.status === 'approved');

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

  /* ================= live phone badge ================= */
  ({ call, T, app } = world([ev(), ev({ id: 2, title: 'Gala', capacity: 3 }), ev({ id: 3, title: 'Zoo trip', waiver_required: 1 })], [4]));
  r = await call('GET', '/api/badge', { user: mia });
  t('badge: a member gets a signed code that expires within 30 s; never cached', r.code === 200 && /^ICH1\.4\.\d+\.[A-Za-z0-9_-]{16}$/.test(r.json.token) && r.json.expiresIn >= 1 && r.json.expiresIn <= 30 && r.hdr['Cache-Control'] === 'no-store', r.json);
  t('badge: volunteers, admins and logged-out users get none', (await call('GET', '/api/badge', { user: vic })).code === 403 && (await call('GET', '/api/badge', { user: admin })).code === 403 && (await call('GET', '/api/badge', {})).code === 401);
  const tok = r.json.token;
  t('badge: scanning a live code checks the member in', (r = await ck(lead, { eventId: 1, badge: tok }), r.code === 201 && r.json.member.name === 'Mia Member') && T.audit_logs.at(-1).details.via === 'badge', r.json);
  const forged = tok.replace(/^ICH1\.4\./, 'ICH1.5.');
  t('badge: changing the member id breaks the signature -> 400, nobody checked in', (r = await ck(lead, { eventId: 2, badge: forged }), r.code === 400 && /not a live club check-in badge/.test(r.json.error)) && !T.hour_logs.some(l => l.user_id === 5), r.json);
  t('badge: a printed id ("interact-member:4" or "4") is refused', (await ck(lead, { eventId: 2, badge: 'interact-member:4' })).code === 400 && (await ck(lead, { eventId: 2, badge: '4' })).code === 400);
  t('badge: a code older than a minute has expired -> 400', (r = await ck(lead, { eventId: 2, badge: K.badgeToken(4, Date.now() - 95000) }), r.code === 400 && /expired/.test(r.json.error)), r.json);
  t('badge: the previous 30-second code still works (slow scan at the edge of a window)', (await ck(lead, { eventId: 2, badge: K.badgeToken(4, Date.now() - 30000) })).code === 201);

  /* ================= walk-ins ================= */
  r = await ck(lead, { eventId: 2, badge: K.badgeToken(5) });
  t('walk-in: someone not signed up -> 403 with notSignedUp and their name, nothing stored', r.code === 403 && r.json.notSignedUp === true && r.json.member.name === 'Max Member' && !T.signups.some(s => s.user_id === 5), r.json);
  r = await ck(lead, { eventId: 2, badge: K.badgeToken(5), walkIn: true });
  t('walk-in: confirmed -> signed up and checked in in one step', r.code === 201 && r.json.walkIn === true && T.signups.some(s => s.user_id === 5 && s.event_id === 2 && s.is_volunteer === 0) && T.hour_logs.some(l => l.user_id === 5 && l.event_id === 2 && l.status === 'approved'), r.json);
  T.signups.push({ id: 90, user_id: 7, event_id: 2, is_volunteer: 0, shift: null }); // Gala now 3 of 3
  t('walk-in: a full event refuses walk-ins (409)', (r = await ck(lead, { eventId: 2, userId: 3, walkIn: true }), r.code === 403 || r.code === 409) && (await ck(pres, { eventId: 2, userId: 3, walkIn: true })).code === 409 && !T.signups.some(s => s.user_id === 3 && s.event_id === 2));
  t('walk-in: an event that needs a waiver refuses walk-ins (409)', (r = await ck(lead, { eventId: 3, userId: 5, walkIn: true }), r.code === 409 && /waiver/.test(r.json.error)), r.json);
  t('walk-in: a keeplist volunteer is still refused', (await ck(lead, { eventId: 1, userId: 6, walkIn: true })).code === 403);

  /* ================= database not migrated yet (006 not run) ================= */
  let srv; ({ call, T, app, srv } = world());
  const real = srv.locals.supabase;
  srv.locals.supabase = { from(name) { const q = real.from(name); let broken = false;
    const P = new Proxy(q, { get(tg, k) {
      if (k === 'then') return (res, rej) => (broken ? Promise.resolve({ data: null, error: { code: '42703', message: 'column hour_logs.grant_type does not exist' } }) : tg).then(res, rej);
      const v = tg[k]; if (typeof v !== 'function') return v;
      return (...a) => { if (name === 'hour_logs' && /grant_/.test(JSON.stringify(a))) broken = true; v.apply(tg, a); return P; };
    } }); return P; } };
  r = await call('GET', '/api/bootstrap', { user: mia });
  t('no migration: the app still loads (bootstrap 200), grants reported off', r.code === 200 && r.json.features.grants === false && r.json.members.length === 7, r.json);
  t('no migration: stats, certificate and CSV still work', (await call('GET', '/api/stats/', { user: pres })).code === 200 && (await call('GET', '/api/certificate/4', { user: mia })).code === 200 && (await call('GET', '/api/export', { user: pres })).code === 200);
  t('no migration: grant and check-in say what to run (503), nothing stored', (r = await grant(pres, G()), r.code === 503 && /006_hour_grants\.sql/.test(r.json.error)) && (await ck(lead, { eventId: 1, userId: 4 })).code === 503 && T.hour_logs.length === 0);
  t('no migration: Recent decisions still loads', (await call('GET', '/api/hours/decided', { user: pres })).code === 200);
  const old = await openAs(app, T, row(T, 4));
  t('no migration: member home renders without the badge button', /My recent logs/.test(old.text()) && !/Show My Check-In QR/.test(old.app()));

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

  /* ================= Sector Head grants, labels, revoke, Command Center events, audit names (screens) ================= */
  ({ call, T, app } = world());
  const lee2 = await openAs(app, T, row(T, 3));
  await lee2.go('lead', 'review');
  t('Sector Head: + Grant Hours in the Approvals header for their own sector', /sechead[\s\S]*Hours waiting for you[\s\S]*data-act="grantopen"/.test(lee2.app()));
  await lee2.act('grantopen');
  const lopts = [...lee2.modal().matchAll(/<option value="(\d+)">([^<]*)</g)].map(m => m[2]);
  t('Sector Head grant dialog lists only members of their sector', /Sector Head tools/.test(lee2.modal()) && lopts.length === 1 && /Mia Member/.test(lopts[0]), lopts);
  lee2.setVal('gr-m', '4'); lee2.setVal('gr-h', '1'); lee2.setVal('gr-r', 'Set up the Events stall');
  await lee2.act('grantgo');
  t('Sector Head grant goes through and closes the dialog', T.hour_logs.length === 1 && T.hour_logs[0].granted_by === 3 && lee2.modal() === '', lee2.toast());
  const fay2 = await openAs(app, T, row(T, 7)); fay2.X.S.lead = 'Events'; await fay2.go('lead', 'review');
  t('a Sector Head looking at another sector gets no grant button', !/data-act="grantopen"/.test(fay2.app()));
  const pat2 = await openAs(app, T, row(T, 2));
  await pat2.go('pres', 'over');
  t('Recent decisions: the grant is shown as "Grant: <reason>" with Revoke grant', /Grant: Set up the Events stall/.test(pat2.text()) && /data-g="1">Revoke grant</.test(pat2.app()) && !/Deleted event/.test(pat2.text()), pat2.text().slice(-500));
  await pat2.act('ovopen', { id: String(T.hour_logs[0].id), to: 'rejected', g: '1' });
  t('revoke dialog asks for a written reason', /Revoke this grant/.test(pat2.modal()) && /Reason \(at least 10 characters\)/.test(pat2.modal()));
  pat2.setVal('ov-reason', 'Duplicate of the event check-in'); await pat2.act('ovgo');
  t('revoke from the screen: grant rejected, reason audited, shows Restore grant', T.hour_logs[0].status === 'rejected' && T.audit_logs.some(a => a.action === 'hours.override' && a.details.reason === 'Duplicate of the event check-in') && (await pat2.go('pres', 'over'), /Restore grant/.test(pat2.app())));
  await pat2.go('pres', 'center');
  t('Command Center: active events listed with a Scan QR Check-In button', /Active events[\s\S]*Library Drive[\s\S]*data-act="scanopen" data-id="1"/.test(pat2.app()));
  await pat2.act('scanopen', { id: '1' });
  t('Command Center scan opens the door scanner; roster lists signed-up and walk-in members', /QR check-in/.test(pat2.modal()) && /optgroup label="Signed up"/.test(pat2.modal()) && /optgroup label="Not signed up \(walk-in\)"[\s\S]*Lee Lead/.test(pat2.modal()));
  pat2.setVal('scanPick', '3'); await pat2.act('scanpick');
  t('roster pick of a non-signed-up member offers the walk-in button', /not signed up/.test(pat2.el('#scanMsg').innerHTML) && /data-act="scanwalkin"/.test(pat2.el('#scanMsg').innerHTML));
  await pat2.act('scanwalkin');
  t('walk-in from the screen: signed up and checked in', /Lee Lead<\/b> checked in as a walk-in/.test(pat2.el('#scanMsg').innerHTML) && T.signups.some(s => s.user_id === 3 && s.event_id === 1), pat2.el('#scanMsg').innerHTML);
  await pat2.act('cic');
  await pat2.go('pres', 'audit');
  t('audit log: readable action names, raw ids still shown', /Granted hours/.test(pat2.text()) && /hours\.grant/.test(pat2.text()) && /QR check-in/.test(pat2.text()) && /Changed a decision/.test(pat2.text()));
  const mia4 = await openAs(app, T, row(T, 4)); await mia4.act('myqr');
  t('badge dialog: live code wording, no printable id in the page', /changes every 30 seconds/.test(mia4.modal()) && !/interact-member:/.test(mia4.modal()) && mia4.state.calls.includes('GET /api/badge'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(1); });
