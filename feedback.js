const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const CATEGORIES = ['uncredited_hours', 'structural_change', 'admin_issue'];

// ---- encryption at rest (AES-256-GCM). The key lives in the server's environment, never in the database. ----
function keyBytes() {
  const k = process.env.FEEDBACK_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  if (k.length >= 32) return crypto.createHash('sha256').update(k).digest();
  return null;
}
function encrypt(text, key = keyBytes()) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(blob, key = keyBytes()) {
  const raw = Buffer.from(blob, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

// Anonymity: the limit is counted per person in memory only. Nothing about who sent a message is ever stored with it.
const sendLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, limit: 5, standardHeaders: false, legacyHeaders: false,
  keyGenerator: req => 'u' + req.user.id,
  message: { error: 'You can send up to 5 messages a day. Try again tomorrow.' },
});

// Deliberately no logging in this route: not the text, not the sender.
router.post('/feedback', requireAuth, sendLimit, async (req, res, next) => {
  try {
    if (req.user.role === 'volunteer') return bad(res, 'The feedback box is for members.', 403);
    const key = keyBytes();
    if (!key) return bad(res, 'The feedback box is not switched on yet: the server needs a FEEDBACK_KEY of at least 32 characters.', 503);
    const b = req.body || {};
    if (!CATEGORIES.includes(b.category)) return bad(res, 'Choose what this is about.');
    const body = K.str(b.body, 10, 2000); if (!body) return bad(res, 'Write at least 10 characters (up to 2000).');
    const { error } = await req.app.locals.supabase.from('anonymous_feedback').insert({ category: b.category, body_enc: encrypt(body, key) });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// Presidents read the inbox.
router.get('/feedback', requireAuth, async (req, res, next) => {
  try {
    if (!K.isPres(req.user)) return bad(res, 'Only the Presidents can read the feedback box.', 403);
    const key = keyBytes();
    if (!key) return bad(res, 'The feedback box is not switched on yet: the server needs a FEEDBACK_KEY of at least 32 characters.', 503);
    const { data, error } = await req.app.locals.supabase.from('anonymous_feedback').select('id, category, body_enc, status, created_at').order('id', { ascending: false }).limit(200);
    if (error) throw error;
    data.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    res.set('Cache-Control', 'no-store');
    res.json({ messages: data.map(m => { let body; try { body = decrypt(m.body_enc, key); } catch { body = '[This message cannot be decrypted. The key may have changed.]'; } return { id: m.id, category: m.category, status: m.status, day: new Date(m.created_at).toISOString().slice(0, 10), body }; }) });
  } catch (err) { next(err); }
});

router.post('/feedback/:id/status', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!K.isPres(u)) return bad(res, 'Only the Presidents can handle the feedback box.', 403);
    if (!id) return bad(res, 'Invalid message.');
    const status = (req.body || {}).status;
    if (!['new', 'read', 'resolved'].includes(status)) return bad(res, 'Status must be new, read or resolved.');
    const sb = req.app.locals.supabase;
    const { data, error } = await sb.from('anonymous_feedback').update({ status }).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'Message not found.', 404);
    await audit(sb, u, 'feedback.status', 'feedback', id, { status }); // the action is recorded, never the content
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
