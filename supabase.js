const dns = require('dns').promises;
const { createClient } = require('@supabase/supabase-js');

const clean = (v = '') => v.trim().replace(/^['"]+|['"]+$/g, '').trim();

// Reads and validates the env vars. Throws with a clear message instead of failing later inside fetch().
function resolveConfig() {
  let url = clean(process.env.SUPABASE_URL);
  let key = clean(process.env.SUPABASE_SERVICE_KEY);

  if (!key) {
    key = clean(process.env.SUPABASE_ANON_KEY);
    if (key) console.warn('[supabase] SUPABASE_SERVICE_KEY not set: falling back to the anon key. Inserts may fail under row-level security.');
  }
  if (!url) throw new Error('SUPABASE_URL is required.');
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is required.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Zero-width or other invisible characters survive trim() and look identical in logs,
  // but make the hostname unresolvable (ENOTFOUND).
  const bad = [...url].filter(ch => ch.charCodeAt(0) < 0x21 || ch.charCodeAt(0) > 0x7e);
  if (bad.length) {
    throw new Error(`SUPABASE_URL contains hidden characters (codes: ${bad.map(c => c.charCodeAt(0)).join(', ')}). Re-type it in Render.`);
  }

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`SUPABASE_URL is not a valid URL: ${JSON.stringify(url)}`); }
  if (parsed.pathname !== '/' ) console.warn(`[supabase] SUPABASE_URL has a path (${parsed.pathname}). It should be just https://<ref>.supabase.co`);
  if (!/^[a-z0-9]{20}\.supabase\.(co|red)$/.test(parsed.hostname)) {
    console.warn(`[supabase] Host ${JSON.stringify(parsed.hostname)} does not look like <20-character-project-ref>.supabase.co. Compare it with Project Settings > API.`);
  }
  return { url: parsed.origin, key };
}

function createSupabase() {
  const { url, key } = resolveConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Startup self-test: DNS first, then a real query. Logs the result; never logs keys.
async function checkSupabase(supabase) {
  const { url } = resolveConfig();
  const host = new URL(url).hostname;
  try {
    const addrs = await dns.lookup(host, { all: true });
    console.log(`[supabase] DNS ok for ${host} -> ${addrs.map(a => a.address).join(', ')}`);
  } catch (e) {
    console.error(`[supabase] DNS lookup FAILED for ${JSON.stringify(host)} (${e.code}). Check the project ref in SUPABASE_URL, and that the project is not paused or deleted.`);
    return false;
  }
  const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' }).limit(1);
  if (error) {
    console.error('[supabase] Query failed:', error.message, error.details || '', error.hint || '');
    return false;
  }
  console.log('[supabase] Connected; users table reachable.');
  return true;
}

module.exports = { createSupabase, checkSupabase, resolveConfig };
