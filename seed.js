// Creates the first Co-President and loads the prototype's sample events.
// Usage: set SEED_PRESIDENT_* in .env, then `npm run db:seed`.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { db, initSchema } = require('./db');

initSchema();

const { SEED_PRESIDENT_NAME: name, SEED_PRESIDENT_EMAIL: email, SEED_PRESIDENT_PASSWORD: pw } = process.env;
if (!name || !email || !pw || pw.length < 8) {
  console.error('Set SEED_PRESIDENT_NAME, SEED_PRESIDENT_EMAIL and SEED_PRESIDENT_PASSWORD (8+ chars) in .env first.');
  process.exit(1);
}

const hash = bcrypt.hashSync(pw, 12);
const info = db
  .prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'pres')
            ON CONFLICT(email) DO NOTHING`)
  .run(name.trim(), email.trim().toLowerCase(), hash);
console.log(info.changes ? `Created Co-President ${email}` : `User ${email} already exists, left unchanged`);

if (db.prepare('SELECT COUNT(*) AS n FROM events').get().n === 0) {
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
  const ins = db.prepare(`INSERT INTO events
    (title, sector, hours, capacity, volunteer_slots, location, date_label, type, verification,
     shifts, points, days, waiver_required, is_setup, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const [t, s, h, c, v, loc, d, ty, ver, x] of events) {
      ins.run(t, s, h, c, v, loc, d, ty, JSON.stringify(ver),
        x.shifts ? JSON.stringify(x.shifts) : null, x.points ? JSON.stringify(x.points) : null,
        x.days || null, x.waiver || 0, x.setup || 0, x.active || 0);
    }
  })();
  console.log(`Seeded ${events.length} sample events`);
}
