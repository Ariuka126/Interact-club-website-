const express = require('express');
const { requireAuth, requireRole } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// A volunteer asks the Co-Presidents to move them to Active.
router.post('/me/request-promotion', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'volunteer') return bad(res, 'Only volunteers on the keeplist need to ask.', 403);
    const { error } = await req.app.locals.supabase.from('users').update({ promotion_requested: 1 }).eq('id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Co-Presidents move a volunteer up to member. (All other role changes stay with admins.)
router.post('/roster/promote', requireAuth, requireRole('pres', 'admin'), async (req, res, next) => {
  try {
    const id = K.toId((req.body || {}).userId);
    if (!id) return bad(res, 'Invalid member.');
    const sb = req.app.locals.supabase;
    const { data: target, error: fErr } = await sb.from('users').select('id, email, role').eq('id', id).maybeSingle();
    if (fErr) throw fErr;
    if (!target) return bad(res, 'Member not found.', 404);
    if (target.role !== 'volunteer') return bad(res, 'That person is already a member.', 409);
    const now = new Date().toISOString();
    const { error } = await sb.from('users').update({ role: 'member', promotion_requested: 0, demoted_at: null, demotion_reason: null, attendance_reset_at: now }).eq('id', id).eq('role', 'volunteer');
    if (error) throw error;
    // their standby slots do not carry over: as a member they sign up for events normally
    const del = await sb.from('signups').delete().eq('user_id', id).eq('is_volunteer', 1);
    if (del.error) throw del.error;
    await audit(sb, req.user, 'member.promote', 'user', id, { name: target.email });
    console.log(`[roster] ${req.user.email} promoted ${target.email} to member`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Certificate data: yourself, or anyone if you are a Co-President / admin
// ---------------------------------------------------------------------------
router.get('/certificate/:id', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid member.');
    if (id !== u.id && !K.isStaff(u)) return bad(res, 'You can only open your own certificate.', 403);
    const sb = req.app.locals.supabase;
    const { data: m, error } = await sb.from('users').select('id, name, role, sector').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!m) return bad(res, 'Member not found.', 404);

    const [logs, events, signers] = await Promise.all([
      K.fetchAll(() => sb.from('hour_logs').select('id, event_id, hours, overtime_hours, overtime_status, created_at').eq('user_id', id).eq('status', 'approved').order('id')),
      K.fetchAll(() => sb.from('events').select('id, title, type').order('id')),
      sb.from('users').select('name').eq('role', 'pres').order('id').limit(2),
    ]);
    if (signers.error) throw signers.error;
    const ev = new Map(events.map(e => [e.id, e]));
    const t = K.hoursByUser(logs.map(l => ({ ...l, user_id: id })), new Map(events.map(e => [e.id, e.type]))).get(id) || { in: 0, out: 0 };
    const projects = [];
    for (const l of [...logs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
      const title = ev.get(l.event_id) && ev.get(l.event_id).title;
      if (title && !projects.includes(title)) projects.push(title);
      if (projects.length === 4) break;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ name: m.name, role: m.role, sector: m.sector, in: K.round2(t.in), out: K.round2(t.out), projects, signers: signers.data.map(s => s.name) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Rotary report: CSV of members and verified hours
// ---------------------------------------------------------------------------
const csvCell = v => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets from running a name as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const STATUS_OF = { volunteer: 'keep', member: 'active', pres: 'active', lead: 'lead' };

router.get('/export', requireAuth, requireRole('pres', 'admin'), async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const sector = K.SECTORS.includes(req.query.sector) ? req.query.sector : 'all';
    const status = ['active', 'lead', 'keep'].includes(req.query.status) ? req.query.status : 'all';

    const [users, events, approved] = await Promise.all([
      K.fetchAll(() => sb.from('users').select('id, name, role, sector').order('id')),
      K.fetchAll(() => sb.from('events').select('id, type').order('id')),
      K.fetchAll(() => sb.from('hour_logs').select('id, user_id, event_id, hours, overtime_hours, overtime_status').eq('status', 'approved').order('id')),
    ]);
    const totals = K.hoursByUser(approved, new Map(events.map(e => [e.id, e.type])));

    const rows = users
      .filter(m => m.role !== 'admin') // admin accounts are not club members
      .filter(m => (sector === 'all' || m.sector === sector) && (status === 'all' || STATUS_OF[m.role] === status))
      .map(m => {
        const t = totals.get(m.id) || { in: 0, out: 0 }, total = t.in + t.out;
        return [m.id, m.name, STATUS_OF[m.role], m.sector || '', K.round2(t.in), K.round2(t.out), K.round2(total), 'L' + (K.lvl(total) + 1)];
      });
    const csv = [['id', 'name', 'status', 'sector', 'in_school_hrs', 'out_of_school_hrs', 'total_hrs', 'level'], ...rows]
      .map(r => r.map(csvCell).join(',')).join('\n');

    res.set('Cache-Control', 'no-store');
    if (req.query.download) res.set('Content-Disposition', `attachment; filename="interact-hours-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.type('text/csv').send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
