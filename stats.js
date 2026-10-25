const express = require('express');
const { requireAuth } = require('./middleware');
const { fetchAll, logHours } = require('./lib');

const router = express.Router();
const SECTORS = ['Creative', 'Events', 'Finance', 'Community'];
// Keep in sync with lvl() in public/index.html: L1 < 10 h, L2 < 25 h, L3 < 50 h, L4 50+ h.
const levelOf = h => (h < 10 ? 0 : h < 25 ? 1 : h < 50 ? 2 : 3);
const round2 = n => Math.round(n * 100) / 100;

// Row counts are done by the database (head request, no rows transferred).
async function count(query) {
  const { count: n, error } = await query;
  if (error) throw error;
  return n || 0;
}

// Live club-wide numbers for the dashboard. Any logged-in user may read them.
// Only aggregates are returned: no names, emails or individual hour entries.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const head = { count: 'exact', head: true };

    const [activeMembers, keeplist, pendingApprovals, flaggedEntries, activeEvents, users, approved] =
      await Promise.all([
        count(sb.from('users').select('id', head)),
        count(sb.from('users').select('id', head).eq('role', 'volunteer')),
        count(sb.from('hour_logs').select('id', head).eq('status', 'pending')),
        count(sb.from('hour_logs').select('id', head).eq('status', 'pending').eq('flagged', 1)),
        count(sb.from('events').select('id', head).eq('is_active', 1)),
        fetchAll(() => sb.from('users').select('id, role, sector').order('id')),
        fetchAll(() => sb.from('hour_logs').select('id, user_id, hours, overtime_hours, overtime_status').eq('status', 'approved').order('id')),
      ]);

    let totalHours = 0;
    const hoursByUser = new Map();
    for (const l of approved) {
      const h = logHours(l); // event hours plus any approved overtime
      totalHours += h;
      hoursByUser.set(l.user_id, (hoursByUser.get(l.user_id) || 0) + h);
    }

    // Sector totals follow the member's sector (users.sector). People without a sector
    // still count toward totalHours but not toward any sector.
    const sectors = Object.fromEntries(SECTORS.map(s => [s, 0]));
    const levels = [0, 0, 0, 0];
    for (const u of users) {
      const h = hoursByUser.get(u.id) || 0;
      if (SECTORS.includes(u.sector)) sectors[u.sector] += h;
      if (['member', 'lead', 'pres'].includes(u.role)) levels[levelOf(h)] += 1;
    }
    for (const s of SECTORS) sectors[s] = round2(sectors[s]);

    res.set('Cache-Control', 'no-store'); // always fresh
    res.json({
      totalHours: round2(totalHours),
      activeMembers,
      keeplist,
      pendingApprovals,
      flaggedEntries,
      activeEvents,
      sectors,
      levels,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
