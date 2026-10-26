// Presidential specification: permissions, treasury, attendance, roles, proposals, checklists, feedback, vault, audit.
// Run: node tests/spec.js   (no install needed)
const { loadApp, makeDb } = require('./harness');
process.env.SESSION_SECRET = 'test-secret';
process.env.FEEDBACK_KEY = 'a'.repeat(40) + 'KEY-for-tests-only';
let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : (d === undefined ? '' : JSON.stringify(d).slice(0, 320))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const U = (id, role, sector = null, name = role + id) => ({ id, name, email: name.replace(/\W/g, '').toLowerCase() + '@x.com', role, sector, password_hash: 'x', promotion_requested: 0,
  demoted_at: null, demotion_reason: null, attendance_reset_at: null, created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z` });
const admin = U(1, 'admin', null, 'Ann'), pres = U(2, 'pres', null, 'Pat'), pres2 = U(10, 'pres', null, 'Pia'),
  eHead = U(3, 'lead', 'Events', 'Eli'), fHead = U(7, 'lead', 'Finance', 'Fay'), cHead = U(11, 'lead', 'Community', 'Cam'), rHead = U(12, 'lead', 'Creative', 'Rae'),
  mia = U(4, 'member', 'Events', 'Mia'), max = U(5, 'member', 'Events', 'Max'), nia = U(13, 'member', 'Events', 'Nia'), zed = U(14, 'member', 'Creative', 'Zed'),
  vic = U(6, 'volunteer', null, 'Vic');
const ALL = [admin, pres, pres2, eHead, fHead, cHead, rHead, mia, max, nia, zed, vic];
const world = (extra = {}) => { const a = loadApp({ users: ALL.map(u => ({ ...u })), events: [], signups: [], hour_logs: [], ...extra }); a.row = id => a.T.users.find(u => u.id === id); a.as = id => { const r = a.row(id); return { id: r.id, name: r.name, email: r.email, role: r.role, sector: r.sector }; }; return a; };
const ok = r => r.code >= 200 && r.code < 300;

(async () => {
  /* ===================== TREASURY ===================== */
  let w = world(), { call, T } = w;
  const tr = (who, method, path, body) => call(method, '/api/treasury' + path, { user: who == null ? null : w.as(who), body });
  t('treasury: anonymous 401', (await tr(null, 'GET', '')).code === 401);
  for (const [who, n] of [[4, 'a member'], [3, 'the Events head'], [11, 'the Community head'], [6, 'a volunteer'], [1, 'an admin account']])
    t(`treasury: ${n} cannot see it (403)`, (await tr(who, 'GET', '')).code === 403 && (await tr(who, 'POST', '', { type: 'income', amount: 5, category: 'x', description: 'y' })).code === 403);
  t('treasury: a refusal reveals no balance', !/balance/.test(JSON.stringify((await tr(4, 'GET', '')).json)));
  let r = await tr(7, 'GET', '');
  t('treasury: Finance head sees an empty ledger with a zero balance', r.code === 200 && r.json.balance === 0 && r.json.entries.length === 0 && r.json.integrity.ok === true, r.json);
  t('treasury: presidents can too', (await tr(2, 'GET', '')).code === 200 && (await tr(10, 'GET', '')).code === 200);
  r = await tr(7, 'POST', '', { type: 'income', amount: 100.5, category: 'Bake sale', description: 'Saturday stall' });
  t('treasury: Finance head adds income; entry numbered 1; balance 100.50', r.code === 201 && r.json.entry.seq === 1 && r.json.balance === 100.5 && r.json.entry.created_by_name === 'Fay', r.json);
  r = await tr(2, 'POST', '', { type: 'expense', amount: 40, category: 'Supplies', description: 'Posters', reference: 'drive.google.com/receipt1' });
  t('treasury: president adds expense; receipt link normalised; balance 60.50', r.code === 201 && r.json.balance === 60.5 && r.json.entry.reference_url === 'https://drive.google.com/receipt1', r.json);
  r = await tr(7, 'POST', '', { type: 'expense', amount: 100, category: 'Trip', description: 'Too much' });
  t('treasury: overspending is refused and nothing is written', r.code === 409 && /Not enough money/.test(r.json.error) && T.treasury_ledger.length === 2, r.json);
  for (const [n, p] of [['zero', { amount: 0 }], ['negative', { amount: -5 }], ['text', { amount: 'abc' }], ['3 decimals', { amount: 1.005 }], ['over a million', { amount: 1000000.01 }], ['bad type', { type: 'gift' }], ['no category', { category: '' }], ['no description', { description: '  ' }], ['receipt that is not a web address', { reference: 'javascript:alert(1)' }]])
    t(`treasury: rejects ${n}`, (await tr(7, 'POST', '', { type: 'income', amount: 5, category: 'c', description: 'd', ...p })).code === 400);
  t('treasury: the 9 refusals wrote nothing', T.treasury_ledger.length === 2);
  w = world(); ({ call, T } = w);
  await tr(7, 'POST', '', { type: 'income', amount: 0.1, category: 'c', description: 'd' }); await tr(7, 'POST', '', { type: 'income', amount: 0.2, category: 'c', description: 'd' });
  t('treasury: money is summed in cents (0.10 + 0.20 is exactly 0.30)', (await tr(7, 'GET', '')).json.balance === 0.3);
  const [a1, a2] = await Promise.all([tr(7, 'POST', '', { type: 'income', amount: 10, category: 'c', description: 'one' }), tr(2, 'POST', '', { type: 'income', amount: 20, category: 'c', description: 'two' })]);
  r = await tr(7, 'GET', '');
  t('treasury: two people writing at once both succeed, with distinct numbers, and the total is right', ok(a1) && ok(a2) && new Set(T.treasury_ledger.map(e => e.seq)).size === 4 && r.json.balance === 30.3 && r.json.integrity.ok, [a1.code, a2.code, T.treasury_ledger.map(e => e.seq)]);
  t('treasury: the ledger lists newest first', r.json.entries[0].seq === 4 && r.json.entries.at(-1).seq === 1);
  const sb = makeDb(T);
  t('treasury: the database refuses to edit or delete a ledger row (stand-in for the trigger)', (await sb.from('treasury_ledger').update({ amount: 999 }).eq('id', 1)).error.code === '42501' && (await sb.from('treasury_ledger').delete().eq('id', 1)).error.code === '42501');
  const keep = T.treasury_ledger[0].balance_after; T.treasury_ledger[0].balance_after = 99;   // someone tampers with the database directly
  r = await tr(7, 'GET', ''); t('treasury: a tampered running total is detected and the true balance is still shown', r.json.integrity.ok === false && r.json.integrity.badSeq === 1 && r.json.balance === 30.3, r.json.integrity); T.treasury_ledger[0].balance_after = keep;
  // reversals
  const inc = T.treasury_ledger.find(e => e.amount === 20);
  r = await tr(7, 'POST', `/${inc.id}/reverse`, { reason: 'Entered twice' });
  t('treasury: a reversal is a new opposite entry that points at the old one', r.code === 201 && r.json.entry.entry_type === 'expense' && r.json.entry.amount === 20 && r.json.entry.reverses_id === inc.id && r.json.balance === 10.3 && new RegExp('Reversal of #' + inc.seq + ':').test(r.json.entry.description), r.json);
  t('treasury: the old entry is untouched', T.treasury_ledger.find(e => e.id === inc.id).amount === 20);
  t('treasury: reversing twice -> 409', (await tr(7, 'POST', `/${inc.id}/reverse`, { reason: 'again please' })).code === 409);
  t('treasury: a reversal cannot be reversed -> 409', (await tr(2, 'POST', `/${r.json.entry.id}/reverse`, { reason: 'undo the undo' })).code === 409);
  const big = (await tr(2, 'POST', '', { type: 'income', amount: 500, category: 'Grant', description: 'Rotary grant' })).json.entry;
  await tr(2, 'POST', '', { type: 'expense', amount: 505, category: 'Trip', description: 'Bus hire' });
  t('treasury: a reversal that would overdraw is refused', (await tr(2, 'POST', `/${big.id}/reverse`, { reason: 'wrong club' })).code === 409);
  t('treasury: reversal needs a reason; unknown entry is 404; bad id is 400', (await tr(2, 'POST', `/${inc.id}/reverse`, { reason: 'x' })).code === 400 && (await tr(2, 'POST', '/999/reverse', { reason: 'no such entry' })).code === 404 && (await tr(2, 'POST', '/abc/reverse', { reason: 'bad id here' })).code === 400);
  // audit
  const acts = T.audit_logs.map(a => a.action);
  t('audit: every treasury write was recorded with who did it', acts.includes('treasury.income') && acts.includes('treasury.expense') && acts.includes('treasury.reverse') && T.audit_logs.find(a => a.action === 'treasury.reverse').actor_name === 'Fay' && T.audit_logs[0].details.amount !== undefined);
  t('audit: nothing was written for refused attempts', T.audit_logs.filter(a => a.action.startsWith('treasury.')).length === T.treasury_ledger.length);
  const au = (who, q) => call('GET', '/api/audit', { user: w.as(who), query: q });
  t('audit: only Presidents may read the log', (await au(2)).code === 200 && (await au(10)).code === 200 && (await au(7)).code === 403 && (await au(3)).code === 403 && (await au(4)).code === 403 && (await au(1)).code === 403 && (await call('GET', '/api/audit', {})).code === 401);
  r = await au(2); t('audit: newest first, with actor, action and details', r.json.entries[0].id > r.json.entries.at(-1).id && !!r.json.entries[0].actor_name && typeof r.json.entries[0].details === 'object');
  t('audit: filter by action and by entity', (await au(2, { action: 'treasury.reverse' })).json.entries.every(e => e.action === 'treasury.reverse') && (await au(2, { entity: 'treasury' })).json.entries.length === T.audit_logs.length);
  const mid = r.json.entries[2].id; t('audit: paging with a "before" cursor', (await au(2, { before: mid, limit: 2 })).json.entries.every(e => e.id < mid));
  t('audit: the log cannot be edited or deleted (stand-in for the trigger)', (await sb.from('audit_logs').update({ action: 'x' }).eq('id', 1)).error.code === '42501' && (await sb.from('audit_logs').delete().eq('id', 1)).error.code === '42501');

  /* ===================== ATTENDANCE AND DEMOTION ===================== */
  const A = require('../attendance');
  const T3 = A.tally, why = A.demotionReason;
  t('rule: no records, no misses', JSON.stringify(T3([])) === '{"cumulative":0,"maxStreak":0,"trailing":0}');
  t('rule: 3 absences in a row demote', why(T3(['absent', 'absent', 'absent'])) === '3 consecutive absences');
  t('rule: 2 in a row do not', why(T3(['absent', 'absent'])) === null);
  t('rule: a present breaks a run (2 + present + 2 is not 3 in a row)', why(T3(['absent', 'absent', 'present', 'absent', 'absent'])) === null && T3(['absent', 'absent', 'present', 'absent', 'absent']).cumulative === 4);
  t('rule: 5 in total demote even if never 3 in a row', why(T3(['absent', 'absent', 'present', 'absent', 'absent', 'present', 'absent'])) === '5 absences in total');
  t('rule: 4 in total do not', why(T3(['absent', 'present', 'absent', 'present', 'absent', 'present', 'absent'])) === null);
  t('rule: an excused absence is neutral (not a miss, does not break a run)', why(T3(['absent', 'absent', 'excused', 'absent'])) === '3 consecutive absences' && why(T3(['excused', 'excused', 'excused', 'excused', 'excused'])) === null);
  t('rule: the 3-in-a-row reason wins when both limits are hit', why(T3(['absent', 'absent', 'absent', 'absent', 'absent'])) === '3 consecutive absences');

  w = world(); ({ call, T } = w);
  const mt = (who, method, path, body, query) => call(method, '/api' + path, { user: who == null ? null : w.as(who), body, query });
  for (const [who, n] of [[4, 'a member'], [6, 'a volunteer'], [1, 'an admin account']]) t(`roll-call: ${n} cannot open meetings`, (await mt(who, 'GET', '/meetings')).code === 403 && (await mt(who, 'POST', '/meetings', { title: 'Weekly', heldOn: '2026-03-01' })).code === 403);
  r = await mt(3, 'POST', '/meetings', { sector: 'Finance', title: 'Events weekly', heldOn: '2026-03-01' });
  t('roll-call: a head can only run their own sector (the sector in the request is ignored)', r.code === 201 && r.json.meeting.sector === 'Events');
  t('roll-call: bad title and bad dates are refused', (await mt(3, 'POST', '/meetings', { title: 'x', heldOn: '2026-03-01' })).code === 400 && (await mt(3, 'POST', '/meetings', { title: 'Weekly', heldOn: '2026-02-31' })).code === 400 && (await mt(3, 'POST', '/meetings', { title: 'Weekly', heldOn: 'tomorrow' })).code === 400);
  t('roll-call: another sector\'s head cannot see or run it', (await mt(7, 'GET', `/meetings/${r.json.meeting.id}`)).code === 403 && (await mt(7, 'POST', `/meetings/${r.json.meeting.id}/rollcall`, { marks: [{ userId: 4, status: 'present' }] })).code === 403);
  t('roll-call: a president must name a sector, and can pick any', (await mt(2, 'POST', '/meetings', { title: 'Weekly', heldOn: '2026-03-01' })).code === 400 && (await mt(2, 'POST', '/meetings', { sector: 'Creative', title: 'Creative weekly', heldOn: '2026-03-01' })).code === 201);
  t('roll-call: heads see only their sector\'s meetings, presidents all', (await mt(3, 'GET', '/meetings')).json.meetings.every(m => m.sector === 'Events') && (await mt(2, 'GET', '/meetings')).json.meetings.length === 2 && (await mt(2, 'GET', '/meetings', null, { sector: 'Creative' })).json.meetings.length === 1);
  const m1 = r.json.meeting.id;
  r = await mt(3, 'GET', `/meetings/${m1}`);
  t('roll-call: the roster is that sector\'s members only (no heads, volunteers or other sectors)', r.json.roster.map(x => x.id).sort((a, b) => a - b).join() === '4,5,13', r.json.roster);
  const marks = s => [{ userId: 4, status: s[0] }, { userId: 5, status: s[1] }, { userId: 13, status: s[2] }];
  t('roll-call: everyone must be marked the first time', (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: marks(['present', 'present', 'present']).slice(0, 2) })).code === 400);
  t('roll-call: bad status, stranger, duplicate and empty are refused', (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: marks(['late', 'present', 'present']) })).code === 400
    && (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: [...marks(['present', 'present', 'present']), { userId: 14, status: 'present' }] })).code === 400
    && (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: [{ userId: 4, status: 'present' }, { userId: 4, status: 'absent' }, { userId: 5, status: 'present' }] })).code === 400
    && (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: [] })).code === 400 && T.attendance_logs.length === 0);
  r = await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: marks(['absent', 'present', 'excused']) });
  t('roll-call: saved; nobody demoted by one absence', r.code === 200 && r.json.saved === 3 && r.json.demoted.length === 0 && T.attendance_logs.length === 3 && T.meetings[0].rollcall_done === true);
  t('roll-call: a second submission by the head is refused (needs a president)', (await mt(3, 'POST', `/meetings/${m1}/rollcall`, { marks: marks(['present', 'present', 'present']) })).code === 409);
  r = await mt(2, 'POST', `/meetings/${m1}/rollcall`, { marks: [{ userId: 4, status: 'excused' }] });
  t('roll-call: a president can correct it, and the correction is audited with before and after', r.code === 200 && r.json.override && T.attendance_logs.find(l => l.user_id === 4).status === 'excused' && T.audit_logs.at(-1).action === 'attendance.override' && T.audit_logs.at(-1).details.changes[0].from === 'absent' && T.audit_logs.at(-1).actor_name === 'Pat');
  t('roll-call: the first roll-call was audited too', T.audit_logs.some(a => a.action === 'attendance.rollcall' && a.details.absent === 1));
  // Mia: three in a row -> demoted
  w = world(); ({ call, T } = w);
  // st = what to mark Mia (4), Max (5) and Nia (13). Only people still on the roster are marked, as the real screen does.
  let n = 0; const meet = async (date, st, who = 3) => {
    const m = (await mt(who, 'POST', '/meetings', { title: 'Weekly ' + (++n), heldOn: date })).json.meeting;
    const roster = (await mt(who, 'GET', `/meetings/${m.id}`)).json.roster, by = { 4: st[0], 5: st[1], 13: st[2] };
    return mt(who, 'POST', `/meetings/${m.id}/rollcall`, { marks: roster.map(x => ({ userId: x.id, status: by[x.id] })) });
  };
  T.sector_roles.push({ id: 1, sector: 'Events', title: 'Stage crew', description: '', capacity: 3, is_open: true });
  T.role_applications.push({ id: 1, role_id: 1, user_id: 4, status: 'accepted' }, { id: 2, role_id: 1, user_id: 13, status: 'pending' });
  await meet('2026-03-01', ['absent', 'present', 'present']); await meet('2026-03-08', ['absent', 'present', 'present']);
  t('demotion: two misses in a row is not enough', w.row(4).role === 'member');
  r = await meet('2026-03-15', ['absent', 'present', 'present']);
  t('demotion: the third consecutive absence demotes to Common Volunteer, automatically', r.json.demoted.length === 1 && r.json.demoted[0].userId === 4 && r.json.demoted[0].reason === '3 consecutive absences' && w.row(4).role === 'volunteer' && !!w.row(4).demoted_at && w.row(4).demotion_reason === '3 consecutive absences', [r.json, w.row(4)]);
  t('demotion: their sector role is withdrawn, others\' applications are untouched', T.role_applications.find(a => a.id === 1).status === 'revoked' && T.role_applications.find(a => a.id === 2).status === 'pending');
  const ad = T.audit_logs.find(a => a.action === 'attendance.auto_demotion');
  t('demotion: audited as done by the System', ad && ad.actor_name === 'System' && ad.actor_id === null && ad.details.reason === '3 consecutive absences' && ad.entity_id === '4', ad);
  t('demotion: the others on the roll are unaffected', w.row(5).role === 'member' && w.row(13).role === 'member');
  r = await mt(3, 'GET', `/meetings/${(await mt(3, 'POST', '/meetings', { title: 'Next', heldOn: '2026-03-22' })).json.meeting.id}`);
  t('demotion: a demoted member leaves the roster', r.json.roster.map(x => x.id).sort((a, b) => a - b).join() === '5,13');
  // Max: 5 in total, never 3 in a row
  for (const [d, s] of [['2026-04-01', 'absent'], ['2026-04-08', 'absent'], ['2026-04-15', 'present'], ['2026-04-22', 'absent'], ['2026-04-29', 'absent'], ['2026-05-06', 'present']]) await meet(d, ['present', s, 'present'].map(x => x));
  t('demotion: four misses with presents between is still fine', w.row(5).role === 'member');
  r = await meet('2026-05-13', ['present', 'absent', 'present']);
  t('demotion: the fifth miss in total demotes', r.json.demoted.some(x => x.userId === 5 && x.reason === '5 absences in total') && w.row(5).role === 'volunteer', r.json);
  // excused never counts
  for (const d of ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']) await meet(d, ['present', 'present', 'excused']);
  t('demotion: five excused absences never demote', w.row(13).role === 'member');
  // summary + reinstate
  r = await mt(2, 'GET', '/attendance/summary');
  t('summary: presidents see at-risk members and the demoted list with reasons', r.json.demoted.map(d => d.id).sort().join() === '4,5' && r.json.demoted.find(d => d.id === 4).demotion_reason === '3 consecutive absences' && r.json.limits.consecutive === 3 && r.json.limits.total === 5, r.json);
  t('summary: heads see only their sector; members and volunteers see nothing', (await mt(7, 'GET', '/attendance/summary')).json.demoted.length === 0 && (await mt(3, 'GET', '/attendance/summary')).json.demoted.length === 2 && (await mt(4, 'GET', '/attendance/summary')).code === 403 && (await mt(6, 'GET', '/attendance/summary')).code === 403);
  t('reinstate: only a president; a head cannot', (await mt(3, 'POST', '/members/4/reinstate', {})).code === 403 && (await mt(4, 'POST', '/members/4/reinstate', {})).code === 403 && (await mt(1, 'POST', '/members/4/reinstate', {})).code === 403);
  t('reinstate: someone who was never demoted -> 409; unknown -> 404', (await mt(2, 'POST', '/members/13/reinstate', {})).code === 409 && (await mt(2, 'POST', '/members/6/reinstate', {})).code === 409 && (await mt(2, 'POST', '/members/999/reinstate', {})).code === 404);
  await sleep(8);
  r = await mt(2, 'POST', '/members/4/reinstate', { note: 'Had exams' });
  t('reinstate: a president restores them; audited with the old reason', r.code === 200 && w.row(4).role === 'member' && w.row(4).demoted_at === null && !!w.row(4).attendance_reset_at && T.audit_logs.at(-1).action === 'member.reinstate' && T.audit_logs.at(-1).details.was === '3 consecutive absences');
  await sleep(8);
  await meet('2026-07-01', ['absent', 'present', 'present']); await meet('2026-07-08', ['absent', 'present', 'present']);
  t('reinstate: a fresh start, the old absences no longer count (2 new misses do not demote)', w.row(4).role === 'member');
  r = await meet('2026-07-15', ['absent', 'present', 'present']);
  t('reinstate: but three new ones in a row demote again', w.row(4).role === 'volunteer' && r.json.demoted[0].userId === 4);

  console.log(`\nspec (treasury + attendance): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
