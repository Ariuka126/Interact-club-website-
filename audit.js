const express = require('express');
const { requireAuth, requireRole } = require('./middleware');
const K = require('./lib');

const router = express.Router();

// Record who did what. The table is append-only in the database, so an entry can never be edited or removed.
// actor = null means the system itself acted (for example the automatic demotion).
// If the entry cannot be written this throws: an unrecorded action is better reported than hidden.
async function audit(sb, actor, action, entityType, entityId, details = {}) {
  const { error } = await sb.from('audit_logs').insert({
    actor_id: actor ? actor.id : null,
    actor_name: actor ? actor.name : 'System',
    actor_role: actor ? actor.role : 'system',
    action, entity_type: entityType, entity_id: entityId == null ? null : String(entityId), details,
  });
  if (error) { console.error('[audit] could not record', action, error.message); throw error; }
}

// Only Presidents read the audit log.
router.get('/audit', requireAuth, requireRole('pres'), async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    let q = sb.from('audit_logs').select('id, actor_id, actor_name, actor_role, action, entity_type, entity_id, details, created_at');
    if (typeof req.query.entity === 'string' && req.query.entity) q = q.eq('entity_type', req.query.entity);
    if (typeof req.query.action === 'string' && req.query.action) q = q.eq('action', req.query.action);
    const before = K.toId(req.query.before);
    if (before) q = q.lt('id', before);
    const { data, error } = await q.order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ entries: data, more: data.length === limit });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.audit = audit;
