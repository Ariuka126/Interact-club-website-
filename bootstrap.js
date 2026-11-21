const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');

const router = express.Router();
const BASE_COLS = 'id, user_id, event_id, hours, day, status, work_link, overtime_hours, overtime_reason, overtime_status, overtime_proof_url, flagged, created_at';

// Everything the app needs to draw its screens, scoped to who is asking.
//  - everyone: names of members, all events with their sign-ups, their own logs
//  - members and up: the club feed (recent approved posts)
//  - Sector Leads: pending hours in their sector
//  - Co-Presidents and admins: everything pending, flagged or in overtime
router.get('/bootstrap', requireAuth, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase, u = req.user;
    const staff = K.isStaff(u), lead = u.role === 'lead', memberUp = u.role !== 'volunteer';
    const seesAll = staff || lead; // may see everyone's hour totals
    const g = await K.hasGrantColumns(sb); // false until 006_hour_grants.sql has run: the app still loads, without grants
    const LOG_COLS = g ? BASE_COLS + ', grant_type, grant_reason, grant_date' : BASE_COLS;

    const [users, events, signups, approved] = await Promise.all([
      K.fetchAll(() => sb.from('users').select('id, name, role, sector, promotion_requested').order('id')),
      K.fetchAll(() => sb.from('events').select('*').order('id')),
      K.fetchAll(() => sb.from('signups').select('event_id, user_id, shift, is_volunteer').order('id')),
      K.fetchAll(() => {
        const q = sb.from('hour_logs').select('id, user_id, event_id, hours, overtime_hours, overtime_status' + (g ? ', grant_scope' : '')).eq('status', 'approved').order('id');
        return seesAll ? q : q.eq('user_id', u.id);
      }),
    ]);

    // ---- which logs to send ----
    const newest = { ascending: false };
    const queries = [sb.from('hour_logs').select(LOG_COLS).eq('user_id', u.id).order('created_at', newest).limit(200)];
    // the club feed shows members' own submissions (photo or work link), never officer grants or door check-ins
    if (memberUp) { const q = sb.from('hour_logs').select(LOG_COLS).eq('status', 'approved').eq('flagged', 0); queries.push((g ? q.is('grant_type', null) : q).order('created_at', newest).limit(60)); }
    if (staff) {
      queries.push(sb.from('hour_logs').select(LOG_COLS).eq('status', 'pending').order('created_at', newest).limit(500));
      queries.push(sb.from('hour_logs').select(LOG_COLS).eq('flagged', 1).limit(200));
      queries.push(sb.from('hour_logs').select(LOG_COLS).eq('overtime_status', 'pending').limit(200));
    } else if (lead && u.sector) {
      const ids = events.filter(e => e.sector === u.sector).map(e => e.id);
      if (ids.length) queries.push(sb.from('hour_logs').select(LOG_COLS).in('event_id', ids).eq('status', 'pending').order('created_at', newest).limit(500));
    }
    const results = await Promise.all(queries);
    const byId = new Map();
    for (const r of results) {
      if (r.error) throw r.error;
      for (const l of r.data) byId.set(l.id, l);
    }
    const logs = [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const logIds = logs.map(l => l.id);

    // photos are served by their own route, so only say which logs have one (ids, not the photos)
    const withPhoto = new Set((await K.inBatches(logIds, ids =>
      sb.from('hour_logs').select('id').in('id', ids).not('photo_data', 'is', null))).map(r => r.id));
    const feedIds = logs.filter(l => l.status === 'approved' && !l.flagged).map(l => l.id);
    const cheers = memberUp ? await K.inBatches(feedIds, ids => sb.from('log_cheers').select('log_id, user_id').in('log_id', ids)) : [];
    const comments = memberUp ? await K.inBatches(feedIds, ids => sb.from('log_comments').select('id, log_id, user_id, body, created_at').in('log_id', ids)) : [];
    comments.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

    // ---- hour totals (approved, including approved overtime) ----
    const eventType = new Map(events.map(e => [e.id, e.type]));
    const totals = K.hoursByUser(approved, eventType);
    const name = new Map(users.map(m => [m.id, m.name]));

    const signupsByEvent = new Map();
    for (const s of signups) (signupsByEvent.get(s.event_id) || signupsByEvent.set(s.event_id, []).get(s.event_id)).push(s);

    res.set('Cache-Control', 'no-store');
    res.json({
      me: { id: u.id, name: u.name, role: u.role, sector: u.sector },
      features: { grants: g },
      members: users.map(m => {
        const t = totals.get(m.id) || { in: 0, out: 0 };
        return {
          id: m.id, name: m.name, role: m.role, sector: m.sector,
          // promotion requests are visible to Co-Presidents, and to the person who made the request
          req: !!m.promotion_requested && (staff || m.id === u.id),
          in: K.round2(t.in), out: K.round2(t.out),
        };
      }),
      events: events.map(e => K.eventOut(e, signupsByEvent.get(e.id) || [])),
      logs: logs.map(l => ({
        id: l.id, uid: l.user_id, eid: l.event_id, hours: l.hours, day: l.day, status: l.status,
        link: l.work_link, hasPhoto: withPhoto.has(l.id), ts: l.created_at,
        feed: l.status === 'approved' && !l.flagged && !l.grant_type, // shown in the club feed (a flagged post stays out, without saying why)
        // officer-created hours: a President's manual grant (no event) or a QR check-in at the door
        grant: l.grant_type ? { type: l.grant_type, reason: l.user_id === u.id || staff ? l.grant_reason || null : null, date: l.grant_date || null } : null,
        ot: l.overtime_status ? {
          hrs: l.overtime_hours, status: l.overtime_status,
          reason: staff || l.user_id === u.id ? l.overtime_reason || null : null,
          proof: staff || l.user_id === u.id ? l.overtime_proof_url || null : null,
        } : null,
        flagged: staff && !!l.flagged,
        cheers: cheers.filter(c => c.log_id === l.id).map(c => c.user_id),
        comments: comments.filter(c => c.log_id === l.id).map(c => ({ n: name.get(c.user_id) || 'Member', t: c.body })),
      })),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Public impact summary for the landing page. No login. Aggregates only: no member names, no amounts per
// person, no photos. "Funds raised" is income on the treasury ledger, minus entries that were reversed.
// ---------------------------------------------------------------------------
router.get('/public/summary', async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const g = await K.hasGrantColumns(sb);
    const [users, events, approved, ledger] = await Promise.all([
      K.fetchAll(() => sb.from('users').select('id, role, sector').order('id')),
      K.fetchAll(() => sb.from('events').select('id, title, sector, type, hours, date_label, is_active, created_at').order('id')),
      K.fetchAll(() => sb.from('hour_logs').select('id, user_id, event_id, hours, overtime_hours, overtime_status' + (g ? ', grant_scope' : '')).eq('status', 'approved').order('id')),
      K.fetchAll(() => sb.from('treasury_ledger').select('id, entry_type, amount, reverses_id').order('id')),
    ]);
    const sectorOf = new Map(users.map(u => [u.id, u.sector]));
    const sectors = Object.fromEntries(K.SECTORS.map(s => [s, 0]));
    const perEvent = new Map();
    let hours = 0;
    for (const l of approved) {
      const h = K.logHours(l);
      hours += h;
      const s = sectorOf.get(l.user_id); if (K.SECTORS.includes(s)) sectors[s] += h;
      if (l.event_id != null) {
        const e = perEvent.get(l.event_id) || { hours: 0, people: new Set() };
        e.hours += h; e.people.add(l.user_id); perEvent.set(l.event_id, e);
      }
    }
    const reversed = new Set(ledger.filter(r => r.reverses_id).map(r => r.reverses_id));
    const raised = ledger.filter(r => r.entry_type === 'income' && !r.reverses_id && !reversed.has(r.id)).reduce((a, r) => a + K.cents(r.amount), 0) / 100;
    const projects = events.slice().sort((a, b) => (b.is_active - a.is_active) || (a.created_at < b.created_at ? 1 : -1)).slice(0, 6).map(e => {
      const pe = perEvent.get(e.id) || { hours: 0, people: new Set() };
      return { title: e.title, sector: e.sector, type: e.type, date: e.date_label || null, active: !!e.is_active, hours: K.round2(pe.hours), volunteers: pe.people.size };
    });
    for (const s of K.SECTORS) sectors[s] = K.round2(sectors[s]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      hours: K.round2(hours),
      members: users.filter(u => ['member', 'lead', 'pres'].includes(u.role)).length,
      activeProjects: events.filter(e => e.is_active).length,
      projects: events.length,
      fundsRaised: raised,
      sectors, recent: projects,
    });
  } catch (err) { next(err); }
});

module.exports = router;
