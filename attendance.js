const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const STATUSES = ['present', 'absent', 'excused'];
const MAX_CONSECUTIVE = 3, MAX_TOTAL = 5;       // the demotion rule from the specification
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = s => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// ---- the rule, kept pure so it can be tested on its own ----
// statuses must be in meeting order. An excused absence is neutral: it is not a miss, and it does not break a run of misses.
function tally(statuses) {
  let cumulative = 0, run = 0, maxStreak = 0;
  for (const s of statuses) {
    if (s === 'absent') { cumulative++; run++; if (run > maxStreak) maxStreak = run; }
    else if (s === 'present') run = 0;
  }
  return { cumulative, maxStreak, trailing: run };
}
function demotionReason(t) {
  if (t.maxStreak >= MAX_CONSECUTIVE) return `${MAX_CONSECUTIVE} consecutive absences`;
  if (t.cumulative >= MAX_TOTAL) return `${MAX_TOTAL} absences in total`;
  return null;
}
const atRisk = t => t.trailing >= MAX_CONSECUTIVE - 1 || t.cumulative >= MAX_TOTAL - 1;

// Misses for many members at once. Only records made after a member's last fresh start (attendance_reset_at) count.
async function countersFor(sb, users) {
  const out = new Map(users.map(u => [u.id, tally([])]));
  if (!users.length) return out;
  const logs = await K.inBatches(users.map(u => u.id), ids => sb.from('attendance_logs').select('user_id, meeting_id, status, created_at').in('user_id', ids));
  const mids = [...new Set(logs.map(l => l.meeting_id))];
  const meetings = mids.length ? await K.inBatches(mids, ids => sb.from('meetings').select('id, held_on').in('id', ids)) : [];
  const held = new Map(meetings.map(m => [m.id, m.held_on]));
  const since = new Map(users.map(u => [u.id, u.attendance_reset_at ? Date.parse(u.attendance_reset_at) : 0]));
  const per = new Map();
  for (const l of logs) {
    if (Date.parse(l.created_at) < since.get(l.user_id)) continue;
    if (!per.has(l.user_id)) per.set(l.user_id, []);
    per.get(l.user_id).push({ status: l.status, on: held.get(l.meeting_id) || '', mid: l.meeting_id });
  }
  for (const [uid, arr] of per) {
    arr.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.mid - b.mid));
    out.set(uid, tally(arr.map(x => x.status)));
  }
  return out;
}

// After a roll-call: anyone over the limit becomes a Common Volunteer, automatically, and it is written to the audit log.
async function applyDemotions(sb, users) {
  const members = users.filter(u => u.role === 'member');
  const counts = await countersFor(sb, members), done = [];
  for (const u of members) {
    const t = counts.get(u.id), reason = demotionReason(t);
    if (!reason) continue;
    const now = new Date().toISOString();
    const { data, error } = await sb.from('users').update({ role: 'volunteer', demoted_at: now, demotion_reason: reason })
      .eq('id', u.id).eq('role', 'member').select('id').maybeSingle();
    if (error) throw error;
    if (!data) continue; // somebody else changed this person first
    const rv = await sb.from('role_applications').update({ status: 'revoked', decided_at: now }).eq('user_id', u.id).in('status', ['pending', 'accepted']);
    if (rv.error) throw rv.error;
    await audit(sb, null, 'attendance.auto_demotion', 'user', u.id, { name: u.name, reason, ...t });
    done.push({ userId: u.id, name: u.name, reason });
  }
  return done;
}

const isHead = u => u && u.role === 'lead' && !!u.sector;
const gate = (req, res, next) => (K.isPres(req.user) || isHead(req.user) ? next() : bad(res, 'Roll-call is for Sector Heads and Presidents.', 403));

