// End-to-end: the real page script + the real routes + an in-memory database. Run: node tests/e2e.js
const { loadApp, openAs } = require('./harness');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300))); };
const U = (id, role, sector = null, name) => ({ id, name, email: name.toLowerCase().replace(/\W/g, '') + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0, created_at: '2026-01-0' + id + 'T00:00:00Z' });
const T = { users: [U(1, 'admin', null, 'Ann Admin'), U(2, 'pres', null, 'Pat President'), U(3, 'lead', 'Events', 'Lee Lead'), U(4, 'member', 'Events', 'Mia Member'),
  U(5, 'member', 'Creative', 'Max Member'), U(6, 'volunteer', null, 'Vic Volunteer'), U(7, 'lead', 'Finance', 'Fay Finance')], events: [], signups: [], hour_logs: [], log_cheers: [], log_comments: [] };
const { call } = loadApp(T), app = { call };
const row = id => T.users.find(u => u.id === id);
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const MOCK = /Nomin B\.|Temuulen|Munkh-Orgil|Saruul|Anujin|Bat-Erdene|sample data|Prototype|Reset sample|Tarot reading/i;
const noMock = (b, where) => ok(`no sample/mock text on screen (${where})`, !MOCK.test(b.html()), b.text().match(MOCK));

(async () => {
  /* ================= 1. empty club: every screen shows an honest empty state ================= */
  const mia = await openAs(app, T, row(4)), vic = await openAs(app, T, row(6)), pat = await openAs(app, T, row(2)), lee = await openAs(app, T, row(3));
  ok('page boots for a member and loads from the API', mia.X.DATA.ready && mia.state.calls.slice(0, 2).join() === 'GET /api/auth/me,GET /api/bootstrap', mia.state.calls);
  ok('header says "Live data"', /Live data/.test(mia.text()));
  ok('members list comes from the database, nobody is invented', mia.X.M.length === 7 && mia.X.M.map(m => m.name).includes('Mia Member'));
  ok('my impact: zero hours and an empty log list', /0\.0 of 30 h goal/.test(mia.text()) && /No logs yet/.test(mia.text()));
  await mia.go('member', 'events'); ok('events: empty state', /No events yet\. Your Sector Leads will post events here\./.test(mia.text()));
  await mia.go('member', 'feed');   ok('club feed: "No posts yet"', /No posts yet/.test(mia.text()));
  await mia.go('member', 'cert');   ok('certificate loads real (zero) hours', /Mia Member/.test(mia.text()) && /0\.0 verified hours/.test(mia.text()), mia.text().slice(-300));
  ok('certificate signer is the real co-president, not a placeholder', /Pat President/.test(mia.text()) && !MOCK.test(mia.html()));
  noMock(mia, 'member');
  ok('volunteer: events empty state + promotion button', /No events yet/.test(vic.text()) && (await vic.go('vol', 'status'), /Request promotion to Active/.test(vic.text())));
  await pat.go('pres', 'center');
  const tiles = [...pat.app().matchAll(/<div class="card tile"><b>([^<]*)<\/b><span>([^<]*)<\/span>/g)].map(m => [m[2], m[1]]);
  ok('command center: real numbers (7 accounts, 1 volunteer), zero for everything with no activity, never the old mock figures', JSON.stringify(tiles) === JSON.stringify([['Total club hours','0'],['Active members','7'],['On the keeplist','1'],['Pending approvals','0'],['Flagged entries','0'],['Events active','0']]) && !/1,240/.test(pat.text()), tiles);
  ok('command center: member count comes from the database', (await call('GET', '/api/stats/', { user: row(2) })).json.activeMembers === 7);
  await pat.go('pres', 'over');
  ok('overrides: empty states for all three lists', /No override requests/.test(pat.text()) && /No flagged entries/.test(pat.text()) && /Nothing pending/.test(pat.text()));
  await pat.go('pres', 'roster'); ok('roster: real members only', /Mia Member/.test(pat.text()) && /Vic Volunteer/.test(pat.text()) && !MOCK.test(pat.html()));
  await pat.go('pres', 'export');
  ok('export: report loaded from the API, one row per real member (admin excluded)', pat.X.EXPORT.text.split('\n').length === 1 + 6 && /6 rows/.test(pat.text()) && !/Ann Admin/.test(pat.text()), pat.X.EXPORT.text);
  await lee.go('lead', 'review'); ok('lead review: empty state', /No pending hours for the Events sector/.test(lee.text()));
  await lee.go('lead', 'qr');     ok('lead code screen: empty state', /No events in this sector use a live check-in code yet/.test(lee.text()));
  await lee.go('lead', 'events'); ok('lead events: empty state', /No Events events yet/.test(lee.text()));
  noMock(pat, 'president'); noMock(lee, 'lead'); noMock(vic, 'volunteer');

  /* ================= 2. a lead publishes an event ================= */
  const f = { 'nf-t': 'Library Drive', 'nf-h': 2, 'nf-c': 5, 'nf-v': 1, 'nf-n': 1, 'nf-l': 'City Library', 'nf-d': 'Nov 14', 'nf-y': 'in', 'nf-b': '', 'nf-z': '' };
  for (const [k, v] of Object.entries(f)) lee.setVal(k, v);
  await lee.act('newev');
  ok('GPS event without a venue location is refused client-side, nothing created', /Use my current location/.test(lee.toast()) && T.events.length === 0, lee.toast());
  await lee.act('nfloc');
  ok('"Use my current location" captures the venue position', lee.X.S.nfPos && lee.X.S.nfPos.lat === 47.9184);
  await lee.act('newev');
  const ev = T.events[0];
  ok('event is published to the database with the lead\'s sector, verification and venue', T.events.length === 1 && ev.sector === 'Events' && ev.created_by === 3 && ev.lat === 47.9184 && ev.verification === '["gps","qr","selfie"]' && ev.is_active === 1, ev);
  ok('the new event appears on the lead\'s list straight away', /Library Drive/.test(lee.text()) && /Active now/.test(lee.text()));
  await lee.act('evactive', { id: '1' }); ok('toggle inactive', T.events[0].is_active === 0 && /Mark active/.test(lee.text()));
  await lee.act('evactive', { id: '1' }); ok('toggle active again', T.events[0].is_active === 1);

  /* ================= 3. a member signs up and checks in (GPS + live code + photo) ================= */
  const mia2 = await openAs(app, T, row(4));
  await mia2.go('member', 'events');
  ok('member sees the real event with a Sign up button', /Library Drive/.test(mia2.text()) && /Sign up/.test(mia2.text()));
  await mia2.act('signup', { id: '1' });
  ok('sign-up saved; card now offers Check in', T.signups.length === 1 && T.signups[0].user_id === 4 && /Check in/.test(mia2.text()) && /1 of 5 members/.test(mia2.text()), mia2.text().slice(0, 400));
  await mia2.act('ci', { id: '1' });
  ok('check-in wizard opens on the GPS step, Continue locked', /Confirm your location/.test(mia2.modal()) && !mia2.X.ciValid());
  mia2.state.pos = { latitude: 47.95, longitude: 106.9177, accuracy: 10 }; await mia2.act('locate');
  ok('3.6 km away: refused and shows the distance', !mia2.X.ciValid() && /too far/.test(mia2.el('#dmsg').innerHTML) && mia2.X.CI.dist > 3000, [mia2.X.CI.dist, mia2.el('#dmsg').innerHTML]);
  mia2.state.pos = { latitude: 47.9184, longitude: 106.9177, accuracy: 10 }; await mia2.act('locate');
  ok('at the venue: inside the fence', mia2.X.ciValid() && /Inside the fence/.test(mia2.el('#dmsg').innerHTML), mia2.el('#dmsg').innerHTML);
  await mia2.act('cinext');
  ok('next step asks for the live code', /Enter the live code/.test(mia2.modal()) && !mia2.X.ciValid());
  await lee.go('lead', 'qr'); await lee.X.qrFetch(); await lee.settle();
  const code = lee.X.S.qrCode;
  ok('lead screen shows a server-made 6-digit code with a countdown', /^\d{6}$/.test(code) && lee.el('#qrCode').textContent === code && lee.X.S.qrExp > Date.now() && lee.X.S.qrExp <= Date.now() + 30500, code);
  mia2.X.IN_.code(code === '000000' ? '111111' : '000000'); await mia2.settle();
  ok('wrong code: rejected by the server', mia2.X.CI.qrState === 'bad' && !mia2.X.ciValid());
  mia2.X.IN_.code(code); await mia2.settle();
  ok('right code: accepted by the server', mia2.X.CI.qrState === 'ok' && mia2.X.ciValid());
  await mia2.act('cinext');
  ok('next step asks for a live photo', /Take a live photo/.test(mia2.modal()) && /Open camera/.test(mia2.modal()));
  await mia2.act('startcam'); ok('no camera available: clear message, no way to upload a file instead', /cannot open the camera/.test(mia2.modal()) && !/type="file"/.test(mia2.modal()));
  mia2.X.CI.photo = PHOTO; await mia2.act('cinext');
  ok('review step shows the pre-set hours (not typed by the member)', /Review and submit/.test(mia2.modal()) && /2\.0 h/.test(mia2.modal()) && /Submit for approval/.test(mia2.modal()));
  await mia2.act('cisub');
  const log = T.hour_logs[0];
  ok('submission stored: pending, 2 h from the event, owner, GPS and photo recorded', T.hour_logs.length === 1 && log.status === 'pending' && log.hours === 2 && log.user_id === 4 && log.gps_lat === 47.9184 && log.photo_data === PHOTO, log && { ...log, photo_data: '…' });
  ok('wizard closed; my impact shows the pending hours', mia2.modal() === '' && (await mia2.go('member', 'home'), /2\.0 h awaiting approval/.test(mia2.text())), mia2.text().slice(0, 300));
  await mia2.go('member', 'events'); ok('event card now says "All logged"', /All logged/.test(mia2.text()));

  /* ================= 4. the lead reviews it ================= */
  await lee.act('retry'); await lee.go('lead', 'review');
  ok('lead sees Mia\'s submission with her photo (served by the API)', /Mia Member/.test(lee.text()) && lee.html().includes('src="/api/hours/1/photo"') && /Approve all \(1\)/.test(lee.text()));
  ok('photo route: owner and lead can open it, other members cannot see a pending one', (await call('GET', '/api/hours/1/photo', { user: row(4) })).code === 200 && (await call('GET', '/api/hours/1/photo', { user: row(3) })).code === 200 && (await call('GET', '/api/hours/1/photo', { user: row(5) })).code === 403 && (await call('GET', '/api/hours/1/photo', { user: row(6) })).code === 403);
  await mia2.act('apprall', { id: '1' }); ok('a member cannot approve hours (server says no, toast shows why)', T.hour_logs[0].status === 'pending' && /own sector/.test(mia2.toast()), mia2.toast());
  await lee.act('appr', { id: '1' });
  ok('lead approves: saved with reviewer and time, queue is empty again', T.hour_logs[0].status === 'approved' && T.hour_logs[0].reviewed_by === 3 && !!T.hour_logs[0].reviewed_at && /No pending hours/.test(lee.text()));

  /* ================= 5. club feed: cheer, comment, flag, overrides ================= */
  const max = await openAs(app, T, row(5)); await max.go('member', 'feed');
  ok('feed shows the approved post to other members, photo included', /Mia Member/.test(max.text()) && /Library Drive/.test(max.text()) && max.html().includes('/api/hours/1/photo') && /Cheer · 0/.test(max.text()));
  await max.act('cheer', { id: '1' }); ok('cheer saved', T.log_cheers.length === 1 && /Cheered · 1/.test(max.text()));
  max.setVal('cm-1', 'Great work!'); await max.act('comment', { id: '1' });
  ok('comment saved and shown with the author\'s name', T.log_comments.length === 1 && /Max Member/.test(max.text()) && /Great work!/.test(max.text()));
  await mia2.act('retry'); await mia2.go('member', 'home');
  ok('owner now has 2.0 verified hours', /2\.0 of 30 h goal/.test(mia2.text()));
  await max.act('flag', { id: '1' });
  ok('flagging hides the post from the feed (no names recorded)', T.hour_logs[0].flagged === 1 && !/Great work!/.test(max.text()) && /No posts yet/.test(max.text()) && !('flagged_by' in T.hour_logs[0]));
  await pat.act('retry'); await pat.go('pres', 'over');
  ok('co-president sees the flagged entry in Overrides', /Flagged entries/.test(pat.text()) && /Mia Member/.test(pat.text()) && !/No flagged entries/.test(pat.text()));
  await pat.act('fkeep', { id: '1' }); ok('dismiss flag: post returns to the feed', T.hour_logs[0].flagged === 0 && /No flagged entries/.test(pat.text()));
  await max.act('retry'); await max.go('member', 'feed'); ok('...and the feed shows it again', /Great work!/.test(max.text()));
  await max.act('flag', { id: '1' }); await pat.act('retry'); await pat.go('pres', 'over'); await pat.act('fdel', { id: '1' });
  ok('remove hours: log rejected, flag cleared, Mia\'s total back to 0', T.hour_logs[0].status === 'rejected' && T.hour_logs[0].flagged === 0 && (await mia2.act('retry'), await mia2.go('member', 'home'), /0\.0 of 30 h goal/.test(mia2.text())));
  await mia2.go('member', 'events'); ok('a rejected day can be checked in again', /Check in/.test(mia2.text()) && !/All logged/.test(mia2.text()));

  /* ================= 6. second event with an extended-shift request ================= */
  for (const [k, v] of Object.entries({ 'nf-t': 'Setup Crew', 'nf-l': 'Main hall', 'nf-d': 'Nov 20', 'nf-h': 2, 'nf-c': 5, 'nf-v': 0, 'nf-n': 1, 'nf-y': 'in', 'nf-b': '', 'nf-z': '' })) lee.setVal(k, v);
  lee.setChecked('nf-g', false); lee.setChecked('nf-q', false); lee.setChecked('nf-u', true);
  await lee.go('lead', 'events'); lee.setVal('nf-t', 'Setup Crew'); lee.setChecked('nf-g', false); lee.setChecked('nf-q', false); lee.setChecked('nf-u', true); await lee.act('newev');
  ok('photo-only setup event created', T.events.length === 2 && T.events[1].verification === '["selfie"]' && T.events[1].is_setup === 1 && T.events[1].lat === null, T.events[1]);
  await mia2.act('retry'); await mia2.act('signup', { id: '2' }); await mia2.act('ci', { id: '2' });
  ok('only the required steps appear (photo, then review)', /Take a live photo/.test(mia2.modal()) && !/live code|location/i.test(mia2.modal()));
  mia2.X.CI.photo = PHOTO; await mia2.act('cinext');
  mia2.X.CH.ot('', { checked: true }); mia2.X.IN_.reason('stayed late');
  ok('extended shift needs a real explanation', !mia2.X.ciValid());
  mia2.X.IN_.reason('Stayed two extra hours to take down the stage'); mia2.X.CH.oth('2');
  ok('...then submission is allowed', mia2.X.ciValid()); await mia2.act('cisub');
  const l2 = T.hour_logs.find(l => l.event_id === 2);
  ok('overtime request stored as pending', l2 && l2.overtime_hours === 2 && l2.overtime_status === 'pending' && l2.status === 'pending', l2 && { ...l2, photo_data: '…' });
  await pat.act('retry'); await pat.go('pres', 'over');
  ok('co-president sees the extended-shift request with the reason', /Extended shift requests/.test(pat.text()) && /\+2\.0 h/.test(pat.text()) && /take down the stage/.test(pat.text()));
  await lee.act('retry'); await lee.act('otok', { id: String(l2.id) }); ok('a Sector Lead cannot decide overtime', l2.overtime_status === 'pending' && /access/.test(lee.toast()), lee.toast());
  await lee.go('lead', 'review'); await lee.act('appr', { id: String(l2.id) });
  await pat.act('retry'); await pat.go('pres', 'over'); await pat.act('otok', { id: String(l2.id) });
  ok('approved overtime is saved', l2.overtime_status === 'approved' && /No override requests/.test(pat.text()));
  await mia2.act('retry'); await mia2.go('member', 'home');
  ok('my impact: 2 h + 2 h approved overtime = 4.0, badge progress counts the setup event', /4\.0 of 30 h goal/.test(mia2.text()) && /Operations Master[^·]*·\s*1\.0\/3/.test(mia2.text()), mia2.text().match(/Operations Master[^·]*·[^B]*/));

  /* ================= 7. volunteer slot, promotion request, promotion ================= */
  const vic2 = await openAs(app, T, row(6)); await vic2.go('vol', 'events');
  ok('volunteer sees the real events with open slots', /Library Drive/.test(vic2.text()) && /Take a volunteer slot/.test(vic2.text()));
  await vic2.act('signup', { id: '1' }); ok('volunteers cannot sign up as members', /volunteer slot instead/.test(vic2.toast()), vic2.toast());
  await vic2.act('vsign', { id: '1' }); ok('volunteer slot booked', /Standby slot booked/.test(vic2.text()) && T.signups.some(s => s.user_id === 6 && s.is_volunteer === 1));
  await vic2.go('vol', 'status'); await vic2.act('promo'); ok('promotion requested', row(6).promotion_requested === 1 && /Promotion requested/.test(vic2.text()), vic2.text().slice(-250));
  await pat.act('retry'); await pat.go('pres', 'roster'); ok('co-president sees the request on the roster', /Promotion requests/.test(pat.text()) && /Vic Volunteer/.test(pat.text()));
  await pat.act('promote', { id: '6' });
  ok('promoted: now a member, request cleared, standby slot released', row(6).role === 'member' && row(6).promotion_requested === 0 && !T.signups.some(s => s.user_id === 6) && !/Promotion requests/.test(pat.text()));
  const vic3 = await openAs(app, T, row(6)); ok('after promotion the same person gets the member screens', vic3.X.S.role === 'member' && /Welcome back/.test(vic3.text()));

  /* ================= 8. export and certificates, straight from the database ================= */
  await pat.act('retry'); await pat.go('pres', 'export');
  const csv = pat.X.EXPORT.text.split('\n');
  ok('export: Mia\'s verified hours (4 h, all in-school) are in the report', csv.includes('4,Mia Member,active,Events,4,0,4,L1'), csv);
  ok('export: only Mia has hours; removed and unapproved hours count for nobody', csv.slice(1).filter(l => !l.startsWith('4,')).every(l => /,0,0,0,L1$/.test(l)), csv);
  pat.X.CH.exs('Creative'); await pat.settle();
  ok('export: sector filter refetches from the API', pat.X.EXPORT.text.split('\n').length === 2 && /Max Member/.test(pat.text()) && pat.state.calls.filter(c => c === 'GET /api/export').length >= 2);
  pat.X.CH.exs('Finance'); pat.X.CH.exst('keep'); await pat.settle(); ok('export: no match shows an empty state', /No members match these filters/.test(pat.text()));
  pat.X.CH.exs('all'); pat.X.CH.exst('all'); await pat.settle(); await pat.act('dlcsv');
  ok('download goes through the server (attachment)', /^\/api\/export\?sector=all&status=all&download=1$/.test(pat.state.href), pat.state.href);
  await pat.act('copycsv'); ok('copy puts the real CSV on the clipboard', pat.state.copied && pat.state.copied.startsWith('id,name,status'));
  pat.X.S.certM = '4'; await pat.go('pres', 'certs');
  ok('certificate for a chosen member: real hours, real projects, real signer', /Mia Member/.test(pat.text()) && /4\.0 verified hours/.test(pat.text()) && /Setup Crew/.test(pat.text()) && /Pat President/.test(pat.text()), pat.text().slice(-400));
  await mia2.go('member', 'cert'); await mia2.act('copycert', { m: '4' }); await mia2.act('printcert');
  ok('member can copy and print their own certificate', /4\.0 verified hours/.test(mia2.state.copied) && mia2.state.printed);
  ok('a member cannot open someone else\'s certificate', (await call('GET', '/api/certificate/5', { user: row(4) })).code === 403);

  /* ================= 9. permissions surface as clear messages ================= */
  const fay = await openAs(app, T, row(7));
  await fay.act('evactive', { id: '1' }); ok('lead of another sector cannot change the event', /own sector/.test(fay.toast()) && T.events[0].is_active === 1, fay.toast());
  await lee.act('retry'); await lee.act('evdelete', { id: '1' });
  ok('an event with logged hours cannot be deleted', T.events.some(e => e.id === 1) && /logged hours/.test(lee.toast()), lee.toast());
  await max.act('retry'); await max.act('signup', { id: '1' });
  const maxRows = () => T.signups.filter(s => s.user_id === 5 && s.event_id === 1).length;
  ok('another member can sign up', maxRows() === 1);
  await max.act('signup', { id: '1' });
  ok('signing up twice is refused with a clear message and no duplicate', maxRows() === 1 && /already signed up/.test(max.toast()), max.toast());
  for (const u of [8, 9, 10, 11]) T.users.push(U(u, 'member', 'Events', 'Filler ' + u));
  for (const u of [8, 9, 10]) await call('POST', '/api/events/1/signup', { user: row(u) });
  const late = await openAs(app, T, row(11)); await late.act('signup', { id: '1' });
  ok('a full event refuses the next member (capacity 5)', /full/i.test(late.toast()) && T.signups.filter(s => s.event_id === 1 && !s.is_volunteer).length === 5, late.toast());

  /* ================= 10. live code rotates ================= */
  await lee.go('lead', 'qr'); await lee.X.qrFetch(); await lee.settle(); const n1 = lee.state.calls.filter(c => /\/qr$/.test(c)).length;
  lee.X.S.qrExp = Date.now() - 1; lee.tick(); await lee.settle();
  ok('when the countdown ends the page fetches the next code from the server', lee.state.calls.filter(c => /\/qr$/.test(c)).length === n1 + 1);

  /* ================= 11. failures are visible, never silent ================= */
  const mia3 = await openAs(app, T, row(4)); mia3.state.user = null; await mia3.act('signup', { id: '2' });
  ok('expired session sends you back to log in with a message', /Your session expired/.test(mia3.text()) && /Log in/.test(mia3.text()), mia3.text().slice(0, 200));
  T.__down = true; const mia4 = await openAs(app, T, row(4));
  ok('database down: clear error and a retry button instead of fake data', !mia4.X.DATA.ready && /database is down/.test(mia4.text()) && /Try again/.test(mia4.text()), mia4.text());
  T.__down = false; await mia4.act('retry'); ok('...and Try again recovers', mia4.X.DATA.ready && /Welcome back/.test(mia4.text()));

  /* ================= 12. privacy ================= */
  ok('a member\'s screens never contain other people\'s emails or password hashes', !/@x\.com|password/i.test(mia2.html() + max.html() + vic3.html()));
  await vic3.go('member', 'home'); noMock(mia2, 'member after activity'); noMock(pat, 'president after activity');

  /* ================= 13. create-account form: confirm password ================= */
  const MISMATCH = "Passwords don't match. Please enter the same password twice.";
  const guest = await openAs(app, T, null);
  ok('logged-out visitors get the login form, which has no confirm field', /Log in to continue/.test(guest.text()) && guest.fieldNames().join() === 'email,password', guest.fieldNames());
  await guest.act('authswitch', { m: 'register' });
  ok('create-account form: name, email, password, then confirm password', guest.fieldNames().join() === 'name,email,password,confirm' && /Confirm password/.test(guest.text()), guest.fieldNames());
  for (const [k, v] of Object.entries({ name: 'Nara Newcomer', email: 'nara@x.com', password: 'Sunrise-2026', confirm: 'Sunrise-2027' })) guest.setField(k, v);
  const usersBefore = T.users.length; let r1 = await guest.submit();
  ok('different passwords: the exact message is shown', guest.el('#authErr').textContent === MISMATCH, guest.el('#authErr').textContent);
  ok('...nothing is sent to the server and no account is created', guest.state.authCalls.length === 0 && T.users.length === usersBefore);
  ok('...the form stays put, the button stays usable and focus goes to the confirm box', r1.btn.disabled === false && r1.prevented && guest.state.focused === 'confirm' && guest.fieldNames().length === 4);
  guest.setField('confirm', ''); await guest.submit();
  ok('an empty confirm box counts as a mismatch', guest.el('#authErr').textContent === MISMATCH && guest.state.authCalls.length === 0);
  guest.setField('confirm', 'Sunrise-2026'); await guest.submit();
  ok('matching passwords: the account is created (as a volunteer) and the app opens', T.users.length === usersBefore + 1 && T.users.at(-1).email === 'nara@x.com' && T.users.at(-1).role === 'volunteer' && guest.X.S.role === 'vol' && /Live data/.test(guest.text()), guest.text().slice(0, 200));
  ok('the confirm value is never sent to the server', guest.state.authCalls.length === 1 && JSON.stringify(Object.keys(guest.state.authCalls[0].body)) === JSON.stringify(['name', 'email', 'password']), guest.state.authCalls);
  const guest2 = await openAs(app, T, null);
  guest2.setField('email', 'nara@x.com'); guest2.setField('password', 'Sunrise-2026'); await guest2.submit();
  ok('login still works with just email and password', guest2.state.authCalls.length === 1 && guest2.state.authCalls[0].path === '/api/auth/login' && !('confirm' in guest2.state.authCalls[0].body) && guest2.X.DATA.ready);

  console.log(`\nend-to-end: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
