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

module.exports = router;
