// Creates the first ADMIN account in Supabase. Nothing else: no fake volunteers, no fake hour logs,
// and every timestamp comes from the database defaults (CURRENT_TIMESTAMP, the same as NOW()).
// Usage: set SEED_PRESIDENT_* (name/email/password of the admin) plus the Supabase vars, then `node seed.js`.
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

  console.log('Done. No sample data is inserted: events, sign-ups and hours are created in the app.');
})().catch(err => { console.error(err); process.exit(1); });
