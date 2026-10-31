const crypto = require('crypto');

const SECTORS = ['Creative', 'Events', 'Finance', 'Community'];
const VERIFY = ['gps', 'qr', 'selfie', 'link'];
const GPS_RADIUS_M = 200;

const toId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const isStaff = u => !!u && ['pres', 'admin'].includes(u.role);
const lvl = h => (h < 10 ? 0 : h < 25 ? 1 : h < 50 ? 2 : 3); // keep in sync with lvl() in public/index.html
const round2 = n => Math.round(n * 100) / 100;

// Presidents manage every sector; a Sector Lead only their own sector.
const canManageSector = (u, sector) => (u && u.role === 'pres') || (u && u.role === 'lead' && !!u.sector && u.sector === sector);

// ---- input helpers: return the cleaned value, or null when invalid ----
const str = (v, min, max) => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s.length >= min && s.length <= max ? s : null;
};
const num = (v, min, max) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= min && n <= max ? n : null; };
const int = (v, min, max) => { const n = num(v, min, max); return n !== null && Number.isInteger(n) ? n : null; };
const list = (v, maxItems, maxLen) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out = v.map(x => str(String(x), 1, maxLen));
  return out.includes(null) ? null : [...new Set(out)];
};
const safeJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// ---- live check-in code: changes every 30 s, derived from a server secret ----
const WINDOW_MS = 30000;
const qrSecret = () => process.env.QR_SECRET || process.env.SESSION_SECRET || 'dev-only-qr-secret';
const qrWindow = (t = Date.now()) => Math.floor(t / WINDOW_MS);
function qrCode(eventId, win) {
  const h = crypto.createHmac('sha256', qrSecret()).update(`${eventId}:${win}`).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
// The current code or the one just before it (so a code typed at the very end of a window still works).
function qrValid(eventId, code, now = Date.now()) {
  const c = String(code == null ? '' : code).trim();
  if (!/^\d{6}$/.test(c)) return false;
  const w = qrWindow(now);
  return [w, w - 1].some(x => crypto.timingSafeEqual(Buffer.from(qrCode(eventId, x)), Buffer.from(c)));
}
const qrSecondsLeft = (now = Date.now()) => Math.max(1, Math.ceil(((qrWindow(now) + 1) * WINDOW_MS - now) / 1000));

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = d => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Hours a log is worth: the event's hours plus any overtime a Co-President approved.
const logHours = l => l.hours + (l.overtime_status === 'approved' ? l.overtime_hours || 0 : 0);

// Supabase returns at most 1000 rows per request, so read big tables page by page.
async function fetchAll(buildQuery) {
  const PAGE = 1000, rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
// `.in('id', [...])` puts every id in the URL, so keep each request small.
async function inBatches(ids, run, size = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await run(ids.slice(i, i + size));
    if (error) throw error;
    out.push(...data);
  }
  return out;
}

// Approved hours per member, split into in-school and out-of-school.
function hoursByUser(approvedLogs, eventType) {
  const m = new Map();
  for (const l of approvedLogs) {
    const t = m.get(l.user_id) || { in: 0, out: 0 };
    if (eventType.get(l.event_id) === 'out') t.out += logHours(l); else t.in += logHours(l);
    m.set(l.user_id, t);
  }
  return m;
}

const eventOut = (e, signups = []) => ({
  id: e.id, title: e.title, sector: e.sector, hours: e.hours, capacity: e.capacity,
  volunteerSlots: e.volunteer_slots, location: e.location, dateLabel: e.date_label, type: e.type,
  verification: safeJson(e.verification, []), shifts: safeJson(e.shifts, null), points: safeJson(e.points, null),
  days: e.days || 1, waiver: !!e.waiver_required, setup: !!e.is_setup, active: !!e.is_active,
  lat: e.lat == null ? null : e.lat, lng: e.lng == null ? null : e.lng,
  signups: signups.filter(s => !s.is_volunteer).map(s => ({ u: s.user_id, shift: s.shift })),
  vsign: signups.filter(s => s.is_volunteer).map(s => s.user_id),
});

// ---- helpers used by sectorroles.js and treasury.js ----
const isPres = u => !!u && u.role === 'pres';
const canRunSector = canManageSector;
const SECTOR_LABEL = Object.fromEntries(SECTORS.map(s => [s, s]));
// ASSUMPTION: the Finance Head is a Sector Lead in the Finance sector. Check this against seed.js.
const canTreasury = u => isPres(u) || (!!u && u.role === 'lead' && u.sector === 'Finance');
// Money is stored as a whole number of cents to avoid floating-point drift.
const cents = n => Math.round(Number(n) * 100);
const normalizeLink = v => {
  if (typeof v !== 'string') return null;
  try {
    const value = v.trim();
    if (!value) return null;
    const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? u.href : null;
  } catch { return null; }
};

module.exports = {
  SECTORS, VERIFY, GPS_RADIUS_M, toId, isStaff, lvl, round2, canManageSector,
  str, num, int, list, safeJson, qrWindow, qrCode, qrValid, qrSecondsLeft, distanceM,
  logHours, fetchAll, inBatches, hoursByUser, eventOut,
  isPres, canRunSector, SECTOR_LABEL, canTreasury, cents, normalizeLink,
};