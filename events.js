const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
router.use('/events', requireAuth);

const qrLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many code attempts. Wait a few minutes.' },
});

async function loadEvent(sb, id) {
  const { data, error } = await sb.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
const head = { count: 'exact', head: true };
const checkinLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many scans in a minute. Wait a moment and scan again.' },
}); // a line of members at the door is about one scan every few seconds
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------------------------------------------------------------------------
// Create / edit / delete events
// ---------------------------------------------------------------------------
router.post('/events', async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    if (!['lead', 'pres', 'admin'].includes(u.role)) return bad(res, 'Only Sector Leads and Co-Presidents can create events.', 403);

    const title = K.str(b.title, 2, 120);
    if (!title) return bad(res, 'Add a title (2 to 120 characters).');
    const sector = K.isStaff(u) ? b.sector : u.sector;
    if (!K.SECTORS.includes(sector)) {
      return bad(res, u.role === 'lead' ? 'Your account has no sector yet. Ask an admin to set it.' : 'Choose a sector.');
    }
    const hours = K.num(b.hours, 0.5, 12);
    const capacity = K.int(b.capacity, 1, 500);
    const volunteerSlots = K.int(b.volunteerSlots == null ? 0 : b.volunteerSlots, 0, 100);
    const days = K.int(b.days == null ? 1 : b.days, 1, 60);
    if (hours === null) return bad(res, 'Hours must be between 0.5 and 12.');
    if (capacity === null) return bad(res, 'Capacity must be a whole number from 1 to 500.');
    if (volunteerSlots === null) return bad(res, 'Volunteer slots must be a whole number from 0 to 100.');
    if (days === null) return bad(res, 'Days must be a whole number from 1 to 60.');
    if (!['in', 'out'].includes(b.type)) return bad(res, 'Choose in-school or out-of-school.');

    const verification = Array.isArray(b.verification) ? [...new Set(b.verification.filter(v => K.VERIFY.includes(v)))] : [];
    if (!verification.length) return bad(res, 'Pick at least one verification method.');
    let lat = null, lng = null;
    if (verification.includes('gps')) {
      lat = K.num(b.lat, -90, 90); lng = K.num(b.lng, -180, 180);
      if (lat === null || lng === null) return bad(res, "GPS check-in needs the venue's location. Use 'Use my current location' at the venue.");
    }
    const shifts = K.list(b.shifts, 8, 40), points = K.list(b.points, 8, 60);
    if (shifts === null || points === null) return bad(res, 'Booths and zones: up to 8 short names.');

    const row = {
      title, sector, hours, capacity, volunteer_slots: volunteerSlots,
      location: K.str(b.location || '', 1, 120) || 'To be announced',
      date_label: K.str(b.dateLabel || '', 1, 60) || 'Date to be set',
      type: b.type, verification: JSON.stringify(verification),
      shifts: shifts.length ? JSON.stringify(shifts) : null,
      points: points.length ? JSON.stringify(points) : null,
      days: days > 1 ? days : null, lat, lng,
      waiver_required: b.waiver ? 1 : 0, is_setup: b.setup ? 1 : 0, is_active: b.active === false ? 0 : 1,
      created_by: u.id,
    };
    const { data, error } = await req.app.locals.supabase.from('events').insert(row).select('*').maybeSingle();
    if (error) throw error;
    await audit(req.app.locals.supabase, u, 'event.create', 'event', data.id, { title, sector });
    console.log(`[events] ${u.email} created "${title}" (${sector})`);
    res.status(201).json({ event: K.eventOut(data) });
  } catch (err) { next(err); }
});

router.patch('/events/:id', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), b = req.body || {};
    if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!K.canManageSector(req.user, ev.sector)) return bad(res, 'You can only manage events in your own sector.', 403);

    const upd = {};
    if (b.title !== undefined) { const v = K.str(b.title, 2, 120); if (v === null) return bad(res, 'Title must be 2 to 120 characters.'); upd.title = v; }
    if (b.hours !== undefined) { const v = K.num(b.hours, 0.5, 12); if (v === null) return bad(res, 'Hours must be between 0.5 and 12.'); upd.hours = v; }
    if (b.capacity !== undefined) { const v = K.int(b.capacity, 1, 500); if (v === null) return bad(res, 'Capacity must be 1 to 500.'); upd.capacity = v; }
    if (b.volunteerSlots !== undefined) { const v = K.int(b.volunteerSlots, 0, 100); if (v === null) return bad(res, 'Volunteer slots must be 0 to 100.'); upd.volunteer_slots = v; }
    if (b.location !== undefined) { const v = K.str(b.location, 1, 120); if (v === null) return bad(res, 'Location must be 1 to 120 characters.'); upd.location = v; }
    if (b.dateLabel !== undefined) { const v = K.str(b.dateLabel, 1, 60); if (v === null) return bad(res, 'Date must be 1 to 60 characters.'); upd.date_label = v; }
    if (b.active !== undefined) upd.is_active = b.active ? 1 : 0;
    if (!Object.keys(upd).length) return bad(res, 'Nothing to change.');

    const { data, error } = await sb.from('events').update(upd).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    res.json({ event: K.eventOut(data) });
  } catch (err) { next(err); }
});