async function loadMeeting(sb, id) {
  const { data, error } = await sb.from('meetings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
const rosterOf = (sb, sector) => sb.from('users').select('id, name, role, sector, attendance_reset_at').eq('role', 'member').eq('sector', sector).order('name');

router.get('/meetings', requireAuth, gate, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase, u = req.user;
    const sector = K.isPres(u) ? (K.SECTORS.includes(req.query.sector) ? req.query.sector : null) : u.sector;
    let q = sb.from('meetings').select('id, sector, title, held_on, rollcall_done, rollcall_at').order('id', { ascending: false }).limit(200);
    if (sector) q = q.eq('sector', sector);
    const { data, error } = await q; if (error) throw error;
    const meetings = data.sort((a, b) => (a.held_on < b.held_on ? 1 : a.held_on > b.held_on ? -1 : b.id - a.id)).slice(0, 60);
    const logs = meetings.length ? await K.inBatches(meetings.map(m => m.id), ids => sb.from('attendance_logs').select('meeting_id, status').in('meeting_id', ids)) : [];
    res.json({ meetings: meetings.map(m => {
      const mine = logs.filter(l => l.meeting_id === m.id);
      return { ...m, present: mine.filter(l => l.status === 'present').length, absent: mine.filter(l => l.status === 'absent').length, excused: mine.filter(l => l.status === 'excused').length };
    }) });
  } catch (err) { next(err); }
});

router.post('/meetings', requireAuth, gate, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    const sector = K.isPres(u) ? b.sector : u.sector;
    if (!K.SECTORS.includes(sector)) return bad(res, 'Choose a sector.');
    if (!K.canRunSector(u, sector)) return bad(res, 'You can only run meetings for your own sector.', 403);
    const title = K.str(b.title, 2, 120); if (!title) return bad(res, 'Add a meeting title (2 to 120 characters).');
    if (!validDate(b.heldOn)) return bad(res, 'Pick the meeting date.');
    const { data, error } = await req.app.locals.supabase.from('meetings').insert({ sector, title, held_on: b.heldOn, created_by: u.id }).select('*').maybeSingle();
    if (error) throw error;
    res.status(201).json({ meeting: data });
  } catch (err) { next(err); }
});

router.get('/meetings/:id', requireAuth, gate, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id); if (!id) return bad(res, 'Invalid meeting.');
    const sb = req.app.locals.supabase;
    const m = await loadMeeting(sb, id); if (!m) return bad(res, 'Meeting not found.', 404);
    if (!K.canRunSector(req.user, m.sector)) return bad(res, 'That meeting belongs to another sector.', 403);
    const { data: roster, error } = await rosterOf(sb, m.sector); if (error) throw error;
    const { data: logs, error: lErr } = await sb.from('attendance_logs').select('user_id, status').eq('meeting_id', id); if (lErr) throw lErr;
    const counts = await countersFor(sb, roster), status = new Map(logs.map(l => [l.user_id, l.status]));
    res.json({ meeting: m, limits: { consecutive: MAX_CONSECUTIVE, total: MAX_TOTAL },
      roster: roster.map(r => ({ id: r.id, name: r.name, status: status.get(r.id) || null, ...counts.get(r.id), atRisk: atRisk(counts.get(r.id)) })) });
  } catch (err) { next(err); }
});

