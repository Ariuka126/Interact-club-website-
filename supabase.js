const { createClient } = require('@supabase/supabase-js');

const clean = (v = '') => v.trim().replace(/^['"]+|['"]+$/g, '').trim();

// Server-side client. Use the service_role key (kept secret in Render env vars,
// never sent to the browser). The anon key is only a fallback so an old deploy still boots.
function createSupabase() {
  let url = clean(process.env.SUPABASE_URL);
  let key = clean(process.env.SUPABASE_SERVICE_KEY);

  if (!key) {
    key = clean(process.env.SUPABASE_ANON_KEY);
    if (key) console.warn('SUPABASE_SERVICE_KEY not set: falling back to the anon key. Inserts may fail under row-level security.');
  }
  if (!url) throw new Error('SUPABASE_URL is required.');
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is required.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

module.exports = { createSupabase };