router.delete('/events/:id', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id);
    if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!K.canManageSector(req.user, ev.sector)) return bad(res, 'You can only manage events in your own sector.', 403);
    // Never silently erase anyone's logged hours.
    if (await countRows(sb.from('hour_logs').select('id', head).eq('event_id', id))) {
      return bad(res, 'This event already has logged hours, so it cannot be deleted. Mark it inactive instead.', 409);
    }
    const { error } = await sb.from('events').delete().eq('id', id);
    if (error) throw error;
    await audit(sb, req.user, 'event.delete', 'event', id, { title: ev.title, sector: ev.sector });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Sign-ups (members) and volunteer slots (keeplist)
// ---------------------------------------------------------------------------
router.post('/events/:id/signup', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid event.');
    if (u.role === 'volunteer') return bad(res, 'Volunteers take a volunteer slot instead.', 403);
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);

    let waiverAt = null;
    if (ev.waiver_required) {
      if (!K.str((req.body || {}).waiverName, 3, 80)) return bad(res, 'Type your full name to sign the waiver.');
      waiverAt = new Date().toISOString();
    }
    const taken = await countRows(sb.from('signups').select('id', head).eq('event_id', id).eq('is_volunteer', 0));
    if (taken >= ev.capacity) return bad(res, 'This event is full.', 409);

    // Booth rotation: put the member on the least-filled booth.
    let shift = null;
    const shifts = K.safeJson(ev.shifts, null);
    if (shifts && shifts.length) {
      const { data, error } = await sb.from('signups').select('shift').eq('event_id', id).eq('is_volunteer', 0);
      if (error) throw error;
      const n = s => data.filter(x => x.shift === s).length;
      shift = shifts.slice().sort((a, b) => n(a) - n(b))[0];
    }
    const { error } = await sb.from('signups').insert({ user_id: u.id, event_id: id, shift, is_volunteer: 0, waiver_signed_at: waiverAt });
    if (error) {
      if (error.code === '23505') return bad(res, 'You are already signed up.', 409);
      throw error;
    }
    res.status(201).json({ ok: true, shift });
  } catch (err) { next(err); }
});

router.delete('/events/:id/signup', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase;
    if (await countRows(sb.from('hour_logs').select('id', head).eq('event_id', id).eq('user_id', u.id))) {
      return bad(res, 'You already logged hours for this event, so you cannot leave it.', 409);
    }
    const { error } = await sb.from('signups').delete().eq('event_id', id).eq('user_id', u.id).eq('is_volunteer', 0);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/events/:id/volunteer', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid event.');
    if (u.role !== 'volunteer') return bad(res, 'Volunteer slots are for volunteers on the keeplist.', 403);
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    const taken = await countRows(sb.from('signups').select('id', head).eq('event_id', id).eq('is_volunteer', 1));
    if (taken >= ev.volunteer_slots) return bad(res, 'No open volunteer slots.', 409);
    const { error } = await sb.from('signups').insert({ user_id: u.id, event_id: id, is_volunteer: 1 });
    if (error) {
      if (error.code === '23505') return bad(res, 'You already have a slot.', 409);
      throw error;
    }
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/events/:id/volunteer', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id);
    if (!id) return bad(res, 'Invalid event.');
    const { error } = await req.app.locals.supabase.from('signups').delete()
      .eq('event_id', id).eq('user_id', req.user.id).eq('is_volunteer', 1);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Live check-in code (shown on the Sector Lead's screen) and its verification
// ---------------------------------------------------------------------------
router.get('/events/:id/qr', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id);
    if (!id) return bad(res, 'Invalid event.');
    const ev = await loadEvent(req.app.locals.supabase, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!K.canManageSector(req.user, ev.sector)) return bad(res, 'Only this sector\'s lead can show the check-in code.', 403);
    if (!K.safeJson(ev.verification, []).includes('qr')) return bad(res, 'This event does not use a live code.');
    res.set('Cache-Control', 'no-store');
    res.json({ code: K.qrCode(id, K.qrWindow()), expiresIn: K.qrSecondsLeft() });
  } catch (err) { next(err); }
});

