// The presidential modules, driven through the real page against the real routes. Run: node tests/e2e-spec.js
const fs = require('fs'), path = require('path');
const { loadApp, openAs, BASE } = require('./harness');
process.env.SESSION_SECRET = 'e2e-secret'; process.env.FEEDBACK_KEY = 'e'.repeat(40) + '-e2e-key';
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); };
const U = (id, role, sector, name) => ({ id, name, email: name.toLowerCase() + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0, demoted_at: null, demotion_reason: null, attendance_reset_at: null, created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z` });
const ALL = [U(1, 'admin', null, 'Ann'), U(2, 'pres', null, 'Pat'), U(10, 'pres', null, 'Pia'), U(3, 'lead', 'Events', 'Eli'), U(7, 'lead', 'Finance', 'Fay'), U(11, 'lead', 'Community', 'Cam'), U(12, 'lead', 'Creative', 'Rae'),
  U(4, 'member', 'Events', 'Mia'), U(5, 'member', 'Events', 'Max'), U(13, 'member', null, 'Nia'), U(14, 'member', 'Creative', 'Zed'), U(6, 'volunteer', null, 'Vic')];
const ev = o => ({ id: 1, title: 'Book fair', sector: 'Events', hours: 2, capacity: 20, volunteer_slots: 1, location: 'Hall', date_label: 'Oct 31', type: 'in', verification: '["qr","selfie"]', shifts: null, points: null, days: null, waiver_required: 0, is_setup: 0, is_active: 1, lat: null, lng: null, created_by: 1, created_at: '2026-01-01T00:00:00Z', ...o });
const fresh = (extra = {}) => { const T = { users: ALL.map(u => ({ ...u })), events: [ev()], signups: [], hour_logs: [], ...extra }, a = loadApp(T), app = { call: a.call };
  return { T, app, call: a.call, row: id => T.users.find(u => u.id === id), open: id => openAs(app, T, T.users.find(u => u.id === id)),
    as: id => { const r = T.users.find(u => u.id === id); return { id: r.id, name: r.name, email: r.email, role: r.role, sector: r.sector }; } }; };
const tabKeys = b => { const nav = /<nav class="tabs" role="tablist">[\s\S]*?<\/nav>/.exec(b.app()); return nav ? [...nav[0].matchAll(/data-t="(\w+)"/g)].map(m => m[1]) : []; };
const roleKeys = b => [...b.app().matchAll(/data-act="role" data-r="(\w+)"/g)].map(m => m[1]);
const has = (arr, ...xs) => xs.every(x => arr.includes(x)), lacks = (arr, ...xs) => xs.every(x => !arr.includes(x));
const page = fs.readFileSync(path.join(BASE, 'public', 'index.html'), 'utf8');

(async () => {
  /* ===================== who sees which tabs ===================== */
  let w = fresh(); const mia = await w.open(4), vic = await w.open(6), eli = await w.open(3), fay = await w.open(7), pat = await w.open(2), ann = await w.open(1);
  let k = tabKeys(mia);
  ok('member tabs: the spec\'s member tools are there, the money and audit tools are not', has(k, 'home', 'events', 'roles', 'propose', 'tasks', 'feed', 'feedback', 'vault', 'cert') && lacks(k, 'treasury', 'audit', 'roll', 'inbox'), k);
  k = tabKeys(eli); ok('Sector Head tabs: approvals, roll-call, sector roles, checklists, vault; no treasury unless Finance', has(k, 'review', 'roll', 'events', 'sroles', 'tasks', 'qr', 'sector', 'vault') && lacks(k, 'treasury', 'audit', 'inbox'), k);
  k = tabKeys(fay); ok('the Finance Head also gets the Treasury', has(k, 'treasury', 'roll', 'vault') && !k.includes('audit'), k);
  k = tabKeys(pat); ok('President tabs: proposals, treasury, attendance, audit log, feedback inbox, vault', has(k, 'center', 'over', 'props', 'treasury', 'attend', 'roster', 'audit', 'inbox', 'vault', 'export', 'certs'), k);
  k = tabKeys(ann); ok('an admin account does not get the money, audit, attendance or feedback tabs', has(k, 'center', 'over', 'roster', 'vault', 'export') && lacks(k, 'props', 'treasury', 'attend', 'audit', 'inbox'), k);
  k = tabKeys(vic); ok('volunteers see only events and their status', k.join() === 'events,status', k);
  ok('role switcher: a Sector Head can switch to Member; a member cannot switch; a President can preview everything', roleKeys(eli).join() === 'lead,member' && roleKeys(mia).join() === 'member' && roleKeys(pat).length === 4 && roleKeys(vic).join() === 'vol', [roleKeys(eli), roleKeys(mia), roleKeys(pat)]);
  await eli.act('role', { r: 'member' }); ok('a Sector Head can use the member screens too', /My impact/.test(eli.text()) && has(tabKeys(eli), 'propose', 'feedback'));
  await ann.act('role', { r: 'lead' }); ok('an admin previewing the Sector Head view does not get roll-call or role posting', lacks(tabKeys(ann), 'roll', 'sroles') && has(tabKeys(ann), 'review', 'tasks'));
  ok('the whole page is on the new look: #191A1E base, #2E323A micro-borders, and nothing of the old navy', /--bg:#191A1E/.test(page) && /--line:#2E323A/.test(page) && !/#0B0F19/.test(page) && /<meta name="theme-color" content="#191A1E">/.test(page));
  ok('numbers, dates and financial tables use the monospace face', /\.tile b\{font-family:var\(--f-mono\)/.test(page) && /\.ledger td[^{]*\{[^}]*var\(--f-mono\)/.test(page) && /<dd class="mono">\$\{esc\(e\.date\)\}/.test(page) && /\.bal\{font-family:var\(--f-mono\)/.test(page));
  ok('roles that are full are shown at low opacity and disabled', /\.role-card\.full\{opacity:\.45\}/.test(page));

  /* ===================== treasury ===================== */
  w = fresh(); const fay2 = await w.open(7), pat2 = await w.open(2);
  await fay2.go('lead', 'treasury');
  ok('treasury: opens with a zero balance, a verified ledger and an honest empty state', /0\.00/.test(fay2.text()) && /Ledger verified/.test(fay2.text()) && /The ledger is empty/.test(fay2.text()), fay2.text().slice(-300));
  fay2.setVal('tr-type', 'income'); fay2.setVal('tr-amt', '100.5'); fay2.setVal('tr-cat', 'Bake sale'); fay2.setVal('tr-desc', 'Saturday stall'); await fay2.act('tradd');
  ok('treasury: an income entry shows in the ledger and in the balance', /100\.50/.test(fay2.text()) && /Saturday stall/.test(fay2.text()) && /Bake sale/.test(fay2.text()) && w.T.treasury_ledger.length === 1, fay2.text().slice(-300));
  fay2.setVal('tr-type', 'expense'); fay2.setVal('tr-amt', '500'); fay2.setVal('tr-cat', 'Trip'); fay2.setVal('tr-desc', 'Bus'); await fay2.act('tradd');
  ok('treasury: spending more than the balance is refused with the reason', /Not enough money/.test(fay2.toast()) && w.T.treasury_ledger.length === 1, fay2.toast());
  await fay2.act('trrev', { id: '1', seq: '1' });
  ok('treasury: reversing asks for a reason first', /Reverse entry #1/.test(fay2.modal()) && /cancels the old one/.test(fay2.modal()));
  fay2.setVal('rv-reason', 'Entered twice'); await fay2.act('trrevgo');
  ok('treasury: the reversal is a new row; the original stays; the balance returns to zero', w.T.treasury_ledger.length === 2 && w.T.treasury_ledger[0].amount === 100.5 && /Reversal/.test(fay2.text()) && /Reversed/.test(fay2.text()) && /0\.00/.test(fay2.text()));
  ok('treasury: the screen offers no way to edit or delete (only Reverse)', !/data-act="trdel"|data-act="tredit"/.test(fay2.html()));
  await w.call('POST', '/api/treasury', { user: w.as(2), body: { type: 'income', amount: 50, category: 'Grant', description: 'Rotary grant' } });
  fay2.tick(); await fay2.settle();
  ok('treasury: the balance refreshes by itself when somebody else adds an entry', /50\.00/.test(fay2.text()) && /Rotary grant/.test(fay2.text()), fay2.text().slice(-250));
  await pat2.go('pres', 'treasury'); ok('treasury: Presidents see the same ledger', /Rotary grant/.test(pat2.text()) && /Fay/.test(pat2.text()));
  ok('treasury: a member forced to the screen is refused by the server and sees the reason, not the money', (await w.call('GET', '/api/treasury', { user: w.as(4) })).code === 403);
  // audit log screen
  await pat2.go('pres', 'audit');
  ok('audit screen: entries with who, action and details; treasury writes are in it', /treasury\.income/.test(pat2.text()) && /treasury\.reverse/.test(pat2.text()) && /Fay/.test(pat2.text()) && /Append-only/.test(pat2.text()), pat2.text().slice(-300));
  pat2.X.CH.auditE('treasury'); await pat2.settle(); ok('audit screen: the filter asks the server for just that kind', /entity=treasury/.test(pat2.state.calls.join(' ')) || pat2.X.MOD.url.audit.includes('entity=treasury'));
  ok('audit screen: there is no edit or delete control anywhere on it', !/data-act="audit(del|edit)"/.test(pat2.html()));

  /* ===================== roll-call and automatic demotion ===================== */
  w = fresh(); const eli2 = await w.open(3); await eli2.go('lead', 'roll');
  ok('roll-call: opens with an honest empty state and the rule explained', /No meetings yet/.test(eli2.text()) && /3 absences in a row or 5 in total/.test(eli2.text()), eli2.text().slice(-300));
  const meeting = async (title, date, marks) => { eli2.setVal('mt-title', title); eli2.setVal('mt-date', date); await eli2.act('mtadd'); await eli2.act('markall'); for (const [u, s] of Object.entries(marks)) await eli2.act('mark', { u, s }); await eli2.act('rcsave'); };
  eli2.setVal('mt-title', 'Weekly meeting 1'); eli2.setVal('mt-date', '2026-03-01'); await eli2.act('mtadd');
  ok('roll-call: the roster is the head\'s own sector\'s members only', /Mia/.test(eli2.el('#rollPanel').innerHTML + eli2.text()) && /Max/.test(eli2.text()) && !/Nia|Zed|Vic/.test(eli2.text() + eli2.el('#rollPanel').innerHTML), eli2.text().slice(-400));
  ok('roll-call: Save is disabled until everybody is marked', /data-act="rcsave"\s+disabled/.test(eli2.app()), eli2.app().match(/data-act="rcsave"[^>]*>/));
  await eli2.act('markall'); ok('roll-call: "Mark everyone present" enables Save', !/data-act="rcsave"\s+disabled/.test(eli2.el('#rollPanel').innerHTML) && Object.keys(eli2.X.S.marks).length === 2);
  await eli2.act('mark', { u: '4', s: 'absent' }); await eli2.act('rcsave');
  ok('roll-call: saved to the database; the meeting shows as taken; nobody demoted yet', w.T.attendance_logs.length === 2 && w.T.attendance_logs.find(l => l.user_id === 4).status === 'absent' && /Roll-call taken/.test(eli2.text()) && /Nobody reached the limit/.test(eli2.text()), eli2.text().slice(-300));
  await eli2.go('lead', 'roll');
  ok('roll-call: once taken, a Sector Head sees it read-only', /A President can correct it/.test(eli2.text()) || (await eli2.act('mtopen', { id: '1' }), /A President can correct it/.test(eli2.text())));
  await meeting('Weekly meeting 2', '2026-03-08', { 4: 'absent' });
  ok('roll-call: two in a row is still not enough', w.row(4).role === 'member');
  await meeting('Weekly meeting 3', '2026-03-15', { 4: 'absent' });
  ok('roll-call: the third absence in a row demotes automatically, and the head is told', w.row(4).role === 'volunteer' && /moved to Common Volunteer/.test(eli2.toast()) && /Mia was moved to Common Volunteer \(3 consecutive absences\)/.test(eli2.text()), [w.row(4).role, eli2.toast()]);
  ok('roll-call: the audit log has the automatic demotion done by the System', w.T.audit_logs.some(a => a.action === 'attendance.auto_demotion' && a.actor_name === 'System' && a.entity_id === '4'));
  const mia3 = await w.open(4);
  ok('a demoted member gets the Common Volunteer screens and loses the member tools', mia3.X.S.role === 'vol' && lacks(tabKeys(mia3), 'roles', 'propose', 'tasks') && /Request promotion/.test((await mia3.go('vol', 'status'), mia3.text())));
  const pat3 = await w.open(2); await pat3.go('pres', 'attend');
  ok('attendance: Presidents see the demoted member with the reason and a Reinstate button', /Mia/.test(pat3.text()) && /3 consecutive absences/.test(pat3.text()) && /Reinstate/.test(pat3.text()), pat3.text().slice(-400));
  await pat3.act('reinstate', { id: '4' });
  ok('attendance: reinstating restores the member (audited) and clears the list', w.row(4).role === 'member' && !/Reinstate/.test(pat3.text()) && w.T.audit_logs.some(a => a.action === 'member.reinstate') && /Nobody has been demoted/.test(pat3.text()));
  await pat3.go('pres', 'roster');
  ok('roster: a President gets a "Move to sector" control on active members only', /data-ch="assignsec" data-id="4"/.test(pat3.app()) && !/data-ch="assignsec" data-id="6"/.test(pat3.app()) && !/data-ch="assignsec" data-id="3"/.test(pat3.app()));
  await pat3.X.CH.assignsec('Finance', { dataset: { id: '4' } }); await pat3.settle();
  ok('roster: cross-sector recruitment moves the member, shows the new sector and is audited', w.row(4).sector === 'Finance' && /Finance & Marketing/.test(pat3.text()) && w.T.audit_logs.some(a => a.action === 'member.assign_sector' && a.details.to === 'Finance'));
  const eliR = await w.open(3); await eliR.go('lead', 'sector'); ok('roster: Sector Heads get no such control', !/data-ch="assignsec"/.test(eliR.app()));
  await pat3.go('pres', 'attend'); await pat3.act('gotoroll'); ok('attendance: Presidents can jump into roll-call for any sector', pat3.X.S.role === 'lead' && /Roll-call/.test(pat3.text()));

  /* ===================== sector roles ===================== */
  w = fresh(); const eli3 = await w.open(3), mia4 = await w.open(4), max4 = await w.open(5), zed = await w.open(14);
  await eli3.go('lead', 'sroles'); ok('sector roles: a head sees an honest empty state and the posting form', /No roles posted yet/.test(eli3.text()) && /Post a role/.test(eli3.text()));
  eli3.setVal('sr-title', 'Stage crew'); eli3.setVal('sr-cap', '1'); eli3.setVal('sr-desc', 'Set up the hall'); await eli3.act('sradd');
  ok('sector roles: the role is posted for the head\'s sector', /Stage crew/.test(eli3.text()) && w.T.sector_roles[0].sector === 'Events' && /0<\/b> of <b>1/.test(eli3.app()), eli3.text().slice(-250));
  await mia4.go('member', 'roles'); ok('sector roles: a member sees the opening with Apply enabled', /Stage crew/.test(mia4.text()) && /data-act="rapply"[^>]*>Apply/.test(mia4.app()) && !/data-act="rapply"[^>]*disabled/.test(mia4.app()));
  await mia4.act('rapply', { id: '1' }); ok('sector roles: applying shows "Application sent" and a Withdraw button', /Application sent/.test(mia4.text()) && /Withdraw/.test(mia4.text()));
  await eli3.act('retry'); await eli3.go('lead', 'sroles'); ok('sector roles: the head sees the applicant with Accept and Decline', /Mia/.test(eli3.text()) && /Accept/.test(eli3.text()) && /Decline/.test(eli3.text()));
  await eli3.act('srdec', { id: String(w.T.role_applications[0].id), d: 'accepted' });
  ok('sector roles: accepted: 1 of 1 places filled, the applicant is "In the role"', /1<\/b> of <b>1/.test(eli3.app()) && /In the role/.test(eli3.text()));
  await max4.go('member', 'roles');
  ok('sector roles: a full role is greyed out (low opacity) and its button reads Full and is disabled', /role-card stack full/.test(max4.app()) && /data-act="rapply"[^>]*disabled[^>]*>Full/.test(max4.app()), max4.app().match(/<article class="card role-card[^>]*>/));
  await eli3.go('lead', 'sroles'); eli3.setVal('sr-title', 'Guest host'); eli3.setVal('sr-cap', '3'); eli3.setVal('sr-desc', ''); await eli3.act('sradd');
  await zed.go('member', 'roles'); await zed.act('rapply', { id: '2' }); await eli3.act('retry'); await eli3.go('lead', 'sroles');
  await eli3.act('srdec', { id: String(w.T.role_applications.find(a => a.user_id === 14).id), d: 'accepted' });
  ok('sector roles: a head cannot recruit across sectors; the message says a President must', /Only a President can recruit across sectors/.test(eli3.toast()) && w.row(14).sector === 'Creative', eli3.toast());

  /* ===================== member-led proposals ===================== */
  w = fresh(); const mia5 = await w.open(4), pat5 = await w.open(2), max5 = await w.open(5);
  await mia5.go('member', 'propose'); ok('proposals: members see the form and an empty list', /Pitch an event/.test(mia5.text()) && /No proposals yet/.test(mia5.text()));
  const fill = (b, title) => { for (const [id, v] of Object.entries({ 'pp-title': title, 'pp-cat': 'service', 'pp-sec': 'Community', 'pp-type': 'out', 'pp-date': 'Nov 20', 'pp-loc': 'River park', 'pp-hours': '3', 'pp-cap': '20', 'pp-desc': 'Collect litter along the river and weigh it.' })) b.setVal(id, v); };
  fill(mia5, 'River cleanup'); await mia5.act('ppadd');
  ok('proposals: the pitch is saved and shows as waiting for a President', /River cleanup/.test(mia5.text()) && /Waiting for a President/.test(mia5.text()) && w.T.event_proposals.length === 1);
  await pat5.go('pres', 'props');
  ok('proposals: Presidents see it with the proposer and a count badge on the tab', /River cleanup/.test(pat5.text()) && /from Mia/.test(pat5.text()) && /<span class="dot">1<\/span>/.test(pat5.app()), pat5.text().slice(-300));
  const eventsBefore = w.T.events.length; await pat5.act('ppok', { id: '1' });
  ok('proposals: approving creates the calendar event right away, for everyone', w.T.events.length === eventsBefore + 1 && w.T.events.at(-1).title === 'River cleanup' && w.T.events.at(-1).sector === 'Community' && /Approved/.test(pat5.text()));
  await max5.act('retry'); await max5.go('member', 'events'); ok('proposals: other members see the new event on the calendar', /River cleanup/.test(max5.text()));
  await mia5.act('retry'); await mia5.go('member', 'propose'); ok('proposals: the proposer sees it approved and on the calendar', /Approved: on the calendar/.test(mia5.text()));
  fill(mia5, 'Silent disco'); await mia5.act('ppadd'); await pat5.act('retry'); await pat5.go('pres', 'props');
  await pat5.act('ppno', { id: '2' }); ok('proposals: declining asks for a reason in a dialog', /Decline this proposal/.test(pat5.modal()) && /The member will see your reason/.test(pat5.modal()));
  pat5.setVal('pn-note', 'Clashes with the exam week'); await pat5.act('ppnogo');
  await mia5.act('retry'); await mia5.go('member', 'propose');
  ok('proposals: the decline reason reaches the proposer', /Declined/.test(mia5.text()) && /Clashes with the exam week/.test(mia5.text()) && w.T.events.length === eventsBefore + 1);

  /* ===================== logistics checklists ===================== */
  w = fresh(); const eli6 = await w.open(3), mia6 = await w.open(4), max6 = await w.open(5);
  await eli6.go('lead', 'tasks'); ok('checklist: an empty event shows an honest empty state and the task form to its head', /No tasks yet/.test(eli6.text()) && /Add the first task below/.test(eli6.text()) && /Add a task/.test(eli6.text()));
  eli6.setVal('tk-title', 'Stage setup'); await eli6.act('taskadd');
  const parent = w.T.logistics_tasks[0].id; eli6.setVal('tk-title', 'Move the chairs'); eli6.setVal('tk-parent', String(parent)); await eli6.act('taskadd');
  const child = w.T.logistics_tasks[1].id;
  ok('checklist: the head builds a tree; the parent shows progress, not a checkbox', /Stage setup/.test(eli6.text()) && /Move the chairs/.test(eli6.text()) && /0 of 1 done/.test(eli6.text()) && !new RegExp(`data-act="tasktoggle" data-id="${parent}"`).test(eli6.app()), eli6.app().slice(-600));
  await mia6.go('member', 'tasks'); await max6.go('member', 'tasks');
  ok('checklist: members see the tree, but no form to add tasks', /Move the chairs/.test(mia6.text()) && !/Add a task/.test(mia6.text()) && new RegExp(`data-act="tasktoggle" data-id="${child}"`).test(mia6.app()));
  let releaseClaim;
  mia6.state.requestGates.set(`POST /api/tasks/${child}/claim`, new Promise(resolve => { releaseClaim = resolve; }));
  const pending = mia6.X.A.tasktoggle({ id: String(child) });          // not awaited: look at the screen before the server answers
  const mine = mia6.X.MOD.d['tasks:1'].tasks.find(t => t.id === child);
  ok('optimistic: the task is claimed on screen immediately, marked busy, before the server answers', mine.claimed_by === 4 && mine.status === 'claimed' && mine.pending === true && /busy/.test(mia6.el('#taskList').innerHTML) && /Mia/.test(mia6.el('#taskList').innerHTML), mia6.el('#taskList').innerHTML.slice(0, 300));
  ok('optimistic: nothing has been saved yet at that instant', w.T.logistics_tasks.find(t => t.id === child).claimed_by === null);
  releaseClaim();
  await pending; await mia6.settle();
  ok('optimistic: the server confirms; the busy mark clears; it is saved', w.T.logistics_tasks.find(t => t.id === child).claimed_by === 4 && !mine.pending && !/busy/.test(mia6.el('#taskList').innerHTML));
  await max6.act('tasktoggle', { id: String(child) });                   // Max still sees it as open: his claim loses
  ok('optimistic: if somebody else was first, the screen rolls back and says why', /Someone just took this task/.test(max6.toast()) && w.T.logistics_tasks.find(t => t.id === child).claimed_by === 4, max6.toast());
  await max6.settle(); ok('optimistic: after the rollback the screen shows who really has it', /Mia/.test(max6.el('#taskList').innerHTML + max6.text()) && max6.X.MOD.d['tasks:1'].tasks.find(t => t.id === child).claimed_by === 4);
  ok('checklist: a task someone else holds is greyed out for other members', /task [^"]*taken/.test(max6.el('#taskList').innerHTML + max6.app()));
  await mia6.act('taskstatus', { id: String(child), s: 'done' });
  eli6.tick(); await eli6.settle();
  ok('checklist: the head sees the progress update on their own screen without reloading (live updates)', /1 of 1 done/.test(eli6.text()) && /Done/.test(eli6.text()), eli6.text().slice(-300));
  ok('checklist: once a task is done its owner can no longer un-tick it (the box is disabled)', new RegExp(`data-act="tasktoggle" data-id="${child}"[^>]*disabled`).test(mia6.el('#taskList').innerHTML), mia6.el('#taskList').innerHTML.slice(0, 400));
  await eli6.act('tasktoggle', { id: String(child) });
  ok('checklist: a head can reopen a finished task', w.T.logistics_tasks.find(t => t.id === child).claimed_by === null && w.T.logistics_tasks.find(t => t.id === child).status === 'open');
  await mia6.act('retry'); await mia6.go('member', 'tasks'); await mia6.act('tasktoggle', { id: String(child) }); await mia6.act('taskstatus', { id: String(child), s: 'in_progress' });
  ok('checklist: a task in progress shows its status to everyone', w.T.logistics_tasks.find(t => t.id === child).status === 'in_progress' && /In progress/.test(mia6.el('#taskList').innerHTML));
  await mia6.act('tasktoggle', { id: String(child) }); ok('checklist: ticking a task you hold (not finished) lets go of it', w.T.logistics_tasks.find(t => t.id === child).claimed_by === null && w.T.logistics_tasks.find(t => t.id === child).status === 'open');
  await eli6.act('taskdel', { id: String(parent) }); ok('checklist: the head removes a task and everything under it', w.T.logistics_tasks.length === 0 && /No tasks yet/.test(eli6.text()));

  /* ===================== anonymous feedback ===================== */
  w = fresh(); const max7 = await w.open(5), pat7 = await w.open(2);
  await max7.go('member', 'feedback');
  ok('feedback: the box explains what is and is not stored', /Nothing that identifies you is saved/.test(max7.text()) && /encrypted before it is stored/.test(max7.text()) && /only the Presidents can read it/.test(max7.text()));
  max7.setVal('fb-cat', 'uncredited_hours'); max7.setVal('fb-body', 'My 3 hours at the book fair were never credited to me.'); await max7.act('fbsend');
  ok('feedback: sent; the page confirms', max7.X.S.fbSent && /Sent\./.test(max7.text()) && w.T.anonymous_feedback.length === 1);
  ok('feedback: the stored row has no sender and the text is not readable', !Object.keys(w.T.anonymous_feedback[0]).some(x => /user|sender|author|email/i.test(x)) && !JSON.stringify(w.T.anonymous_feedback).includes('book fair'));
  await max7.act('tab', { t: 'vault' }); await max7.act('tab', { t: 'feedback' }); ok('feedback: the confirmation is gone when you come back', !/Sent\. The Presidents/.test(max7.text()));
  await pat7.go('pres', 'inbox'); ok('feedback: a President reads it, decrypted, with only the day', /book fair were never credited/.test(pat7.text()) && /Hours I was not credited for/.test(pat7.text()) && !/Max/.test(pat7.text().replace(/Command center/g, '')), pat7.text().slice(-300));
  await pat7.act('fbstatus', { id: '1', s: 'resolved' }); ok('feedback: marking it resolved updates the screen', /Resolved/.test(pat7.text()) && w.T.anonymous_feedback[0].status === 'resolved');
  await pat7.go('pres', 'audit'); ok('feedback: the audit log records the handling but never the content', /feedback\.status/.test(pat7.text()) && !/book fair/.test(pat7.text()));
  const vic7 = await w.open(6); ok('feedback: volunteers have no feedback tab', !tabKeys(vic7).includes('feedback'));

  /* ===================== resource vault ===================== */
  w = fresh(); const pat8 = await w.open(2), max8 = await w.open(5);
  await pat8.go('pres', 'vault'); ok('vault: a President sees an empty vault and the add form', /The vault is empty/.test(pat8.text()) && /Add a document/.test(pat8.text()));
  pat8.setVal('vl-title', 'Club bylaws 2026'); pat8.setVal('vl-cat', 'bylaws'); pat8.setVal('vl-url', 'drive.google.com/bylaws'); pat8.setVal('vl-desc', 'Adopted in September'); await pat8.act('vaultadd');
  ok('vault: the document appears under its kind, with an Open link', /Club bylaws 2026/.test(pat8.text()) && /Bylaws/.test(pat8.text()) && pat8.app().includes('href="https://drive.google.com/bylaws"'));
  await max8.go('member', 'vault');
  ok('vault: a member can read and open it, but there is no way to add, edit, delete or archive', /Club bylaws 2026/.test(max8.text()) && /Read-only/.test(max8.text()) && !/Add a document|data-act="vaultadd"|data-act="vaultarch"/.test(max8.app()));
  await pat8.act('vaultarch', { id: '1' }); await max8.act('retry'); await max8.go('member', 'vault');
  ok('vault: archiving hides it from members (never deletes it)', /The vault is empty/.test(max8.text()) && w.T.resource_vault.length === 1 && w.T.resource_vault[0].archived === true);

  /* ===================== overtime, override and the audit trail ===================== */
  w = fresh({ hour_logs: [{ id: 1, user_id: 4, event_id: 1, hours: 2, day: 1, status: 'approved', flagged: 0, reviewed_by: 3, reviewed_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z', overtime_hours: null, overtime_status: null },
    { id: 2, user_id: 5, event_id: 1, hours: 2, day: 1, status: 'approved', flagged: 0, reviewed_by: 3, reviewed_at: '2026-02-02T00:00:00Z', created_at: '2026-02-02T00:00:00Z', overtime_hours: 1, overtime_reason: 'Stayed to lock up after the fair ended', overtime_status: 'pending', overtime_proof_url: 'https://photos.example/lockup.jpg' }] });
  const ann9 = await w.open(1), pat9 = await w.open(2); await ann9.go('pres', 'over'); await pat9.go('pres', 'over');
  ok('overtime: an admin account sees the request and its proof but has no approve button (only a President decides)', /Only a President can approve extended shifts/.test(ann9.text()) && /View proof/.test(ann9.text()) && !/data-act="otok"|data-act="otno"/.test(ann9.app()) && !/Recent decisions/.test(ann9.text()));
  ok('overtime: a President sees the proof link and the approve and deny buttons', /View proof/.test(pat9.text()) && pat9.app().includes('href="https://photos.example/lockup.jpg"') && /data-act="otok"/.test(pat9.app()));
  ok('override: a President sees recent decisions with a change button', /Recent decisions/.test(pat9.text()) && /Change to rejected/.test(pat9.text()), pat9.text().slice(-300));
  await pat9.act('ovopen', { id: '1', to: 'rejected' }); ok('override: changing a decision asks for a written reason', /Change this decision to rejected/.test(pat9.modal()) && /recorded in the audit log/.test(pat9.modal()));
  pat9.setVal('ov-reason', 'short'); await pat9.act('ovgo'); ok('override: too short a reason is refused and nothing changes', w.T.hour_logs[0].status === 'approved' && /reason/i.test(pat9.toast()), pat9.toast());
  await pat9.act('ovopen', { id: '1', to: 'rejected' }); pat9.setVal('ov-reason', 'The photo does not show the event'); await pat9.act('ovgo');
  ok('override: with a reason it changes, and the screen now offers the way back', w.T.hour_logs[0].status === 'rejected' && /Change to approved/.test(pat9.text()));
  await pat9.go('pres', 'audit');
  ok('audit screen: the override is there with who did it, before and after, and the reason', /hours\.override/.test(pat9.text()) && /Pat/.test(pat9.text()) && /from: approved/.test(pat9.text()) && /to: rejected/.test(pat9.text()) && /The photo does not show the event/.test(pat9.text()), pat9.text().slice(-400));

  console.log(`\nend-to-end (presidential modules): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
