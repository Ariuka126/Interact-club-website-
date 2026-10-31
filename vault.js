const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const CATEGORIES = ['minutes', 'bylaws', 'media_kit', 'other'];
const COLS = 'id, title, category, url, description, archived, created_at';

// Everyone who is a member can read. Only Presidents add. Nothing is edited or deleted; old assets are archived.
router.get('/vault', requireAuth, async (req, res, next) => {
  try {
    const u = req.user;
    if (u.role === 'volunteer') return bad(res, 'The vault opens once you are an active member.', 403);
    let q = req.app.locals.supabase.from('resource_vault').select(COLS).order('id', { ascending: false });
    if (!(K.isPres(u) && req.query.all === '1')) q = q.eq('archived', false);
    const { data, error } = await q; if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ items: data, canManage: K.isPres(u) });
  } catch (err) { next(err); }
});

router.post('/vault', requireAuth, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    if (!K.isPres(u)) return bad(res, 'Only a President can add to the vault.', 403);
    const title = K.str(b.title, 2, 120); if (!title) return bad(res, 'Give it a title (2 to 120 characters).');
    if (!CATEGORIES.includes(b.category)) return bad(res, 'Choose minutes, bylaws, media kit or other.');
    const url = K.normalizeLink(b.url); if (!url) return bad(res, 'The link must be a web address.');
    const description = b.description ? K.str(b.description, 1, 300) : '';
    if (description === null) return bad(res, 'Keep the description under 300 characters.');
    const sb = req.app.locals.supabase;
    const { data, error } = await sb.from('resource_vault').insert({ title, category: b.category, url, description, archived: false, added_by: u.id }).select(COLS).maybeSingle();
    if (error) throw error;
    await audit(sb, u, 'vault.add', 'vault', data.id, { title, category: b.category });
    res.status(201).json({ item: data });
  } catch (err) { next(err); }
});

router.post('/vault/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!K.isPres(u)) return bad(res, 'Only a President can archive vault items.', 403);
    if (!id) return bad(res, 'Invalid item.');
    const sb = req.app.locals.supabase;
    const { data, error } = await sb.from('resource_vault').update({ archived: true }).eq('id', id).eq('archived', false).select('id, title').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'That item is not in the vault.', 404);
    await audit(sb, u, 'vault.archive', 'vault', id, { title: data.title });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
