const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isHead = u => u && u.role === 'lead' && !!u.sector;
const head = { count: 'exact', head: true };

async function countRows(q) { const { count, error } = await q; if (error) throw error; return count || 0; }
async function loadRole(sb, id) { const { data, error } = await sb.from('sector_roles').select('*').eq('id', id).maybeSingle(); if (error) throw error; return data; }
const filledOf = (sb, roleId) => countRows(sb.from('role_applications').select('id', head).eq('role_id', roleId).eq('status', 'accepted'));

// Openings. Members see the open ones and where they stand; the sector's head (and Presidents) also see who applied.
router.get('/sector-roles', requireAuth, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase, u = req.user;
    if (u.role === 'volunteer') return bad(res, 'Sector roles open up once you are an active member.', 403);
    const [roles, apps] = await Promise.all([
      K.fetchAll(() => sb.from('sector_roles').select('*').order('id')),
      K.fetchAll(() => sb.from('role_applications').select('id, role_id, user_id, status, note, created_at').order('id')),
    ]);
    const managed = roles.filter(r => K.canRunSector(u, r.sector));
    const needNames = [...new Set(apps.filter(a => managed.some(r => r.id === a.role_id)).map(a => a.user_id))];
    const people = needNames.length ? await K.inBatches(needNames, ids => sb.from('users').select('id, name, sector').in('id', ids)) : [];
    const who = new Map(people.map(p => [p.id, p]));
    const out = roles.map(r => {
      const mine = apps.find(a => a.role_id === r.id && a.user_id === u.id);
      const filled = apps.filter(a => a.role_id === r.id && a.status === 'accepted').length;
      const canManage = K.canRunSector(u, r.sector);
      return {
        id: r.id, sector: r.sector, title: r.title, description: r.description, capacity: r.capacity, open: r.is_open, filled, full: filled >= r.capacity,
        canManage, my: mine ? { id: mine.id, status: mine.status } : null,
        applications: canManage ? apps.filter(a => a.role_id === r.id && ['pending', 'accepted'].includes(a.status))
          .map(a => ({ id: a.id, userId: a.user_id, name: (who.get(a.user_id) || {}).name || 'Former member', sector: (who.get(a.user_id) || {}).sector || null, status: a.status, note: a.note, createdAt: a.created_at })) : undefined,
      };
    }).filter(r => r.canManage || r.open || r.my);
    res.set('Cache-Control', 'no-store');
    res.json({ roles: out });
  } catch (err) { next(err); }
});

router.post('/sector-roles', requireAuth, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    if (!K.isPres(u) && !isHead(u)) return bad(res, 'Only Sector Heads and Presidents post sector roles.', 403);
    const sector = K.isPres(u) ? b.sector : u.sector;
    if (!K.SECTORS.includes(sector)) return bad(res, 'Choose a sector.');
    const title = K.str(b.title, 2, 80); if (!title) return bad(res, 'Give the role a title (2 to 80 characters).');
    const description = b.description ? K.str(b.description, 1, 500) : '';
    if (description === null) return bad(res, 'The description can be up to 500 characters.');
    const capacity = K.int(b.capacity, 1, 50); if (capacity === null) return bad(res, 'Places must be a whole number from 1 to 50.');
    const sb = req.app.locals.supabase;
    const { data, error } = await sb.from('sector_roles').insert({ sector, title, description, capacity, created_by: u.id }).select('*').maybeSingle();
    if (error) throw error;
    await audit(sb, u, 'sector_role.post', 'sector_role', data.id, { sector, title, capacity });
    res.status(201).json({ role: data });
  } catch (err) { next(err); }
});

router.post('/sector-roles/:id/state', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid role.');
    const sb = req.app.locals.supabase, role = await loadRole(sb, id);
    if (!role) return bad(res, 'Role not found.', 404);
    if (!K.canRunSector(u, role.sector)) return bad(res, 'That role belongs to another sector.', 403);
    const open = !!(req.body || {}).open;
    const { error } = await sb.from('sector_roles').update({ is_open: open }).eq('id', id); if (error) throw error;
    await audit(sb, u, open ? 'sector_role.reopen' : 'sector_role.close', 'sector_role', id, { title: role.title });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/sector-roles/:id/apply', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid role.');
    if (u.role !== 'member') return bad(res, 'Only active members apply for sector roles.', 403);
    const sb = req.app.locals.supabase, role = await loadRole(sb, id);
    if (!role) return bad(res, 'Role not found.', 404);
    if (!role.is_open) return bad(res, 'This role is closed.', 409);
    if ((await filledOf(sb, id)) >= role.capacity) return bad(res, 'This role is full.', 409);
    const note = (req.body || {}).note ? K.str(req.body.note, 1, 300) : null;
    if ((req.body || {}).note && !note) return bad(res, 'Keep the note under 300 characters.');
    const { data: prev, error } = await sb.from('role_applications').select('id, status').eq('role_id', id).eq('user_id', u.id).maybeSingle();
    if (error) throw error;
    if (prev) {
      if (['pending', 'accepted'].includes(prev.status)) return bad(res, 'You already applied for this role.', 409);
      if (prev.status === 'rejected') return bad(res, 'Your application for this role was declined.', 409);
      const r = await sb.from('role_applications').update({ status: 'pending', note, decided_by: null, decided_at: null }).eq('id', prev.id); // withdrawn or revoked: apply again
      if (r.error) throw r.error;
    } else {
      const r = await sb.from('role_applications').insert({ role_id: id, user_id: u.id, note });
      if (r.error) { if (r.error.code === '23505') return bad(res, 'You already applied for this role.', 409); throw r.error; }
    }
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/sector-roles/:id/withdraw', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id); if (!id) return bad(res, 'Invalid role.');
    const { data, error } = await req.app.locals.supabase.from('role_applications').update({ status: 'withdrawn' })
      .eq('role_id', id).eq('user_id', req.user.id).in('status', ['pending', 'accepted']).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'You have no active application for this role.', 409);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Accept or decline. Heads decide for their own sector; only a President can bring in someone from another sector.
