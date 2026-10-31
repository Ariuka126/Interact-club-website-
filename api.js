// API-level checks: permissions, validation and data scoping. Run: node tests/api.js
const { loadApp } = require('./harness');
const K = require('./lib');
process.env.SESSION_SECRET = 'test-secret';
let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : JSON.stringify(d).slice(0, 300))); };

const U = (id, role, sector = null, name = role + id) => ({ id, name, email: name.replace(/\W/g, '') + '@x.com', role, sector, password_hash: 'secret-hash', promotion_requested: 0, created_at: `2026-01-0${id}T00:00:00Z` });
const admin = U(1, 'admin', null, 'Ann'), pres = U(2, 'pres', null, 'Pat'), lead = U(3, 'lead', 'Events', 'Lee'), mia = U(4, 'member', 'Events', 'Mia'),
  max = U(5, 'member', 'Creative', 'Max'), vic = U(6, 'volunteer'), fay = U(7, 'lead', 'Finance', 'Fay'), nosec = U(9, 'lead');
const ev = o => ({ id: 1, title: 'Fair', sector: 'Events', hours: 2, capacity: 9, volunteer_slots: 1, location: 'Hall', date_label: 'Oct 31', type: 'in', verification: '["qr","selfie"]',
  shifts: null, points: null, days: null, waiver_required: 0, is_setup: 0, is_active: 1, lat: null, lng: null, created_by: 1, created_at: '2026-01-01T00:00:00Z', ...o });
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const code = id => K.qrCode(id, K.qrWindow());
const world = (events = [ev()], signed = [4, 5]) => {
  const a = loadApp({ users: [admin, pres, lead, mia, max, vic, fay, nosec].map(u => ({ ...u })), events, signups: [], hour_logs: [], log_cheers: [], log_comments: [] });
  for (const e of events) for (const uid of signed) a.T.signups.push({ id: a.T.signups.length + 1, user_id: uid, event_id: e.id, is_volunteer: 0, shift: null });
  return a;
};

