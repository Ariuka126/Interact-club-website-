require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { createSupabase, checkSupabase } = require('./supabase');
const authRoutes = require('./auth');

// Render sets RENDER=true; NODE_ENV may not be set there.
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const secret = process.env.SESSION_SECRET;
if (!secret && isProd) {
  console.error('SESSION_SECRET is required in production.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Render terminates TLS in front of the app

app.use(express.json({ limit: '1mb' }));

// Sessions persist in Postgres when DATABASE_URL is set; otherwise they live in memory
// and everyone is logged out on each restart.
let store;
if (process.env.DATABASE_URL) {
  const pgSession = require('connect-pg-simple')(session);
  const { Pool } = require('pg');
  store = new pgSession({
    pool: new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }),
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });
} else if (isProd) {
  console.warn('DATABASE_URL not set: sessions are stored in memory and reset on every restart.');
}

app.use(
  session({
    name: 'ich.sid', // must match the cookie auth.js clears on logout
    secret: secret || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 2 * 60 * 60 * 1000,
    },
  })
);

const supabase = createSupabase();
app.locals.supabase = supabase;
checkSupabase(supabase).catch(e => console.error('[supabase] self-test crashed:', e)); // logs only; does not block startup

// Load the logged-in user on every request so /me works after a page refresh
// and role changes (promotions) apply immediately.
app.use(async (req, _res, next) => {
  req.user = null;
  if (req.session.userId) {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, sector')
      .eq('id', req.session.userId)
      .maybeSingle();
    if (error) console.error('[auth] user lookup failed:', error.message);
    req.user = data || null;
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', require('./admin')); // admin-only; guarded inside the router
app.use('/api/stats', require('./stats')); // live dashboard numbers; any logged-in user
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Only the public/ folder is served, so server.js, auth.js etc. are never downloadable.
app.use(express.static(path.join(__dirname, 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Interact Club Hub listening on port ${port}`));
