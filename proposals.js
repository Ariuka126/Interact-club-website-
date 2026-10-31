const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const COLS = 'id, proposer_id, title, description, category, sector, type, date_label, location, hours, capacity, status, decided_by, decided_at, decision_note, event_id, created_at';
const MAX_PENDING = 5;

// Presidents see every proposal; everyone else sees their own.
router.get('/proposals', requireAuth, async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase, u = req.user;
    if (u.role === 'volunteer') return bad(res, 'Pitching events opens up once you are an active member.', 403);
    let q = sb.from('event_proposals').select(COLS).order('id', { ascending: false }).limit(200);
    if (!K.isPres(u)) q = q.eq('proposer_id', u.id);
    const { data, error } = await q; if (error) throw error;
    const ids = [...new Set(data.map(p => p.proposer_id).filter(Boolean))];
    const people = ids.length ? await K.inBatches(ids, b => sb.from('users').select('id, name').in('id', b)) : [];
    const name = new Map(people.map(p => [p.id, p.name]));
    res.set('Cache-Control', 'no-store');
    res.json({ proposals: data.map(p => ({ ...p, proposer: name.get(p.proposer_id) || 'Former member' })), all: K.isPres(u) });
  } catch (err) { next(err); }
});

router.post('/proposals', requireAuth, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    if (!['member', 'lead'].includes(u.role)) return bad(res, 'Members and Sector Heads pitch events. Presidents publish them directly.', 403);
    const title = K.str(b.title, 2, 120), description = K.str(b.description, 10, 1000), loc = K.str(b.location, 1, 120), date = K.str(b.dateLabel, 1, 60);
    if (!title) return bad(res, 'Give the event a title (2 to 120 characters).');
    if (!description) return bad(res, 'Describe the idea (10 to 1000 characters).');
    if (!['service', 'fundraising'].includes(b.category)) return bad(res, 'Choose community service or fundraising.');
    if (!K.SECTORS.includes(b.sector)) return bad(res, 'Choose the sector it fits best.');
    if (!['in', 'out'].includes(b.type)) return bad(res, 'Choose in-school or out-of-school.');
    if (!date) return bad(res, 'When would it happen?');
    if (!loc) return bad(res, 'Where would it happen?');
    const hours = K.num(b.hours, 0.5, 12), capacity = K.int(b.capacity, 1, 500);
    if (hours === null) return bad(res, 'Hours per member must be between 0.5 and 12.');
    if (capacity === null) return bad(res, 'Capacity must be a whole number from 1 to 500.');
    const sb = req.app.locals.supabase;
    const { count, error: cErr } = await sb.from('event_proposals').select('id', { count: 'exact', head: true }).eq('proposer_id', u.id).eq('status', 'pending');
    if (cErr) throw cErr;
    if (count >= MAX_PENDING) return bad(res, `You already have ${MAX_PENDING} proposals waiting. Wait for a decision first.`, 409);
    const { data, error } = await sb.from('event_proposals').insert({ proposer_id: u.id, title, description, category: b.category, sector: b.sector, type: b.type, date_label: date, location: loc, hours, capacity, status: 'pending', decided_by: null, decided_at: null, decision_note: null, event_id: null }).select(COLS).maybeSingle();
    if (error) throw error;
    res.status(201).json({ proposal: data });
  } catch (err) { next(err); }
});

router.post('/proposals/:id/withdraw', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id); if (!id) return bad(res, 'Invalid proposal.');
    const sb = req.app.locals.supabase;
    const { data, error } = await sb.from('event_proposals').select('id, proposer_id, status').eq('id', id).maybeSingle(); if (error) throw error;
    if (!data || data.proposer_id !== req.user.id) return bad(res, 'Proposal not found.', 404);
    if (data.status !== 'pending') return bad(res, `That proposal was already ${data.status}.`, 409);
    const r = await sb.from('event_proposals').delete().eq('id', id).eq('status', 'pending'); if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// A President decides. Approval creates the event on the global calendar straight away.
router.post('/proposals/:id/decision', requireAuth, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user, b = req.body || {};
    if (!K.isPres(u)) return bad(res, 'Only a President can decide on proposals.', 403);
    if (!id) return bad(res, 'Invalid proposal.');
    if (!['approved', 'rejected'].includes(b.decision)) return bad(res, "Decision must be 'approved' or 'rejected'.");
    const note = b.note ? K.str(b.note, 1, 300) : null;
    if (b.note && !note) return bad(res, 'Keep the note under 300 characters.');
    if (b.decision === 'rejected' && (!note || note.length < 5)) return bad(res, 'Tell the proposer why (at least 5 characters).');
    const sb = req.app.locals.supabase, now = new Date().toISOString();
    const { data: p, error } = await sb.from('event_proposals').update({ status: b.decision, decided_by: u.id, decided_at: now, decision_note: note })
      .eq('id', id).eq('status', 'pending').select(COLS).maybeSingle();
    if (error) throw error;
    if (!p) {
      const { data: cur } = await sb.from('event_proposals').select('status').eq('id', id).maybeSingle();
      return cur ? bad(res, `That proposal was already ${cur.status}.`, 409) : bad(res, 'Proposal not found.', 404);
    }
    if (b.decision === 'rejected') {
      await audit(sb, u, 'proposal.reject', 'proposal', id, { title: p.title, note });
      return res.json({ ok: true });
    }
    const sector = K.SECTORS.includes(b.sector) ? b.sector : p.sector;
    const { data: ev, error: eErr } = await sb.from('events').insert({
      title: p.title, sector, hours: p.hours, capacity: p.capacity, volunteer_slots: 2, location: p.location, date_label: p.date_label, type: p.type,
      verification: JSON.stringify(['qr', 'selfie']), shifts: null, points: null, days: null, lat: null, lng: null,
      waiver_required: 0, is_setup: 0, is_active: 1, created_by: u.id,
    }).select('id').maybeSingle();
    if (eErr || !ev) { // put the proposal back so the President can try again
      await sb.from('event_proposals').update({ status: 'pending', decided_by: null, decided_at: null, decision_note: null }).eq('id', id);
      throw eErr || new Error('The event could not be created.');
    }
    const link = await sb.from('event_proposals').update({ event_id: ev.id }).eq('id', id); if (link.error) throw link.error;
    await audit(sb, u, 'proposal.approve', 'proposal', id, { title: p.title, proposerId: p.proposer_id, eventId: ev.id, sector, note });
    res.json({ ok: true, eventId: ev.id });
  } catch (err) { next(err); }
});

module.exports = router;
