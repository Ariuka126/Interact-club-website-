// Presidential specification, part 2: roles, proposals, checklists, feedback, vault, overtime + override, caps, and the permission matrix.
// Run: node tests/spec2.js
const { loadApp } = require('./harness');
process.env.SESSION_SECRET = 'test-secret';
const KEY = 'z'.repeat(40) + '-test-feedback-key';
process.env.FEEDBACK_KEY = KEY;
let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : JSON.stringify(d).slice(0, 320))); };

const U = (id, role, sector = null, name = role + id) => ({ id, name, email: name.replace(/\W/g, '').toLowerCase() + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0,
  demoted_at: null, demotion_reason: null, attendance_reset_at: null, created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z` });
const admin = U(1, 'admin', null, 'Ann'), pres = U(2, 'pres', null, 'Pat'), pres2 = U(10, 'pres', null, 'Pia'),
  eHead = U(3, 'lead', 'Events', 'Eli'), fHead = U(7, 'lead', 'Finance', 'Fay'), cHead = U(11, 'lead', 'Community', 'Cam'), rHead = U(12, 'lead', 'Creative', 'Rae'),
  mia = U(4, 'member', 'Events', 'Mia'), max = U(5, 'member', 'Events', 'Max'), nia = U(13, 'member', null, 'Nia'), zed = U(14, 'member', 'Creative', 'Zed'), vic = U(6, 'volunteer', null, 'Vic');
const ALL = [admin, pres, pres2, eHead, fHead, cHead, rHead, mia, max, nia, zed, vic];
const ev = o => ({ id: 1, title: 'Fair', sector: 'Events', hours: 2, capacity: 9, volunteer_slots: 1, location: 'Hall', date_label: 'Oct 31', type: 'in', verification: '["qr","selfie"]', shifts: null, points: null, days: null, waiver_required: 0, is_setup: 0, is_active: 1, lat: null, lng: null, created_by: 1, created_at: '2026-01-01T00:00:00Z', ...o });
const world = (extra = {}) => { const a = loadApp({ users: ALL.map(u => ({ ...u })), events: [ev()], signups: [], hour_logs: [], ...extra }); a.row = id => a.T.users.find(u => u.id === id);
  a.as = id => { const r = a.row(id); return { id: r.id, name: r.name, email: r.email, role: r.role, sector: r.sector }; };
  a.api = (who, method, path, body, query) => a.call(method, '/api' + path, { user: who == null ? null : a.as(who), body, query }); return a; };
const ok = r => r.code >= 200 && r.code < 300;

(async () => {
  /* ===================== SECTOR ROLES ===================== */
  let w = world(), { T } = w, api = w.api, r;
  t('sector roles: volunteers cannot browse them', (await api(6, 'GET', '/sector-roles')).code === 403 && (await api(null, 'GET', '/sector-roles')).code === 401);
  t('sector roles: members, volunteers and admin accounts cannot post', (await api(4, 'POST', '/sector-roles', { title: 'Camera crew', capacity: 2 })).code === 403 && (await api(6, 'POST', '/sector-roles', { title: 'Camera crew', capacity: 2 })).code === 403 && (await api(1, 'POST', '/sector-roles', { title: 'Camera crew', capacity: 2, sector: 'Events' })).code === 403);
  r = await api(3, 'POST', '/sector-roles', { title: 'Stage crew', description: 'Set up the hall', capacity: 2, sector: 'Finance' });
  t('sector roles: a head posts for their own sector only (the sector in the request is ignored)', r.code === 201 && r.json.role.sector === 'Events');
  t('sector roles: a president must name the sector', (await api(2, 'POST', '/sector-roles', { title: 'Treasurer aide', capacity: 1 })).code === 400 && (await api(2, 'POST', '/sector-roles', { title: 'Treasurer aide', capacity: 1, sector: 'Finance' })).code === 201);
  for (const [n, p] of [['short title', { title: 'x' }], ['0 places', { capacity: 0 }], ['51 places', { capacity: 51 }], ['long description', { description: 'x'.repeat(501) }]]) t(`sector roles: rejects ${n}`, (await api(3, 'POST', '/sector-roles', { title: 'Valid title', capacity: 2, ...p })).code === 400);
  const stage = r.json.role.id;
  r = await api(4, 'GET', '/sector-roles');
  t('sector roles: a member sees openings with places left, never the applicants', r.code === 200 && r.json.roles.length === 2 && r.json.roles.every(x => x.applications === undefined && x.canManage === false) && r.json.roles.find(x => x.id === stage).filled === 0);
  t('sector roles: only members apply (heads, presidents, volunteers refused)', (await api(3, 'POST', `/sector-roles/${stage}/apply`, {})).code === 403 && (await api(2, 'POST', `/sector-roles/${stage}/apply`, {})).code === 403 && (await api(6, 'POST', `/sector-roles/${stage}/apply`, {})).code === 403);
  t('sector roles: apply; twice is refused', (await api(4, 'POST', `/sector-roles/${stage}/apply`, { note: 'I run lights at school plays' })).code === 201 && (await api(4, 'POST', `/sector-roles/${stage}/apply`, {})).code === 409);
  r = await api(4, 'GET', '/sector-roles'); t('sector roles: the applicant sees their own status', r.json.roles.find(x => x.id === stage).my.status === 'pending');
  r = await api(3, 'GET', '/sector-roles'); const appId = r.json.roles.find(x => x.id === stage).applications[0].id;
  t('sector roles: the head sees who applied, with their note', r.json.roles.find(x => x.id === stage).applications[0].name === 'Mia' && r.json.roles.find(x => x.id === stage).applications[0].note === 'I run lights at school plays');
  t('sector roles: another sector\'s head sees no applicants for it', (await api(7, 'GET', '/sector-roles')).json.roles.find(x => x.id === stage).applications === undefined);
  t('sector roles: deciding needs the sector head or a president', (await api(4, 'POST', `/applications/${appId}/decision`, { decision: 'accepted' })).code === 403 && (await api(7, 'POST', `/applications/${appId}/decision`, { decision: 'accepted' })).code === 403 && (await api(3, 'POST', `/applications/${appId}/decision`, { decision: 'maybe' })).code === 400);
  r = await api(3, 'POST', `/applications/${appId}/decision`, { decision: 'accepted' });
  t('sector roles: the head accepts; the place count goes up', r.code === 200 && (await api(4, 'GET', '/sector-roles')).json.roles.find(x => x.id === stage).filled === 1 && T.audit_logs.at(-1).action === 'application.accept');
  t('sector roles: deciding twice -> 409', (await api(3, 'POST', `/applications/${appId}/decision`, { decision: 'rejected' })).code === 409);
  // capacity
  const one = (await api(3, 'POST', '/sector-roles', { title: 'Photographer', capacity: 1 })).json.role.id;
  await api(4, 'POST', `/sector-roles/${one}/apply`, {}); await api(5, 'POST', `/sector-roles/${one}/apply`, {});
  const apps = (await api(3, 'GET', '/sector-roles')).json.roles.find(x => x.id === one).applications;
  t('capacity: the first accept fills the only place', (await api(3, 'POST', `/applications/${apps[0].id}/decision`, { decision: 'accepted' })).code === 200);
  r = await api(3, 'POST', `/applications/${apps[1].id}/decision`, { decision: 'accepted' });
  t('capacity: accepting beyond it is refused', r.code === 409 && /full/.test(r.json.error));
  r = await api(4, 'GET', '/sector-roles'); const full = r.json.roles.find(x => x.id === one);
  t('capacity: a full role is flagged full, so the screen can grey it out', full.full === true && full.filled === 1 && full.capacity === 1);
  const joiner = U(15, 'member', 'Events', 'Joe'); T.users.push({ ...joiner }); r = await api(15, 'POST', `/sector-roles/${one}/apply`, {});
  t('capacity: a new applicant is told it is full', r.code === 409 && /full/.test(r.json.error), r.json);
  t('capacity: reject works and the member can still apply elsewhere', (await api(3, 'POST', `/applications/${apps[1].id}/decision`, { decision: 'rejected' })).code === 200 && (await api(5, 'POST', `/sector-roles/${one}/apply`, {})).code === 409);
  // closing, withdrawing
  t('closing: the head closes a role; members stop seeing it and cannot apply', (await api(7, 'POST', `/sector-roles/${stage}/state`, { open: false })).code === 403 && (await api(3, 'POST', `/sector-roles/${stage}/state`, { open: false })).code === 200
    && (await api(14, 'GET', '/sector-roles')).json.roles.every(x => x.id !== stage) && (await api(14, 'POST', `/sector-roles/${stage}/apply`, {})).code === 409);
  t('withdraw: a member withdraws, then can apply again', (await api(4, 'POST', `/sector-roles/${stage}/withdraw`, {})).code === 200 && (await api(4, 'POST', `/sector-roles/${stage}/withdraw`, {})).code === 409);
  await api(3, 'POST', `/sector-roles/${stage}/state`, { open: true }); r = await api(4, 'POST', `/sector-roles/${stage}/apply`, {});
  t('withdraw: re-applying after a withdrawal works', r.code === 201);
  // cross-sector
  const crossRole = (await api(3, 'POST', '/sector-roles', { title: 'Guest host', capacity: 3 })).json.role.id;
  await api(14, 'POST', `/sector-roles/${crossRole}/apply`, {}); await api(13, 'POST', `/sector-roles/${crossRole}/apply`, {});
  const ca = (await api(3, 'GET', '/sector-roles')).json.roles.find(x => x.id === crossRole).applications;
  r = await api(3, 'POST', `/applications/${ca.find(a => a.name === 'Zed').id}/decision`, { decision: 'accepted' });
  t('cross-sector: a head cannot recruit a member of another sector', r.code === 409 && /Only a President can recruit across sectors/.test(r.json.error) && w.row(14).sector === 'Creative', r.json);
  r = await api(2, 'POST', `/applications/${ca.find(a => a.name === 'Zed').id}/decision`, { decision: 'accepted' });
  t('cross-sector: a President can, and the member moves sector (audited)', r.code === 200 && r.json.joinedSector && w.row(14).sector === 'Events' && T.audit_logs.at(-1).details.from === 'Creative');
  r = await api(3, 'POST', `/applications/${ca.find(a => a.name === 'Nia').id}/decision`, { decision: 'accepted' });
  t('joining: a member with no sector joins the sector of the role they are accepted for', r.code === 200 && w.row(13).sector === 'Events');
  t('assign sector: only a President', (await api(3, 'POST', '/members/4/assign-sector', { sector: 'Finance' })).code === 403 && (await api(1, 'POST', '/members/4/assign-sector', { sector: 'Finance' })).code === 403 && (await api(4, 'POST', '/members/4/assign-sector', { sector: 'Finance' })).code === 403);
  t('assign sector: needs an active member and a real sector', (await api(2, 'POST', '/members/6/assign-sector', { sector: 'Finance' })).code === 409 && (await api(2, 'POST', '/members/4/assign-sector', { sector: 'Moon' })).code === 400 && (await api(2, 'POST', '/members/999/assign-sector', { sector: 'Finance' })).code === 404);
  r = await api(2, 'POST', '/members/4/assign-sector', { sector: 'Finance' });
  t('assign sector: a President moves anyone anywhere, audited with from and to', r.code === 200 && w.row(4).sector === 'Finance' && T.audit_logs.at(-1).action === 'member.assign_sector' && T.audit_logs.at(-1).details.to === 'Finance' && T.audit_logs.at(-1).details.from === 'Events');
  // a demoted applicant
  const dm = U(16, 'member', 'Events', 'Dee'); T.users.push({ ...dm }); await api(16, 'POST', `/sector-roles/${crossRole}/apply`, {}); w.row(16).role = 'volunteer';
  const da = (await api(3, 'GET', '/sector-roles')).json.roles.find(x => x.id === crossRole).applications.find(a => a.name === 'Dee');
  t('sector roles: someone demoted in the meantime cannot be accepted', (await api(3, 'POST', `/applications/${da.id}/decision`, { decision: 'accepted' })).code === 409);

  /* ===================== PROPOSALS ===================== */
  w = world(); ({ T } = w); api = w.api;
  const prop = { title: 'Beach cleanup', description: 'Collect litter along the river and weigh it.', category: 'service', sector: 'Community', type: 'out', dateLabel: 'Nov 20', location: 'River park', hours: 3, capacity: 20 };
  t('proposals: volunteers, presidents and admin accounts cannot pitch (presidents publish directly)', (await api(6, 'POST', '/proposals', prop)).code === 403 && (await api(2, 'POST', '/proposals', prop)).code === 403 && (await api(1, 'POST', '/proposals', prop)).code === 403 && (await api(null, 'POST', '/proposals', prop)).code === 401);
  for (const [n, p] of [['short title', { title: 'x' }], ['short description', { description: 'too short' }], ['bad category', { category: 'party' }], ['bad sector', { sector: 'Moon' }], ['bad type', { type: 'x' }], ['no date', { dateLabel: '' }], ['no place', { location: '' }], ['0.1 hours', { hours: 0.1 }], ['0 capacity', { capacity: 0 }]])
    t(`proposals: rejects ${n}`, (await api(4, 'POST', '/proposals', { ...prop, ...p })).code === 400);
  r = await api(4, 'POST', '/proposals', prop);
  t('proposals: a member pitches one; it starts pending', r.code === 201 && r.json.proposal.status === 'pending' && r.json.proposal.proposer_id === 4);
  const pid = r.json.proposal.id;
  t('proposals: a Sector Head may pitch too', (await api(3, 'POST', '/proposals', { ...prop, title: 'Bake sale', category: 'fundraising', sector: 'Finance' })).code === 201);
  for (let i = 0; i < 4; i++) await api(4, 'POST', '/proposals', { ...prop, title: 'Idea number ' + i });   // Mia now has 5 waiting
  r = await api(4, 'POST', '/proposals', { ...prop, title: 'One too many' });
  t('proposals: at most 5 waiting at a time', r.code === 409, r.json);
  t('proposals: members see only their own; presidents see all with names; volunteers nothing', (await api(5, 'GET', '/proposals')).json.proposals.length === 0 && (await api(4, 'GET', '/proposals')).json.proposals.length === 5 && (await api(2, 'GET', '/proposals')).json.proposals.length === 6 && (await api(2, 'GET', '/proposals')).json.proposals.some(p => p.proposer === 'Mia') && (await api(6, 'GET', '/proposals')).code === 403);
  t('proposals: only a President decides', (await api(4, 'POST', `/proposals/${pid}/decision`, { decision: 'approved' })).code === 403 && (await api(3, 'POST', `/proposals/${pid}/decision`, { decision: 'approved' })).code === 403 && (await api(1, 'POST', `/proposals/${pid}/decision`, { decision: 'approved' })).code === 403);
  t('proposals: rejecting needs a reason; bad decision refused; unknown is 404', (await api(2, 'POST', `/proposals/${pid}/decision`, { decision: 'rejected' })).code === 400 && (await api(2, 'POST', `/proposals/${pid}/decision`, { decision: 'rejected', note: 'no' })).code === 400 && (await api(2, 'POST', `/proposals/${pid}/decision`, { decision: 'maybe' })).code === 400 && (await api(2, 'POST', '/proposals/999/decision', { decision: 'approved' })).code === 404 && T.events.length === 1);
  const eventsBefore = T.events.length; r = await api(2, 'POST', `/proposals/${pid}/decision`, { decision: 'approved', note: 'Great idea' });
  const made = T.events.at(-1);
  t('proposals: approval puts the event straight onto the global calendar', r.code === 200 && T.events.length === eventsBefore + 1 && made.title === 'Beach cleanup' && made.sector === 'Community' && made.hours === 3 && made.capacity === 20 && made.type === 'out' && made.is_active === 1 && made.verification === '["qr","selfie"]' && made.created_by === 2 && r.json.eventId === made.id, [r.json, made]);
  t('proposals: the proposal is linked to its event and audited', T.event_proposals.find(p => p.id === pid).event_id === made.id && T.event_proposals.find(p => p.id === pid).status === 'approved' && T.audit_logs.at(-1).action === 'proposal.approve' && T.audit_logs.at(-1).details.eventId === made.id);
  t('proposals: the new event is visible to every member', (await api(5, 'GET', '/bootstrap')).json.events.some(e => e.title === 'Beach cleanup'));
  t('proposals: deciding again -> 409, and no second event', (await api(2, 'POST', `/proposals/${pid}/decision`, { decision: 'approved' })).code === 409 && T.events.length === eventsBefore + 1);
  const p2 = T.event_proposals.find(p => p.title === 'Bake sale').id;
  r = await api(10, 'POST', `/proposals/${p2}/decision`, { decision: 'approved', sector: 'Creative' });
  t('proposals: either President may decide, and may change the sector', r.code === 200 && T.events.at(-1).sector === 'Creative');
  const p3 = T.event_proposals.find(p => p.title === 'Idea number 0').id;
  r = await api(2, 'POST', `/proposals/${p3}/decision`, { decision: 'rejected', note: 'Clashes with exams' });
  t('proposals: a rejection keeps the reason and creates no event', r.code === 200 && T.event_proposals.find(p => p.id === p3).decision_note === 'Clashes with exams' && T.events.length === eventsBefore + 2 && T.audit_logs.at(-1).action === 'proposal.reject');
  const p4 = T.event_proposals.find(p => p.title === 'Idea number 1').id;
  t('proposals: a proposer can withdraw a waiting one, not someone else\'s, not a decided one', (await api(5, 'POST', `/proposals/${p4}/withdraw`)).code === 404 && (await api(4, 'POST', `/proposals/${p4}/withdraw`)).code === 200 && !T.event_proposals.some(p => p.id === p4) && (await api(4, 'POST', `/proposals/${pid}/withdraw`)).code === 409);

  /* ===================== LOGISTICS CHECKLISTS ===================== */
  w = world({ events: [ev({ id: 1, sector: 'Events' }), ev({ id: 2, sector: 'Finance', title: 'Gala' })] }); ({ T } = w); api = w.api;
  const tk = (who, path, body, method = 'POST') => api(who, method, path, body);
  t('checklist: volunteers cannot open one', (await tk(6, '/events/1/tasks', null, 'GET')).code === 403 && (await tk(null, '/events/1/tasks', null, 'GET')).code === 401);
  t('checklist: only the event\'s head or a President plans it (members, other heads, admin accounts refused)', (await tk(4, '/events/1/tasks', { title: 'Book the hall' })).code === 403 && (await tk(7, '/events/1/tasks', { title: 'Book the hall' })).code === 403 && (await tk(1, '/events/1/tasks', { title: 'Book the hall' })).code === 403);
  const mk = async (who, ev_, title, parent) => (await tk(who, `/events/${ev_}/tasks`, { title, parentId: parent })).json.task;
  const A = await mk(3, 1, 'Stage setup'), B = await mk(3, 1, 'Move the chairs', A.id), C = await mk(3, 1, 'Count the chairs', B.id);
  t('checklist: a head builds a task tree; a President can too', A.id && B.parent_id === A.id && C.parent_id === B.id && (await tk(2, '/events/1/tasks', { title: 'Sound check' })).code === 201);
  r = await tk(3, '/events/1/tasks', { title: 'Too deep', parentId: C.id });
  t('checklist: trees stop at three levels', r.code === 400 && /3 levels/.test(r.json.error), r.json);
  t('checklist: validation (title, parent on another event)', (await tk(3, '/events/1/tasks', { title: 'x' })).code === 400 && (await tk(3, '/events/1/tasks', { title: 'Valid task', parentId: 999 })).code === 400);
  const D = await mk(2, 2, 'Gala task'); t('checklist: a parent must belong to the same event', (await tk(3, '/events/1/tasks', { title: 'Cross-linked', parentId: D.id })).code === 400);
  r = await tk(4, '/events/1/tasks', null, 'GET');
  t('checklist: members read the tree with the manage flag off', r.code === 200 && r.json.tasks.length === 4 && r.json.canManage === false && r.json.tasks.every(x => x.status === 'open'));
  t('checklist: the head\'s view has the manage flag on', (await tk(3, '/events/1/tasks', null, 'GET')).json.canManage === true);
  t('claim: only the smallest tasks can be claimed (a task with sub-tasks cannot)', (await tk(4, `/tasks/${A.id}/claim`)).code === 409 && (await tk(4, `/tasks/${B.id}/claim`)).code === 409);
  t('claim: volunteers cannot', (await tk(6, `/tasks/${C.id}/claim`)).code === 403);
  const [c1, c2] = await Promise.all([tk(4, `/tasks/${C.id}/claim`), tk(5, `/tasks/${C.id}/claim`)]);
  const winner = ok(c1) ? 4 : 5;
  t('claim: two people clicking at once, exactly one wins, the other is told', [c1.code, c2.code].sort().join() === '200,409' && T.logistics_tasks.find(x => x.id === C.id).claimed_by === winner, [c1.code, c2.code]);
  r = await tk(winner, `/tasks/${C.id}/claim`); t('claim: the loser message names the problem', (await tk(winner === 4 ? 5 : 4, `/tasks/${C.id}/claim`)).json.error === 'Someone just took this task.');
  const loser = winner === 4 ? 5 : 4;
  r = await tk(winner, '/events/1/tasks', null, 'GET'); t('claim: everyone sees who has it', r.json.tasks.find(x => x.id === C.id).claimer === (winner === 4 ? 'Mia' : 'Max') && r.json.tasks.find(x => x.id === C.id).status === 'claimed');
  t('status: the owner moves it along', (await tk(winner, `/tasks/${C.id}/status`, { status: 'in_progress' })).json.task.status === 'in_progress' && (await tk(winner, `/tasks/${C.id}/status`, { status: 'done' })).json.task.status === 'done');
  t('status: someone else cannot change it; a head can; bad values refused', (await tk(loser, `/tasks/${C.id}/status`, { status: 'open' })).code === 400 && (await tk(loser, `/tasks/${C.id}/status`, { status: 'in_progress' })).code === 403 && (await tk(3, `/tasks/${C.id}/status`, { status: 'in_progress' })).code === 200);
  t('status: an unclaimed task cannot be started', (await tk(winner, `/tasks/${(await mk(3, 1, 'Fresh task')).id}/status`, { status: 'done' })).code === 409);
  await tk(winner, `/tasks/${C.id}/status`, { status: 'done' });
  t('release: the owner cannot reopen a finished task, a head can', (await tk(winner, `/tasks/${C.id}/release`)).code === 403 && (await tk(3, `/tasks/${C.id}/release`)).code === 200 && T.logistics_tasks.find(x => x.id === C.id).status === 'open');
  await tk(winner, `/tasks/${C.id}/claim`);
  t('release: the owner can let go of a task they have not finished; others cannot force it', (await tk(loser, `/tasks/${C.id}/release`)).code === 403 && (await tk(winner, `/tasks/${C.id}/release`)).code === 200 && T.logistics_tasks.find(x => x.id === C.id).claimed_by === null);
  t('release: releasing an unclaimed task is refused', (await tk(winner, `/tasks/${C.id}/release`)).code === 409);
  const leaf = await mk(3, 1, 'Single leaf task'); await tk(winner, `/tasks/${leaf.id}/claim`);
  r = await tk(3, '/events/1/tasks', { title: 'Sub of a claimed task', parentId: leaf.id });
  t('claimed tasks cannot be split into sub-tasks', r.code === 409 && /already claimed/.test(r.json.error), r.json);
  // limit on how many one person can hold
  for (let i = 0; i < 11; i++) await mk(2, 1, 'Micro task ' + i);
  const open = T.logistics_tasks.filter(x => x.event_id === 1 && x.status === 'open' && !T.logistics_tasks.some(k => k.parent_id === x.id));
  let results = []; for (const x of open.slice(0, 11)) results.push((await tk(5, `/tasks/${x.id}/claim`)).code);
  t('claim: one person holds at most 10 open tasks on an event', results.filter(c => c === 200).length >= 1 && results.includes(409) && T.logistics_tasks.filter(x => x.claimed_by === 5 && ['claimed', 'in_progress'].includes(x.status)).length === 10, results);
  t('delete: members cannot remove tasks; the head can, and sub-tasks go with it', (await tk(4, `/tasks/${A.id}`, null, 'DELETE')).code === 403 && (await tk(7, `/tasks/${A.id}`, null, 'DELETE')).code === 403 && (await tk(3, `/tasks/${A.id}`, null, 'DELETE')).code === 200 && !T.logistics_tasks.some(x => [A.id, B.id, C.id].includes(x.id)));

  /* ===================== ANONYMOUS FEEDBACK ===================== */
  const FB = require('./feedback');
  const k = require('crypto').createHash('sha256').update(KEY).digest();
  const blob = FB.encrypt('The treasurer misplaced my receipt.', k);
  t('crypto: round trip', FB.decrypt(blob, k) === 'The treasurer misplaced my receipt.');
  t('crypto: the stored text is not readable and differs each time (random IV)', !Buffer.from(blob, 'base64').toString('utf8').includes('treasurer') && FB.encrypt('same', k) !== FB.encrypt('same', k));
  let tampered = Buffer.from(blob, 'base64'); tampered[tampered.length - 1] ^= 1;
  let threw = false; try { FB.decrypt(tampered.toString('base64'), k); } catch { threw = true; } t('crypto: a changed byte is detected (authenticated encryption)', threw);
  threw = false; try { FB.decrypt(blob, require('crypto').createHash('sha256').update('other').digest()); } catch { threw = true; } t('crypto: the wrong key cannot read it', threw);
  w = world(); ({ T } = w); api = w.api;
  const fbBody = { category: 'uncredited_hours', body: 'My 3 hours at the book drive were never credited.' };
  t('feedback: volunteers cannot send; anonymous visitors cannot', (await api(6, 'POST', '/feedback', fbBody)).code === 403 && (await api(null, 'POST', '/feedback', fbBody)).code === 401);
  t('feedback: bad category and too-short messages are refused', (await api(4, 'POST', '/feedback', { ...fbBody, category: 'gossip' })).code === 400 && (await api(4, 'POST', '/feedback', { ...fbBody, body: 'short' })).code === 400 && (await api(4, 'POST', '/feedback', { ...fbBody, body: 'x'.repeat(2001) })).code === 400);
  r = await api(4, 'POST', '/feedback', fbBody);
  t('feedback: a member sends; nothing comes back that identifies anything', r.code === 201 && Object.keys(r.json).join() === 'ok');
  await api(3, 'POST', '/feedback', { category: 'admin_issue', body: 'The sign-up sheet keeps disappearing from the shared drive.' });
  const row = T.anonymous_feedback[0];
  t('feedback: the stored row holds no sender: no user, no email, no IP, no timestamp beyond created_at', !Object.keys(row).some(x => /user|sender|author|email|ip|member/i.test(x)) && Object.keys(row).sort().join() === 'body_enc,category,created_at,id');
  t('feedback: the text is encrypted in the database (neither message appears in readable form)', !JSON.stringify(T.anonymous_feedback).includes('book drive') && !JSON.stringify(T.anonymous_feedback).includes('sign-up sheet'));
  t('feedback: sending leaves nothing in the audit log', T.audit_logs.length === 0);
  t('feedback: only Presidents read the inbox', (await api(4, 'GET', '/feedback')).code === 403 && (await api(3, 'GET', '/feedback')).code === 403 && (await api(1, 'GET', '/feedback')).code === 403 && (await api(6, 'GET', '/feedback')).code === 403 && (await api(null, 'GET', '/feedback')).code === 401);
  r = await api(2, 'GET', '/feedback');
  t('feedback: a President reads them decrypted, newest first, with only the day', r.code === 200 && r.json.messages.length === 2 && r.json.messages[0].category === 'admin_issue' && r.json.messages[1].body === fbBody.body && /^\d{4}-\d{2}-\d{2}$/.test(r.json.messages[0].day) && r.json.messages.every(m => !('user' in m) && !('sender' in m)));
  t('feedback: statuses can be set by a President only; the audit entry has no content', (await api(4, 'POST', `/feedback/${row.id}/status`, { status: 'read' })).code === 403 && (await api(2, 'POST', `/feedback/${row.id}/status`, { status: 'read' })).code === 200 && T.anonymous_feedback[0].status === 'read'
    && T.audit_logs.at(-1).action === 'feedback.status' && !JSON.stringify(T.audit_logs).includes('book drive') && (await api(2, 'POST', `/feedback/${row.id}/status`, { status: 'burned' })).code === 400 && (await api(2, 'POST', '/feedback/999/status', { status: 'read' })).code === 404);
  T.anonymous_feedback[0].body_enc = FB.encrypt('x', require('crypto').createHash('sha256').update('rotated').digest());
  t('feedback: a message the key cannot open is reported, not a crash', (await api(2, 'GET', '/feedback')).json.messages.some(m => /cannot be decrypted/.test(m.body)));
  const saved = process.env.FEEDBACK_KEY; delete process.env.FEEDBACK_KEY;
  t('feedback: with no key set the box says so and stores nothing in plain text', (await api(4, 'POST', '/feedback', fbBody)).code === 503 && (await api(2, 'GET', '/feedback')).code === 503 && T.anonymous_feedback.length === 2);
  process.env.FEEDBACK_KEY = 'short'; t('feedback: a key that is too short is refused too', (await api(4, 'POST', '/feedback', fbBody)).code === 503);
  process.env.FEEDBACK_KEY = saved;

  /* ===================== RESOURCE VAULT ===================== */
  w = world(); ({ T } = w); api = w.api;
  const asset = { title: 'Club bylaws 2026', category: 'bylaws', url: 'drive.google.com/bylaws', description: 'Adopted in September' };
  t('vault: only a President adds (members, heads, admin accounts, volunteers refused)', (await api(4, 'POST', '/vault', asset)).code === 403 && (await api(3, 'POST', '/vault', asset)).code === 403 && (await api(1, 'POST', '/vault', asset)).code === 403 && (await api(6, 'POST', '/vault', asset)).code === 403 && (await api(null, 'POST', '/vault', asset)).code === 401);
  t('vault: validation (title, category, link)', (await api(2, 'POST', '/vault', { ...asset, title: 'x' })).code === 400 && (await api(2, 'POST', '/vault', { ...asset, category: 'memes' })).code === 400 && (await api(2, 'POST', '/vault', { ...asset, url: 'javascript:alert(1)' })).code === 400 && T.resource_vault.length === 0);
  r = await api(2, 'POST', '/vault', asset);
  t('vault: a President adds an asset; the link is normalised; it is audited', r.code === 201 && r.json.item.url === 'https://drive.google.com/bylaws' && T.audit_logs.at(-1).action === 'vault.add');
  await api(10, 'POST', '/vault', { title: 'Meeting minutes, October', category: 'minutes', url: 'https://docs.example.org/minutes-oct' });
  t('vault: members read it; so do heads; volunteers cannot', (await api(4, 'GET', '/vault')).json.items.length === 2 && (await api(3, 'GET', '/vault')).code === 200 && (await api(6, 'GET', '/vault')).code === 403 && (await api(null, 'GET', '/vault')).code === 401);
  t('vault: for members it is read-only (manage flag off)', (await api(4, 'GET', '/vault')).json.canManage === false && (await api(2, 'GET', '/vault')).json.canManage === true);
  t('vault: there is no way to edit or delete (those routes do not exist)', (await api(2, 'DELETE', '/vault/1')).code === 404 && (await api(2, 'PATCH', '/vault/1', { title: 'x' })).code === 404 && (await api(2, 'PUT', '/vault/1', { title: 'x' })).code === 404);
  t('vault: only a President archives', (await api(4, 'POST', '/vault/1/archive')).code === 403 && (await api(3, 'POST', '/vault/1/archive')).code === 403 && (await api(2, 'POST', '/vault/1/archive')).code === 200 && (await api(2, 'POST', '/vault/1/archive')).code === 404);
  t('vault: an archived asset disappears for members but stays in the database and for Presidents (?all=1)', (await api(4, 'GET', '/vault')).json.items.length === 1 && T.resource_vault.length === 2 && (await api(2, 'GET', '/vault', null, { all: '1' })).json.items.length === 2 && (await api(4, 'GET', '/vault', null, { all: '1' })).json.items.length === 1 && T.audit_logs.at(-1).action === 'vault.archive');

  console.log(`\nspec part 2 (roles, proposals, checklists, feedback, vault): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
