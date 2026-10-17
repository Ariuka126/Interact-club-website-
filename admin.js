const express = require('express');
const { requireAuth, requireAdmin } = require('./middleware');

const router = express.Router();
const ROLES = ['volunteer', 'member', 'lead', 'pres', 'admin'];
const ALIASES = { president: 'pres', 'co-president': 'pres', 'sector lead': 'lead' };
const SECTORS = ['Creative', 'Events', 'Finance', 'Community'];
const COLUMNS = 'id, name, email, role, sector, created_at'; // never select password_hash here

// Every route below needs a logged-in admin.
router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res, next) => {
  try {
    const { data, error } = await req.app.locals.supabase
      .from('users')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    res.json({ users: data });
  } catch (err) {
    next(err);
  }
});

router.post('/update-role', async (req, res, next) => {
  try {
    const targetId = Number(req.body.targetUserId);
    if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Invalid user.' });

    const raw = String(req.body.newRole || '').trim().toLowerCase();
    const newRole = ALIASES[raw] || raw;
    if (!ROLES.includes(newRole)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}.` });

    // Blocking self-changes also guarantees there is always at least one admin:
    // the person making this request is one and cannot remove themselves.
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });

    const supabase = req.app.locals.supabase;
    const { data: target, error: findErr } = await supabase
      .from('users').select('id, email, role, sector').eq('id', targetId).maybeSingle();
    if (findErr) throw findErr;
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const update = { role: newRole };
    if (newRole === 'lead') {
      // The Sector Lead view is empty without a sector, so require one.
      const sector = req.body.sector || target.sector;
      if (!SECTORS.includes(sector)) return res.status(400).json({ error: 'Choose a sector for a Sector Lead.' });
      update.sector = sector;
    }

    const { data: user, error } = await supabase
      .from('users').update(update).eq('id', targetId).select(COLUMNS).maybeSingle();
    if (error) throw error;
    if (!user) return res.status(404).json({ error: 'User not found.' });

    console.log(`[admin] ${req.user.email} changed ${target.email}: ${target.role} -> ${newRole}`);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Hour approvals
// ---------------------------------------------------------------------------
const toId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// All submissions waiting for review, oldest first, with the volunteer and event attached.
// Joined in code (three small queries) so it does not depend on PostgREST embed hints,
// which are ambiguous here because hour_logs references users twice (user_id, reviewed_by).
router.get('/pending-hours', async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const { data: logs, error } = await sb
      .from('hour_logs')
      .select('id, user_id, event_id, hours, day, work_link, flagged, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    if (!logs.length) return res.json({ logs: [] });

    const userIds = [...new Set(logs.map(l => l.user_id))];
    const eventIds = [...new Set(logs.map(l => l.event_id))];
    const logIds = logs.map(l => l.id);

    const [users, events, photos] = await Promise.all([
      sb.from('users').select('id, name, email').in('id', userIds),
      sb.from('events').select('id, title').in('id', eventIds),
      // ids only: tells the UI which logs have a photo without sending the (large) photos themselves
      sb.from('hour_logs').select('id').in('id', logIds).not('photo_data', 'is', null),
    ]);
    for (const r of [users, events, photos]) if (r.error) throw r.error;

    const userMap = new Map(users.data.map(u => [u.id, u]));
    const eventMap = new Map(events.data.map(e => [e.id, e]));
    const hasPhoto = new Set(photos.data.map(p => p.id));

    res.json({
      logs: logs.map(l => ({
        id: l.id,
        hours: l.hours,
        day: l.day,
        work_link: l.work_link,
        flagged: !!l.flagged,
        created_at: l.created_at,
        has_photo: hasPhoto.has(l.id),
        user: userMap.get(l.user_id) || null,
        event: eventMap.get(l.event_id) || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The proof photo for one log, loaded only when the admin clicks "View photo".
router.get('/hour-photo/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid log.' });
    const { data, error } = await req.app.locals.supabase
      .from('hour_logs').select('photo_data').eq('id', id).maybeSingle();
    if (error) throw error;
    // Only ever hand back real image data URLs.
    if (!data || !/^data:image\/(png|jpe?g|webp);base64,/.test(data.photo_data || '')) {
      return res.status(404).json({ error: 'No photo for this entry.' });
    }
    res.json({ photo: data.photo_data });
  } catch (err) {
    next(err);
  }
});

router.post('/review-hour', async (req, res, next) => {
  try {
    const logId = toId(req.body.logId);
    if (!logId) return res.status(400).json({ error: 'Invalid log.' });
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'." });
    }

    const sb = req.app.locals.supabase;
    const { data: log, error: findErr } = await sb
      .from('hour_logs').select('id, user_id, status').eq('id', logId).maybeSingle();
    if (findErr) throw findErr;
    if (!log) return res.status(404).json({ error: 'Entry not found.' });
    if (log.user_id === req.user.id) return res.status(403).json({ error: 'You cannot review your own hours.' });
    if (log.status !== 'pending') return res.status(409).json({ error: `Already ${log.status}.` });

    // The extra status filter makes this atomic: if two reviewers click at once, only one update matches.
    const { data: updated, error } = await sb
      .from('hour_logs')
      .update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
      .eq('id', logId)
      .eq('status', 'pending')
      .select('id, status, reviewed_by, reviewed_at')
      .maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(409).json({ error: 'Someone else already reviewed this entry.' });

    console.log(`[admin] ${req.user.email} ${status} hour log #${logId}`);
    res.json({ log: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