router.post('/events/:id/verify-qr', qrLimiter, async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid event.');
    if (u.role === 'volunteer') return bad(res, 'Check-in is for members.', 403);
    const sb = req.app.locals.supabase;
    // Only people signed up for the event may try codes.
    if (!(await countRows(sb.from('signups').select('id', head).eq('event_id', id).eq('user_id', u.id).eq('is_volunteer', 0)))) {
      return bad(res, 'Sign up for this event first.', 403);
    }
    res.json({ ok: K.qrValid(id, (req.body || {}).code) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Officer QR check-in: the lead (or a President) scans a member's badge at the door.
// The officer vouches for presence in person, so the hours are logged as approved straight away.
// ---------------------------------------------------------------------------
router.post('/events/checkin', checkinLimiter, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    const eventId = K.toId(b.eventId), userId = K.toId(b.userId);
    if (!eventId) return bad(res, 'Invalid event.');
    if (!userId) return bad(res, 'That QR code is not a club member badge.');
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, eventId);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!(K.canManageSector(u, ev.sector) || u.role === 'admin')) return bad(res, "Only this sector's lead or a President can check members in.", 403);
    if (!ev.is_active) return bad(res, 'This event is not active. Mark it active to check members in.', 409);
    if (userId === u.id) return bad(res, 'You cannot check yourself in.', 403);

    const { data: member, error: mErr } = await sb.from('users').select('id, name, role').eq('id', userId).maybeSingle();
    if (mErr) throw mErr;
    if (!member) return bad(res, 'No club member matches this badge.', 404);
    if (member.role === 'admin') return bad(res, 'Admin accounts are not club members.');
    if (member.role === 'volunteer') return bad(res, `${member.name} is on the keeplist. Hour logging unlocks when they are promoted to Active.`, 403);
    if (!(await countRows(sb.from('signups').select('id', head).eq('event_id', eventId).eq('user_id', userId).eq('is_volunteer', 0)))) {
      return bad(res, `${member.name} is not signed up for ${ev.title}.`, 403);
    }

    // One check-in per member per event day. A rejected day can be redone.
    const { data: mine, error: lErr } = await sb.from('hour_logs').select('id, day, status, created_at')
      .eq('event_id', eventId).eq('user_id', userId);
    if (lErr) throw lErr;
    const live = mine.filter(l => l.status !== 'rejected');
    const today = new Date().toISOString().slice(0, 10);
    const already = () => res.status(409).json({ error: `${member.name} is already checked in for ${ev.title}.`, duplicate: true, member: { id: member.id, name: member.name } });
    if (live.some(l => String(l.created_at || '').slice(0, 10) === today)) return already();
    const taken = new Set(live.map(l => l.day));
    let day = 0;
    for (let d = 1; d <= (ev.days || 1); d++) if (!taken.has(d)) { day = d; break; }
    if (!day) return already();
    const redo = mine.find(l => l.day === day && l.status === 'rejected');

    const now = new Date().toISOString();
    const row = {
      user_id: userId, event_id: eventId, hours: ev.hours, day, status: 'approved', flagged: 0,
      photo_data: null, work_link: null, gps_lat: null, gps_lng: null,
      overtime_hours: null, overtime_reason: null, overtime_proof_url: null, overtime_status: null,
      reviewed_by: u.id, reviewed_at: now, grant_type: 'qr_checkin', granted_by: u.id,
    };
    const result = redo
      ? await sb.from('hour_logs').update({ ...row, created_at: now }).eq('id', redo.id).eq('status', 'rejected').select('id').maybeSingle()
      : await sb.from('hour_logs').insert(row).select('id').maybeSingle();
    if (result.error) {
      if (result.error.code === '23505') return already(); // two scanners, same badge, same moment
      throw result.error;
    }
    if (!result.data) return already();
    await audit(sb, u, 'hours.qr_checkin', 'hour_log', result.data.id, { userId, eventId, hours: ev.hours, day });
    console.log(`[events] ${u.email} checked in user #${userId} at event #${eventId} day ${day}`);
    res.status(201).json({ ok: true, logId: result.data.id, eventId, day, days: ev.days || 1, hours: ev.hours, member: { id: member.id, name: member.name } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Approve everything pending for one event in one tap
// ---------------------------------------------------------------------------
router.post('/events/:id/approve-all', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, id);
    if (!ev) return bad(res, 'Event not found.', 404);
    if (!K.canManageSector(u, ev.sector)) return bad(res, 'You can only approve hours in your own sector.', 403);
    const { data, error } = await sb.from('hour_logs')
      .update({ status: 'approved', reviewed_by: u.id, reviewed_at: new Date().toISOString() })
      .eq('event_id', id).eq('status', 'pending').neq('user_id', u.id) // never your own hours
      .select('id');
    if (error) throw error;
    await audit(sb, u, 'hours.approve_all', 'event', id, { count: data.length });
    console.log(`[hours] ${u.email} approved ${data.length} logs for event #${id}`);
    res.json({ approved: data.length });
  } catch (err) { next(err); }
});

module.exports = router;
