// Creates the first ADMIN account in Supabase. Nothing else: no fake volunteers, no fake hour logs,
// and every timestamp comes from the database defaults (CURRENT_TIMESTAMP, the same as NOW()).
// Usage: set SEED_PRESIDENT_* (name/email/password of the admin) plus the Supabase vars, then `node seed.js`.
// Optional, local dev only: `node seed.js --sample-events` also loads 12 demo events.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createSupabase } = require('./supabase');

(async () => {
  const { SEED_PRESIDENT_NAME: name, SEED_PRESIDENT_EMAIL: rawEmail, SEED_PRESIDENT_PASSWORD: pw } = process.env;
  if (!name || !rawEmail || !pw || pw.length < 8) {
    console.error('Set SEED_PRESIDENT_NAME, SEED_PRESIDENT_EMAIL and SEED_PRESIDENT_PASSWORD (8+ chars) first.');
    process.exit(1);
  }
  const supabase = createSupabase();
  const email = rawEmail.trim().toLowerCase();

  const { data: existing, error: findErr } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    console.log(`User ${email} already exists, left unchanged`);
  } else {
    const { error } = await supabase
      .from('users')
      .insert({ name: name.trim(), email, password_hash: await bcrypt.hash(pw, 12), role: 'admin' });
    if (error) throw error;
    console.log(`Created admin ${email}`);
  }

  if (!process.argv.includes('--sample-events')) {
    return console.log('Done. No sample data was inserted (use --sample-events for demo events).');
  }

  const { count, error: countErr } = await supabase.from('events').select('id', { count: 'exact', head: true });
  if (countErr) throw countErr;
  if (count > 0) return console.log('Events already present, skipped');

  const sh = ['Tarot reading', 'Photobooth', 'Scavenger desk'];
  const sh2 = ['Shagai games', 'Tarot reading', 'Photobooth'];
  const std = ['gps', 'qr', 'selfie'];
  // [title, sector, hours, capacity, volSlots, location, date, type, verification, extras]
  const events = [
    ['Halloween Scavenger Hunt & Fashion Walk', 'Events', 3, 15, 3, 'Main Auditorium', 'Oct 31', 'in', std, { shifts: sh, setup: 1 }],
    ['Tsagaan Sar Booth Rotation', 'Events', 2.5, 12, 2, 'School gym', 'Feb 2027', 'in', std, { shifts: sh2, setup: 1 }],
    ['Club Fair Booth', 'Events', 2, 8, 0, 'School lobby', 'Sep 24', 'in', std, { setup: 1 }],
    ['Pepero Day Order Run', 'Finance', 1.5, 10, 2, 'Finance room 204', 'Nov 11', 'in', std, {}],
    ['Tsergiin Bayr Video Edit', 'Creative', 4, 6, 0, 'Off-site task', 'Mar 2027', 'in', ['link'], {}],
    ["Women's Day Graphics Set", 'Creative', 3, 6, 0, 'Off-site task', 'Due Oct 20', 'in', ['link'], { active: 1 }],
    ['2-Week Tree Planting', 'Community', 1, 20, 4, 'Songino Khairkhan planting site', 'Oct 5 to Oct 18', 'out', std, { days: 14, active: 1 }],
    ['City Cleanup', 'Community', 2, 25, 5, 'Peace Avenue, Sukhbaatar Sq. side', 'Oct 10', 'out', std, { active: 1 }],
    ['Khoroo Aid Delivery', 'Community', 2.5, 12, 3, 'Three drop-off zones', 'Oct 24', 'out', std, { points: ['Khoroo office (pickup)', 'Zone A drop-off', 'Zone B drop-off'] }],
    ['TYK Distribution', 'Community', 2, 14, 3, 'Two distribution points', 'Nov 3', 'out', std, { points: ['Warehouse pickup', 'Distribution point'] }],
    ['Animal Shelter Visit', 'Community', 2, 10, 2, 'City animal shelter', 'Nov 7', 'out', std, { waiver: 1 }],
    ['Orphanage Visit', 'Community', 2.5, 10, 2, "Children's home", 'Nov 21', 'out', std, { waiver: 1 }],
  ];
  const rows = events.map(([title, sector, hours, capacity, volunteer_slots, location, date_label, type, ver, x]) => ({
    title, sector, hours, capacity, volunteer_slots, location, date_label, type,
    verification: JSON.stringify(ver),
    shifts: x.shifts ? JSON.stringify(x.shifts) : null,
    points: x.points ? JSON.stringify(x.points) : null,
    days: x.days || null,
    waiver_required: x.waiver || 0,
    is_setup: x.setup || 0,
    is_active: x.active || 0,
  }));
  const { error } = await supabase.from('events').insert(rows);
  if (error) throw error;
  console.log(`Seeded ${rows.length} sample events`);
})().catch(err => { console.error(err); process.exit(1); });