router.post('/meetings/:id/rollcall', requireAuth, gate, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid meeting.');
    const marks = (req.body || {}).marks;
    if (!Array.isArray(marks) || !marks.length || marks.length > 200) return bad(res, 'Send the attendance marks.');
    const sb = req.app.locals.supabase;
    const m = await loadMeeting(sb, id); if (!m) return bad(res, 'Meeting not found.', 404);
    if (!K.canRunSector(u, m.sector)) return bad(res, 'That meeting belongs to another sector.', 403);
    const override = m.rollcall_done;
    if (override && !K.isPres(u)) return bad(res, 'Roll-call was already submitted. Ask a President to correct it.', 409);

    const { data: roster, error } = await rosterOf(sb, m.sector); if (error) throw error;
    const ids = new Set(roster.map(r => r.id)), seen = new Set(), clean = [];
    for (const k of marks) {
      const uid = K.toId(k && k.userId);
      if (!uid || !STATUSES.includes(k.status)) return bad(res, 'Each mark needs a member and present, absent or excused.');
      if (!ids.has(uid)) return bad(res, "Someone you marked is not on this sector's roster.");
      if (seen.has(uid)) return bad(res, 'A member was marked twice.');
      seen.add(uid); clean.push({ userId: uid, status: k.status });
    }
    // The first roll-call must cover everyone, so nobody can be skipped to avoid an absence being counted.
    if (!override && clean.length !== roster.length) return bad(res, `Mark every member (${roster.length - clean.length} still missing).`);

    const { data: existing, error: eErr } = await sb.from('attendance_logs').select('id, user_id, status').eq('meeting_id', id); if (eErr) throw eErr;
    const before = new Map(existing.map(e => [e.user_id, e]));
    const fresh = [], changes = [];
    for (const c of clean) {
      const prev = before.get(c.userId);
      if (!prev) fresh.push({ meeting_id: id, user_id: c.userId, status: c.status, marked_by: u.id });
      else if (prev.status !== c.status) {
        const r = await sb.from('attendance_logs').update({ status: c.status, marked_by: u.id }).eq('id', prev.id);
        if (r.error) throw r.error;
        changes.push({ userId: c.userId, from: prev.status, to: c.status });
      }
    }
    if (fresh.length) { const r = await sb.from('attendance_logs').insert(fresh); if (r.error) throw r.error; }
    const done = await sb.from('meetings').update({ rollcall_done: true, rollcall_by: u.id, rollcall_at: new Date().toISOString() }).eq('id', id);
    if (done.error) throw done.error;

    const demoted = await applyDemotions(sb, roster.filter(r => seen.has(r.id)));
    const tallyOf = s => clean.filter(c => c.status === s).length;
    if (override) await audit(sb, u, 'attendance.override', 'meeting', id, { sector: m.sector, changes, added: fresh.length, demoted });
    else await audit(sb, u, 'attendance.rollcall', 'meeting', id, { sector: m.sector, present: tallyOf('present'), absent: tallyOf('absent'), excused: tallyOf('excused'), demoted });
    res.json({ saved: clean.length, override, demoted });
  } catch (err) { next(err); }
});

router.get('/attendance/summary', requireAuth, gate, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase, u = req.user;
    const sector = K.isPres(u) ? (K.SECTORS.includes(req.query.sector) ? req.query.sector : null) : u.sector;
    let mq = sb.from('users').select('id, name, role, sector, attendance_reset_at').eq('role', 'member').order('name');
    let dq = sb.from('users').select('id, name, sector, demoted_at, demotion_reason').eq('role', 'volunteer').not('demoted_at', 'is', null).order('name');
    if (sector) { mq = mq.eq('sector', sector); dq = dq.eq('sector', sector); }
    const [{ data: members, error }, { data: demoted, error: dErr }] = await Promise.all([mq, dq]);
    if (error) throw error; if (dErr) throw dErr;
    const counts = await countersFor(sb, members.filter(m => m.sector));
    res.json({ limits: { consecutive: MAX_CONSECUTIVE, total: MAX_TOTAL },
      members: members.filter(m => m.sector).map(m => ({ id: m.id, name: m.name, sector: m.sector, ...counts.get(m.id), atRisk: atRisk(counts.get(m.id)) })),
      demoted });
  } catch (err) { next(err); }
});

// A President can undo an automatic demotion. The member gets a clean slate: old absences stop counting.
router.post('/members/:id/reinstate', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!K.isPres(u)) return bad(res, 'Only a President can reinstate a member.', 403);
    if (!id) return bad(res, 'Invalid member.');
    const sb = req.app.locals.supabase;
    const { data: t, error } = await sb.from('users').select('id, name, role, demoted_at, demotion_reason').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!t) return bad(res, 'Member not found.', 404);
    if (t.role !== 'volunteer' || !t.demoted_at) return bad(res, 'That person was not demoted for absences.', 409);
    const note = K.str((req.body || {}).note || '', 0, 200) || '';
    const { data, error: uErr } = await sb.from('users').update({ role: 'member', demoted_at: null, demotion_reason: null, attendance_reset_at: new Date().toISOString(), promotion_requested: 0 })
      .eq('id', id).eq('role', 'volunteer').select('id').maybeSingle();
    if (uErr) throw uErr;
    if (!data) return bad(res, 'Someone else already changed this person.', 409);
    await audit(sb, u, 'member.reinstate', 'user', id, { name: t.name, was: t.demotion_reason, note });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.tally = tally;
module.exports.demotionReason = demotionReason;
module.exports.MAX_CONSECUTIVE = MAX_CONSECUTIVE;
module.exports.MAX_TOTAL = MAX_TOTAL;