router.post('/applications/:id/decision', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user; if (!id) return bad(res, 'Invalid application.');
    const decision = String((req.body || {}).decision || '');
    if (!['accepted', 'rejected'].includes(decision)) return bad(res, "Decision must be 'accepted' or 'rejected'.");
    const sb = req.app.locals.supabase;
    const { data: app, error } = await sb.from('role_applications').select('*').eq('id', id).maybeSingle(); if (error) throw error;
    if (!app) return bad(res, 'Application not found.', 404);
    const role = await loadRole(sb, app.role_id);
    if (!role || !K.canRunSector(u, role.sector)) return bad(res, 'That role belongs to another sector.', 403);
    if (app.status !== 'pending') return bad(res, `That application is already ${app.status}.`, 409);
    const now = new Date().toISOString();
    let moved = false;

    if (decision === 'accepted') {
      const { data: person, error: pErr } = await sb.from('users').select('id, name, role, sector').eq('id', app.user_id).maybeSingle(); if (pErr) throw pErr;
      if (!person || person.role !== 'member') return bad(res, 'That person is no longer an active member.', 409);
      if (person.sector && person.sector !== role.sector && !K.isPres(u)) {
        return bad(res, `${person.name} belongs to the ${K.SECTOR_LABEL[person.sector]} sector. Only a President can recruit across sectors.`, 409);
      }
      if ((await filledOf(sb, role.id)) >= role.capacity) return bad(res, 'This role is full.', 409);
      const { data: won, error: wErr } = await sb.from('role_applications').update({ status: 'accepted', decided_by: u.id, decided_at: now }).eq('id', id).eq('status', 'pending').select('id').maybeSingle();
      if (wErr) throw wErr;
      if (!won) return bad(res, 'Someone else already decided this application.', 409);
      if ((await filledOf(sb, role.id)) > role.capacity) { // two accepts raced for the last place
        await sb.from('role_applications').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', id);
        return bad(res, 'This role is full.', 409);
      }
      if (person.sector !== role.sector) {
        const r = await sb.from('users').update({ sector: role.sector }).eq('id', person.id); if (r.error) throw r.error;
        moved = true;
      }
      await audit(sb, u, 'application.accept', 'sector_role', role.id, { applicant: person.name, applicantId: person.id, title: role.title, sector: role.sector, joinedSector: moved, from: person.sector });
    } else {
      const { data: won, error: wErr } = await sb.from('role_applications').update({ status: 'rejected', decided_by: u.id, decided_at: now }).eq('id', id).eq('status', 'pending').select('id').maybeSingle();
      if (wErr) throw wErr;
      if (!won) return bad(res, 'Someone else already decided this application.', 409);
      await audit(sb, u, 'application.reject', 'sector_role', role.id, { applicantId: app.user_id, title: role.title });
    }
    res.json({ ok: true, joinedSector: moved });
  } catch (err) { next(err); }
});

// Cross-sector recruitment: Presidents can place any active member in any sector.
router.post('/members/:id/assign-sector', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!K.isPres(u)) return bad(res, 'Only a President can move members between sectors.', 403);
    if (!id) return bad(res, 'Invalid member.');
    const sector = (req.body || {}).sector;
    if (!K.SECTORS.includes(sector)) return bad(res, 'Choose a sector.');
    const sb = req.app.locals.supabase;
    const { data: t, error } = await sb.from('users').select('id, name, role, sector').eq('id', id).maybeSingle(); if (error) throw error;
    if (!t) return bad(res, 'Member not found.', 404);
    if (t.role !== 'member') return bad(res, 'Only active members can be placed in a sector.', 409);
    const { error: uErr } = await sb.from('users').update({ sector }).eq('id', id); if (uErr) throw uErr;
    await audit(sb, u, 'member.assign_sector', 'user', id, { name: t.name, from: t.sector, to: sector });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