(async () => {
  let { call, T } = world([], []), r;
  /* ---- creating events ---- */
  const good = { title: 'Library Drive', hours: 2, capacity: 12, type: 'in', verification: ['qr', 'selfie'] };
  t('create: only leads and above', (await call('POST', '/api/events', { user: mia, body: good })).code === 403 && (await call('POST', '/api/events', { user: vic, body: good })).code === 403 && (await call('POST', '/api/events', { body: good })).code === 401);
  r = await call('POST', '/api/events', { user: lead, body: { ...good, sector: 'Finance' } });
  t('create: a lead is forced into their own sector', r.code === 201 && r.json.event.sector === 'Events');
  t('create: lead without a sector is told so', (await call('POST', '/api/events', { user: nosec, body: good })).code === 400);
  t('create: pres must choose a sector', (await call('POST', '/api/events', { user: pres, body: good })).code === 400 && (await call('POST', '/api/events', { user: pres, body: { ...good, sector: 'Creative' } })).code === 201);
  for (const [n, p] of [['title too short', { title: 'a' }], ['0 hours', { hours: 0 }], ['13 hours', { hours: 13 }], ['capacity 0', { capacity: 0 }], ['no verification', { verification: [] }], ['unknown method', { verification: ['telepathy'] }], ['bad type', { type: 'moon' }], ['days 0', { days: 0 }], ['GPS without venue', { verification: ['gps'] }], ['bad coordinates', { verification: ['gps'], lat: 200, lng: 0 }]])
    t('create: rejects ' + n, (await call('POST', '/api/events', { user: lead, body: { ...good, ...p } })).code === 400);
  t('create: nothing stored for the rejected ones', T.events.length === 2);

  /* ---- editing and deleting ---- */
  ({ call, T } = world([ev({ id: 1 }), ev({ id: 2, sector: 'Finance' })]));
  t('edit: other sector -> 403, member -> 403', (await call('PATCH', '/api/events/2', { user: lead, body: { capacity: 3 } })).code === 403 && (await call('PATCH', '/api/events/1', { user: mia, body: { capacity: 3 } })).code === 403);
  t('edit: fields outside the whitelist are ignored', (await call('PATCH', '/api/events/1', { user: lead, body: { sector: 'Finance', created_by: 9, active: false } })).code === 200 && T.events[0].sector === 'Events' && T.events[0].created_by === 1 && T.events[0].is_active === 0);
  T.hour_logs.push({ id: 1, user_id: 4, event_id: 2, hours: 2, day: 1, status: 'approved' });
  t('delete: an event with logged hours is kept (409)', (await call('DELETE', '/api/events/2', { user: fay })).code === 409 && T.events.length === 2);
  t('delete: other sector -> 403; empty event can go', (await call('DELETE', '/api/events/1', { user: fay })).code === 403 && (await call('DELETE', '/api/events/1', { user: lead })).code === 200);

  /* ---- sign-up rules ---- */
  ({ call, T } = world([ev({ id: 1, capacity: 1 }), ev({ id: 2, waiver_required: 1, shifts: '["A","B"]' })], []));
  t('signup: volunteers cannot', (await call('POST', '/api/events/1/signup', { user: vic })).code === 403);
  t('signup: capacity enforced, duplicates refused', (await call('POST', '/api/events/1/signup', { user: mia })).code === 201 && (await call('POST', '/api/events/1/signup', { user: mia })).code === 409 && (await call('POST', '/api/events/1/signup', { user: max })).code === 409);
  t('signup: waiver event needs a typed name, which is recorded', (await call('POST', '/api/events/2/signup', { user: mia, body: {} })).code === 400 && (await call('POST', '/api/events/2/signup', { user: mia, body: { waiverName: 'Mia Example' } })).code === 201 && !!T.signups.find(s => s.event_id === 2).waiver_signed_at);
  t('signup: next member goes to the emptier booth', (await call('POST', '/api/events/2/signup', { user: max, body: { waiverName: 'Max Example' } })).json.shift !== T.signups.find(s => s.event_id === 2 && s.user_id === 4).shift);
  t('volunteer slots: only volunteers, limited to the slot count', (await call('POST', '/api/events/2/volunteer', { user: mia })).code === 403 && (await call('POST', '/api/events/1/volunteer', { user: vic })).code === 201 && (await call('POST', '/api/events/1/volunteer', { user: U(10, 'volunteer') })).code !== 201);

  /* ---- live code ---- */
  ({ call, T } = world([ev({ id: 1, verification: '["qr"]' })], [4]));
  r = await call('GET', '/api/events/1/qr', { user: lead });
  t('code: own-sector lead gets a 6-digit code and a countdown, never cached', r.code === 200 && /^\d{6}$/.test(r.json.code) && r.json.expiresIn >= 1 && r.json.expiresIn <= 30 && r.hdr['Cache-Control'] === 'no-store');
  t('code: members, other-sector leads and strangers cannot read it', (await call('GET', '/api/events/1/qr', { user: mia })).code === 403 && (await call('GET', '/api/events/1/qr', { user: fay })).code === 403 && (await call('GET', '/api/events/1/qr', {})).code === 401);
  t('code: checking needs a sign-up; right code true, wrong false', (await call('POST', '/api/events/1/verify-qr', { user: max, body: { code: r.json.code } })).code === 403 && (await call('POST', '/api/events/1/verify-qr', { user: mia, body: { code: r.json.code } })).json.ok === true && (await call('POST', '/api/events/1/verify-qr', { user: mia, body: { code: 'abcdef' } })).json.ok === false);
  t('code: old windows stop working (clock test)', K.qrValid(1, K.qrCode(1, 100), 100 * 30000 + 5000) && K.qrValid(1, K.qrCode(1, 99), 100 * 30000 + 5000) && !K.qrValid(1, K.qrCode(1, 98), 100 * 30000 + 5000) && !K.qrValid(2, K.qrCode(1, 100), 100 * 30000 + 5000));

  /* ---- submitting hours ---- */
  ({ call, T } = world([ev({ id: 1, verification: '["qr","selfie"]' })]));
  const sub = (user, body) => call('POST', '/api/hours', { user, body });
  t('submit: volunteers and strangers refused', (await sub(vic, { eventId: 1 })).code === 403 && (await sub(null, { eventId: 1 })).code === 401);
  t('submit: not signed up -> 403', (await sub(lead, { eventId: 1, code: code(1), photo: PHOTO })).code === 403);
  const wrong = code(1) === '123456' ? '654321' : '123456';
  t('submit: wrong code, missing photo, non-image photo, script URL, oversize photo all refused', (await sub(mia, { eventId: 1, code: wrong, photo: PHOTO })).code === 400 && (await sub(mia, { eventId: 1, code: code(1) })).code === 400
    && (await sub(mia, { eventId: 1, code: code(1), photo: 'data:text/html;base64,PGI+' })).code === 400 && (await sub(mia, { eventId: 1, code: code(1), photo: 'javascript:alert(1)' })).code === 400
    && (await sub(mia, { eventId: 1, code: code(1), photo: 'data:image/jpeg;base64,' + 'A'.repeat(600001) })).code === 400 && T.hour_logs.length === 0);
  r = await sub(mia, { eventId: 1, code: code(1), photo: PHOTO, hours: 99, status: 'approved', userId: 5 });
  t('submit: pending, hours from the event not the client, owner is the caller', r.code === 201 && T.hour_logs[0].hours === 2 && T.hour_logs[0].status === 'pending' && T.hour_logs[0].user_id === 4);
  t('submit: a second log for a one-day event -> 409', (await sub(mia, { eventId: 1, code: code(1), photo: PHOTO })).code === 409);
  ({ call, T } = world([ev({ id: 3, verification: '["link"]', sector: 'Creative' })]));
  t('link: missing, no dot, javascript:, too short all refused', [undefined, 'justwords', 'javascript:alert(1)', 'a.b'].every(async l => true) && (await call('POST', '/api/hours', { user: max, body: { eventId: 3 } })).code === 400 && (await call('POST', '/api/hours', { user: max, body: { eventId: 3, link: 'justwords' } })).code === 400 && (await call('POST', '/api/hours', { user: max, body: { eventId: 3, link: 'javascript:alert(1)' } })).code === 400);
  await call('POST', '/api/hours', { user: max, body: { eventId: 3, link: 'drive.google.com/file/abc' } });
  t('link: a bare domain is stored with https://', T.hour_logs[0] && T.hour_logs[0].work_link === 'https://drive.google.com/file/abc', T.hour_logs[0]);
  ({ call, T } = world([ev({ id: 2, type: 'out', verification: '["gps"]', lat: 47.9184, lng: 106.9177 })]));
  const g = (user, dLat) => call('POST', '/api/hours', { user, body: { eventId: 2, lat: 47.9184 + dLat, lng: 106.9177 } });
  t('gps: no position and a far position refused (message gives the distance)', (await call('POST', '/api/hours', { user: mia, body: { eventId: 2 } })).code === 400 && /\d+ m from the venue/.test((await g(mia, 0.0116)).json.error));
  t('gps: 199 m accepted and the position stored, 250 m refused', (await g(mia, 0.00179)).code === 201 && T.hour_logs[0].gps_lat > 47.92 && (await g(max, 0.00225)).code === 400);
  ({ call, T } = world([ev({ id: 4, days: 3, verification: '["selfie"]' })]));
  const s4 = () => call('POST', '/api/hours', { user: mia, body: { eventId: 4, photo: PHOTO } });
  const days = []; for (let i = 0; i < 3; i++) days.push((await s4()).json.day);
  t('multi-day: numbered 1, 2, 3; a fourth is refused', days.join() === '1,2,3' && (await s4()).code === 409);
  T.hour_logs.find(l => l.day === 2).status = 'rejected'; r = await s4();
  t('multi-day: a rejected day is redone in place, old review cleared', r.json.day === 2 && T.hour_logs.length === 3 && T.hour_logs.find(l => l.day === 2).status === 'pending' && T.hour_logs.find(l => l.day === 2).reviewed_by === null);
  ({ call, T } = world([ev({ id: 5, verification: '["selfie"]' })]));
  const o5 = ov => call('POST', '/api/hours', { user: mia, body: { eventId: 5, photo: PHOTO, overtime: ov } });
  t('overtime: needs a real reason and 0.5 to 3 hours; nothing saved on refusal', (await o5({ hours: 1, reason: 'stayed' })).code === 400 && (await o5({ hours: 4, reason: 'Stayed to water the seedlings' })).code === 400 && T.hour_logs.length === 0);
  t('overtime: valid request stored as pending', (await o5({ hours: 1, reason: 'Stayed to water the seedlings', proof: 'https://photos.example/seedlings.jpg' })).code === 201 && T.hour_logs[0].overtime_status === 'pending' && T.hour_logs[0].overtime_proof_url === 'https://photos.example/seedlings.jpg');

  /* ---- reviewing ---- */
  ({ call, T } = world([ev({ id: 1, sector: 'Events' }), ev({ id: 2, sector: 'Finance' })]));
  T.hour_logs.push({ id: 1, user_id: 4, event_id: 1, hours: 2, day: 1, status: 'pending', flagged: 0, photo_data: PHOTO }, { id: 2, user_id: 4, event_id: 2, hours: 2, day: 1, status: 'pending', flagged: 0 },
    { id: 3, user_id: 3, event_id: 1, hours: 2, day: 1, status: 'pending', flagged: 0 });
  const rv = (user, id, status) => call('POST', `/api/hours/${id}/review`, { user, body: { status } });
  t('review: members and other-sector leads refused', (await rv(max, 1, 'approved')).code === 403 && (await rv(fay, 1, 'approved')).code === 403 && T.hour_logs[0].status === 'pending');
  t('review: own-sector lead approves; reviewer and time recorded; second review is 409', (await rv(lead, 1, 'approved')).code === 200 && T.hour_logs[0].reviewed_by === 3 && !!T.hour_logs[0].reviewed_at && (await rv(lead, 1, 'rejected')).code === 409);
  t('review: nobody reviews their own hours; a co-president can review a lead\'s', (await rv(lead, 3, 'approved')).code === 403 && (await rv(pres, 3, 'approved')).code === 200);
  t('review: pres can review any sector; bad status refused', (await rv(pres, 2, 'rejected')).code === 200 && (await rv(lead, 1, 'pending')).code === 400);
  T.hour_logs.push({ id: 4, user_id: 4, event_id: 1, hours: 2, day: 2, status: 'pending' }, { id: 5, user_id: 3, event_id: 1, hours: 2, day: 3, status: 'pending' });
  r = await call('POST', '/api/events/1/approve-all', { user: lead });
  t('approve-all: approves others\' pending hours, never the lead\'s own', r.json.approved === 1 && T.hour_logs[3].status === 'approved' && T.hour_logs[4].status === 'pending' && (await call('POST', '/api/events/1/approve-all', { user: mia })).code === 403);
  T.hour_logs.push({ id: 6, user_id: 4, event_id: 1, hours: 2, day: 4, status: 'approved', overtime_hours: 1, overtime_reason: 'x', overtime_status: 'pending' });
  const ot = (user, d) => call('POST', '/api/hours/6/overtime', { user, body: { decision: d } });
  t('overtime decision: leads cannot, pres can, only once', (await ot(lead, 'approved')).code === 403 && (await ot(pres, 'maybe')).code === 400 && (await ot(pres, 'approved')).code === 200 && (await ot(pres, 'denied')).code === 409);

  /* ---- photo access ---- */
  ({ call, T } = world([ev({ id: 1, sector: 'Events' }), ev({ id: 2, sector: 'Finance' })]));
  T.hour_logs.push({ id: 1, user_id: 4, event_id: 1, hours: 2, day: 1, status: 'pending', flagged: 0, photo_data: PHOTO }, { id: 2, user_id: 4, event_id: 1, hours: 2, day: 2, status: 'approved', flagged: 0, photo_data: PHOTO },
    { id: 3, user_id: 4, event_id: 1, hours: 2, day: 3, status: 'approved', flagged: 1, photo_data: PHOTO }, { id: 4, user_id: 4, event_id: 1, hours: 2, day: 4, status: 'approved', flagged: 0, photo_data: 'data:text/html;base64,PGI+' },
    { id: 5, user_id: 4, event_id: 2, hours: 2, day: 1, status: 'pending', flagged: 0, photo_data: PHOTO });
  const ph = (user, id) => call('GET', `/api/hours/${id}/photo`, { user });
  r = await ph(mia, 1);
  t('photo: owner gets real image bytes with the right type', r.code === 200 && r.hdr['Content-Type'] === 'image/jpeg' && r.buf.equals(Buffer.from('/9j/4AAQSkZJRgABAQ==', 'base64')) && r.hdr['X-Content-Type-Options'] === 'nosniff');
  t('photo: others cannot see a pending photo; members can see approved ones; flagged ones are hidden', (await ph(max, 1)).code === 403 && (await ph(max, 2)).code === 200 && (await ph(max, 3)).code === 403);
  t('photo: volunteers and strangers never', (await ph(vic, 2)).code === 403 && (await ph(null, 2)).code === 401);
  t('photo: lead sees their own sector\'s pending proof, not another sector\'s', (await ph(lead, 1)).code === 200 && (await ph(fay, 1)).code === 403 && (await ph(fay, 5)).code === 200);
  t('photo: staff see flagged; stored non-image data is never served', (await ph(pres, 3)).code === 200 && (await ph(pres, 4)).code === 404);

  /* ---- feed ---- */
  T.hour_logs.push({ id: 7, user_id: 4, event_id: 1, hours: 2, day: 7, status: 'pending', flagged: 0 });
  const fd = (user, id, what, body) => call('POST', `/api/hours/${id}/${what}`, { user, body });
  t('feed: volunteers refused; pending and flagged posts unavailable', (await fd(vic, 2, 'cheer')).code === 403 && (await fd(max, 7, 'cheer')).code === 404 && (await fd(max, 3, 'comment', { body: 'hi' })).code === 404);
  t('feed: cheer toggles on and off', (await fd(max, 2, 'cheer')).json.cheered === true && (await fd(max, 2, 'cheer')).json.cheered === false && T.log_cheers.length === 0);
  t('feed: comment trimmed and saved; empty and 301-char refused', (await fd(max, 2, 'comment', { body: '  Great work!  ' })).code === 201 && T.log_comments[0].body === 'Great work!' && (await fd(max, 2, 'comment', { body: '  ' })).code === 400 && (await fd(max, 2, 'comment', { body: 'x'.repeat(301) })).code === 400);
  t('feed: flag records no flagger; only pres/admin can dismiss or remove hours', (await fd(max, 2, 'flag')).code === 200 && T.hour_logs[1].flagged === 1 && !('flagged_by' in T.hour_logs[1]) && (await fd(max, 2, 'unflag')).code === 403 && (await fd(lead, 2, 'remove-hours')).code === 403);
  t('feed: pres dismisses; remove-hours rejects the log and clears the flag', (await fd(pres, 2, 'unflag')).code === 200 && T.hour_logs[1].flagged === 0 && (await fd(pres, 2, 'remove-hours')).code === 200 && T.hour_logs[1].status === 'rejected');

  /* ---- who can see what in bootstrap ---- */
  ({ call, T } = world([ev({ id: 1 }), ev({ id: 2, sector: 'Finance', type: 'out' })]));
  const L = o => ({ user_id: 4, event_id: 1, hours: 2, day: 1, status: 'approved', flagged: 0, photo_data: null, work_link: null, overtime_hours: null, overtime_reason: null, overtime_status: null, created_at: '2026-02-01T00:00:00Z', ...o });
  T.hour_logs.push(L({ id: 1, photo_data: 'data:image/jpeg;base64,AAAA', overtime_hours: 1, overtime_status: 'approved' }), L({ id: 2, user_id: 5, status: 'pending', day: 2 }), L({ id: 3, user_id: 5, event_id: 2, status: 'pending' }),
    L({ id: 4, day: 3, flagged: 1 }), L({ id: 5, user_id: 5, day: 4, overtime_hours: 1, overtime_status: 'pending' }), L({ id: 6, user_id: 4, event_id: 2, day: 1 }));
  T.users.find(u => u.id === 6).promotion_requested = 1;
  const boot = async user => (await call('GET', '/api/bootstrap', { user })).json, ids = b => b.logs.map(l => l.id).sort((a, b2) => a - b2).join();
  let b = await boot(mia);
  t('bootstrap(member): own logs + feed; others\' pending are not sent; flag not exposed; own flagged post kept out of the feed', ids(b) === '1,4,5,6' && b.logs.every(l => l.flagged === false) && b.logs.find(l => l.id === 4).feed === false && b.logs.find(l => l.id === 1).feed === true, b.logs.map(l => [l.id, l.feed]));
  t('bootstrap(member): totals only for yourself (approved + approved overtime, in/out split); no emails, hashes or raw photos', b.members.find(m => m.id === 4).in === 5 && b.members.find(m => m.id === 4).out === 2 && b.members.find(m => m.id === 5).in === 0 && !/@x\.com|secret-hash|AAAA/.test(JSON.stringify(b)));
  t('bootstrap(other member): someone else\'s flagged post is not sent at all', !(await boot(max)).logs.some(l => l.id === 4));
  b = await boot(vic); t('bootstrap(volunteer): no feed at all; sees only their own promotion request', b.logs.length === 0 && b.members.filter(m => m.req).length === 1);
  t('bootstrap(lead): own sector\'s pending only, club-wide totals', ids(await boot(lead)).includes('2') && !ids(await boot(lead)).split(',').includes('3') && (await boot(lead)).members.find(m => m.id === 5).in === 2);
  t('bootstrap(lead of another sector): sees the Finance one instead', ids(await boot(fay)).split(',').includes('3') && !ids(await boot(fay)).split(',').includes('2'));
  b = await boot(pres);
  t('bootstrap(pres): all pending, flagged (visible to them) and overtime requests; promotion requests', [2, 3, 4, 5].every(i => b.logs.some(l => l.id === i)) && b.logs.find(l => l.id === 4).flagged === true && b.members.find(m => m.id === 6).req === true);

  /* ---- roster, certificates, export ---- */
  t('promotion: volunteers ask; members cannot; leads cannot promote; pres can, and standby slots are released', (await call('POST', '/api/me/request-promotion', { user: mia })).code === 403 && (await call('POST', '/api/roster/promote', { user: lead, body: { userId: 6 } })).code === 403 && (T.signups.push({ id: 99, user_id: 6, event_id: 1, is_volunteer: 1 }), (await call('POST', '/api/roster/promote', { user: pres, body: { userId: 6 } })).code === 200) && T.users.find(u => u.id === 6).role === 'member' && !T.signups.some(s => s.user_id === 6) && (await call('POST', '/api/roster/promote', { user: pres, body: { userId: 4 } })).code === 409);
  r = await call('GET', '/api/certificate/4', { user: mia });
  t('certificate: own data, real totals, real signer; others\' only for staff', r.code === 200 && r.json.in === 5 && r.json.out === 2 && r.json.signers.join() === 'Pat' && (await call('GET', '/api/certificate/5', { user: mia })).code === 403 && (await call('GET', '/api/certificate/5', { user: lead })).code === 403 && (await call('GET', '/api/certificate/5', { user: pres })).code === 200);
  T.users.push(U(8, 'member', 'Events', '=SUM(A1),"Meg"'));
  r = await call('GET', '/api/export', { user: pres }); const lines = r.text.split('\n');
  t('export: pres/admin only', (await call('GET', '/api/export', { user: mia })).code === 403 && (await call('GET', '/api/export', { user: lead })).code === 403 && (await call('GET', '/api/export', { user: admin })).code === 200);
  t('export: Rotary header, admin excluded, correct hour split', lines[0] === 'id,name,status,sector,in_school_hrs,out_of_school_hrs,total_hrs,level' && !r.text.includes('Ann') && lines.includes('4,Mia,active,Events,5,2,7,L1'), lines);
  t('export: names are quoted and cannot run as spreadsheet formulas', lines.some(l => l.startsWith('8,"\'=SUM(A1),""Meg""",')));
  t('export: filters, unknown values ignored, download header', (await call('GET', '/api/export', { user: pres, query: { sector: 'Creative' } })).text.split('\n').length === 2 && (await call('GET', '/api/export', { user: pres, query: { sector: 'Nope', status: 'x' } })).text.split('\n').length === lines.length && /attachment; filename="interact-hours-/.test((await call('GET', '/api/export', { user: pres, query: { download: '1' } })).hdr['Content-Disposition']));
  r = await call('GET', '/api/stats/', { user: mia });
  t('stats: total counts approved overtime, ignores pending overtime and removed hours', r.code === 200 && r.json.totalHours === 9 && r.json.pendingApprovals === 2, r.json);

  console.log(`\napi: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
