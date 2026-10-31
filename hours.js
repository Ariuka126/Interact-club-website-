const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
router.use('/hours', requireAuth);

const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions. Wait a minute.' },
});
const head = { count: 'exact', head: true };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 600000; // characters of base64, roughly 450 KB

async function loadLog(sb, id, cols = 'id, user_id, event_id, status, flagged, overtime_status') {
  const { data, error } = await sb.from('hour_logs').select(cols).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
async function loadEvent(sb, id) {
  const { data, error } = await sb.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
function normalizeLink(v) {
  const s = K.str(v, 8, 500);
  if (!s || !s.includes('.') || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try { const u = new URL(withScheme); return /^https?:$/.test(u.protocol) ? withScheme : null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Submit hours (the check-in). The hours come from the event, never from the member.
// ---------------------------------------------------------------------------
router.post('/hours', submitLimiter, async (req, res, next) => {
  try {
    const u = req.user, b = req.body || {};
    if (u.role === 'volunteer') return bad(res, 'Hour logging unlocks when the Co-Presidents move you to Active.', 403);
    const eventId = K.toId(b.eventId);
    if (!eventId) return bad(res, 'Invalid event.');
    const sb = req.app.locals.supabase;
    const ev = await loadEvent(sb, eventId);
    if (!ev) return bad(res, 'Event not found.', 404);

    const { count, error: sErr } = await sb.from('signups').select('id', head)
      .eq('event_id', eventId).eq('user_id', u.id).eq('is_volunteer', 0);
    if (sErr) throw sErr;
    if (!count) return bad(res, 'Sign up for this event before checking in.', 403);

    // Which day is this? The first day without a pending/approved log. A rejected day can be redone.
    const { data: mine, error: mErr } = await sb.from('hour_logs').select('id, day, status')
      .eq('event_id', eventId).eq('user_id', u.id);
    if (mErr) throw mErr;
    const totalDays = ev.days || 1;
    const taken = new Set(mine.filter(l => l.status !== 'rejected').map(l => l.day));
    let day = 0;
    for (let d = 1; d <= totalDays; d++) if (!taken.has(d)) { day = d; break; }
    if (!day) return bad(res, 'All days for this event are already logged.', 409);
    const redo = mine.find(l => l.day === day && l.status === 'rejected');

    // Every check-in method the lead chose must pass.
    const methods = K.safeJson(ev.verification, []);
    let lat = null, lng = null, photo = null, link = null;
    if (methods.includes('gps')) {
      lat = K.num(b.lat, -90, 90); lng = K.num(b.lng, -180, 180);
      if (lat === null || lng === null) return bad(res, 'Share your location to check in.');
      if (ev.lat == null || ev.lng == null) return bad(res, 'This event has no venue location yet. Ask your Sector Lead.');
      const dist = Math.round(K.distanceM(lat, lng, ev.lat, ev.lng));
      if (dist > K.GPS_RADIUS_M) return bad(res, `You are ${dist} m from the venue. Check-in works within ${K.GPS_RADIUS_M} m.`);
    }
    if (methods.includes('qr') && !K.qrValid(eventId, b.code)) return bad(res, 'Wrong or expired check-in code. Ask the lead for the current one.');
    if (methods.includes('selfie')) {
      if (typeof b.photo !== 'string' || !PHOTO_RE.test(b.photo) || b.photo.length > MAX_PHOTO) return bad(res, 'Take a live photo to check in.');
      photo = b.photo;
    }
    if (methods.includes('link')) {
      link = normalizeLink(b.link);
      if (!link) return bad(res, 'Add a link to your work (for example drive.google.com/...).');
    }

    let ot = null;
    if (b.overtime) {
      const hours = K.num(b.overtime.hours, 0.5, 3), reason = K.str(b.overtime.reason, 15, 500);
      const proof = K.normalizeLink(b.overtime.proof);
      if (hours === null || reason === null || !proof) return bad(res, 'For an extended shift choose 0.5 to 3 extra hours, explain why, and add a proof link.');
      ot = { hours, reason, proof };
    }

    const row = {
      user_id: u.id, event_id: eventId, hours: ev.hours, day, status: 'pending',
      photo_data: photo, work_link: link, gps_lat: lat, gps_lng: lng,
      overtime_hours: ot ? ot.hours : null, overtime_reason: ot ? ot.reason : null, overtime_proof_url: ot ? ot.proof : null,
      overtime_status: ot ? 'pending' : null,
      flagged: 0, reviewed_by: null, reviewed_at: null,
    };
    let result;
    if (redo) {
      result = await sb.from('hour_logs').update({ ...row, created_at: new Date().toISOString() })
        .eq('id', redo.id).eq('status', 'rejected').select('id').maybeSingle();
    } else {
      result = await sb.from('hour_logs').insert(row).select('id').maybeSingle();
    }
    if (result.error) {
      if (result.error.code === '23505') return bad(res, 'That day is already logged.', 409);
      throw result.error;
    }
    if (!result.data) return bad(res, 'That entry changed. Reload and try again.', 409);
    console.log(`[hours] ${u.email} submitted event #${eventId} day ${day}`);
    res.status(201).json({ ok: true, day, id: result.data.id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// The proof photo, served as an image (the page uses it directly in <img src>)
// ---------------------------------------------------------------------------
router.get('/hours/:id/photo', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid log.');
    const sb = req.app.locals.supabase;
    const log = await loadLog(sb, id, 'id, user_id, event_id, status, flagged, photo_data');
    if (!log || !PHOTO_RE.test(log.photo_data || '')) return bad(res, 'No photo.', 404);

    let allowed = log.user_id === u.id || K.isStaff(u)
      || (u.role !== 'volunteer' && log.status === 'approved' && !log.flagged); // visible in the club feed
    if (!allowed && u.role === 'lead') {
      const ev = await loadEvent(sb, log.event_id);
      allowed = !!ev && K.canManageSector(u, ev.sector);
    }
    if (!allowed) return bad(res, 'You do not have access to this photo.', 403);

    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(log.photo_data);
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(m[2], 'base64'));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Review: Sector Leads for their sector, Co-Presidents and admins for everything
// ---------------------------------------------------------------------------
router.post('/hours/:id/review', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid log.');
    const status = String((req.body || {}).status || '').toLowerCase();
    if (!['approved', 'rejected'].includes(status)) return bad(res, "Status must be 'approved' or 'rejected'.");
    const sb = req.app.locals.supabase;
    const log = await loadLog(sb, id);
    if (!log) return bad(res, 'Entry not found.', 404);
    const ev = await loadEvent(sb, log.event_id);
    if (!ev || !K.canManageSector(u, ev.sector)) return bad(res, 'You can only review hours in your own sector.', 403);
    if (log.user_id === u.id) return bad(res, 'You cannot review your own hours.', 403);
    if (log.status !== 'pending') return bad(res, `Already ${log.status}.`, 409);
    const { data, error } = await sb.from('hour_logs')
      .update({ status, reviewed_by: u.id, reviewed_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'pending').select('id, status').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'Someone else already reviewed this entry.', 409);
    await audit(sb, u, status === 'approved' ? 'hours.approve' : 'hours.reject', 'hour_log', id, { userId: log.user_id, eventId: log.event_id });
    console.log(`[hours] ${u.email} ${status} log #${id}`);
    res.json({ log: data });
  } catch (err) { next(err); }
});

// Extended-shift requests are decided only by a President.
router.post('/hours/:id/overtime', requireRole('pres'), async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid log.');
    const decision = String((req.body || {}).decision || '').toLowerCase();
    if (!['approved', 'denied'].includes(decision)) return bad(res, "Decision must be 'approved' or 'denied'.");
    const sb = req.app.locals.supabase;
    const log = await loadLog(sb, id, 'id, user_id, event_id, hours, overtime_hours, overtime_status');
    if (!log) return bad(res, 'Entry not found.', 404);
    if (log.user_id === u.id) return bad(res, 'You cannot decide your own extended shift.', 403);
    if (log.overtime_status !== 'pending') return bad(res, 'There is no pending extended-shift request on this entry.', 409);
    const { data, error } = await sb.from('hour_logs').update({ overtime_status: decision })
      .eq('id', id).eq('overtime_status', 'pending').select('id').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'Someone else already decided this request.', 409);
    await audit(sb, u, decision === 'approved' ? 'overtime.approve' : 'overtime.deny', 'hour_log', id, { userId: log.user_id, hours: log.overtime_hours });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/hours/decided', requireRole('pres'), async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const logs = await K.fetchAll(() => sb.from('hour_logs')
      .select('id, user_id, event_id, hours, status, reviewed_by, reviewed_at')
      .neq('status', 'pending').order('id', { ascending: false }).limit(200));
    const userIds = [...new Set(logs.flatMap(l => [l.user_id, l.reviewed_by]).filter(Boolean))];
    const eventIds = [...new Set(logs.map(l => l.event_id))];
    const [users, events] = await Promise.all([
      userIds.length ? K.inBatches(userIds, ids => sb.from('users').select('id, name').in('id', ids)) : [],
      eventIds.length ? K.inBatches(eventIds, ids => sb.from('events').select('id, title').in('id', ids)) : [],
    ]);
    const names = new Map(users.map(u => [u.id, u.name]));
    const titles = new Map(events.map(e => [e.id, e.title]));
    res.set('Cache-Control', 'no-store');
    res.json({ logs: logs.map(l => ({
      ...l, member: names.get(l.user_id) || 'Former member', event: titles.get(l.event_id) || 'Deleted event',
      reviewer: names.get(l.reviewed_by) || null, own: l.user_id === req.user.id,
    })) });
  } catch (err) { next(err); }
});

router.post('/hours/:id/override', requireRole('pres'), async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid log.');
    const body = req.body || {}, status = String(body.status || '').toLowerCase();
    if (!['pending', 'approved', 'rejected'].includes(status)) return bad(res, 'Choose pending, approved or rejected.');
    const reason = K.str(body.reason, 10, 300);
    if (!reason) return bad(res, 'Write a reason (10 to 300 characters).');
    const sb = req.app.locals.supabase;
    const log = await loadLog(sb, id, 'id, user_id, event_id, status');
    if (!log) return bad(res, 'Entry not found.', 404);
    if (log.user_id === u.id) return bad(res, 'You cannot override your own hours.', 403);
    if (log.status === status) return bad(res, 'The entry already has that status.', 409);
    const now = status === 'pending' ? null : new Date().toISOString();
    const { data, error } = await sb.from('hour_logs').update({ status, reviewed_by: status === 'pending' ? null : u.id, reviewed_at: now })
      .eq('id', id).eq('status', log.status).select('id, status, reviewed_at').maybeSingle();
    if (error) throw error;
    if (!data) return bad(res, 'The entry changed. Reload and try again.', 409);
    await audit(sb, u, 'hours.override', 'hour_log', id, { userId: log.user_id, from: log.status, to: status, reason });
    res.json({ log: data });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Club feed: flag (anonymous), cheers, comments
// ---------------------------------------------------------------------------
async function feedLog(req, res) {
  const id = K.toId(req.params.id);
  if (!id) { bad(res, 'Invalid log.'); return null; }
  if (req.user.role === 'volunteer') { bad(res, 'The club feed is for members.', 403); return null; }
  const log = await loadLog(req.app.locals.supabase, id);
  if (!log || log.status !== 'approved' || log.flagged) { bad(res, 'That post is not available.', 404); return null; }
  return log;
}

router.post('/hours/:id/flag', async (req, res, next) => {
  try {
    const log = await feedLog(req, res); if (!log) return;
    const { error } = await req.app.locals.supabase.from('hour_logs').update({ flagged: 1 }).eq('id', log.id);
    if (error) throw error;
    res.json({ ok: true }); // who flagged it is deliberately not recorded
  } catch (err) { next(err); }
});

router.post('/hours/:id/cheer', async (req, res, next) => {
  try {
    const log = await feedLog(req, res); if (!log) return;
    const sb = req.app.locals.supabase, uid = req.user.id;
    const { count, error } = await sb.from('log_cheers').select('log_id', head).eq('log_id', log.id).eq('user_id', uid);
    if (error) throw error;
    if (count) {
      const r = await sb.from('log_cheers').delete().eq('log_id', log.id).eq('user_id', uid);
      if (r.error) throw r.error;
      return res.json({ cheered: false });
    }
    const r = await sb.from('log_cheers').insert({ log_id: log.id, user_id: uid });
    if (r.error && r.error.code !== '23505') throw r.error; // a double-tap race is fine
    res.json({ cheered: true });
  } catch (err) { next(err); }
});

router.post('/hours/:id/comment', async (req, res, next) => {
  try {
    const log = await feedLog(req, res); if (!log) return;
    const body = K.str((req.body || {}).body, 1, 300);
    if (!body) return bad(res, 'Write a comment (up to 300 characters).');
    const { error } = await req.app.locals.supabase.from('log_comments').insert({ log_id: log.id, user_id: req.user.id, body });
    if (error) throw error;
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// Co-President decisions on flagged posts.
router.post('/hours/:id/unflag', requireRole('pres', 'admin'), async (req, res, next) => {
  try {
    const id = K.toId(req.params.id);
    if (!id) return bad(res, 'Invalid log.');
    const { error } = await req.app.locals.supabase.from('hour_logs').update({ flagged: 0 }).eq('id', id);
    if (error) throw error;
    await audit(req.app.locals.supabase, req.user, 'hours.unflag', 'hour_log', id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/hours/:id/remove-hours', requireRole('pres', 'admin'), async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid log.');
    const { error } = await req.app.locals.supabase.from('hour_logs')
      .update({ status: 'rejected', flagged: 0, reviewed_by: u.id, reviewed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await audit(req.app.locals.supabase, u, 'hours.remove', 'hour_log', id);
    console.log(`[hours] ${u.email} removed hours of log #${id}`);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
