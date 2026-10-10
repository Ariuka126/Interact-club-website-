require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');

const { db, initSchema } = require('./db');
const { attachUser } = require('./middleware/auth');

const isProd = process.env.NODE_ENV === 'production';

let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (isProd) {
    console.error('SESSION_SECRET is required in production.');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set: using a temporary one. Everyone is logged out on each restart.');
}

initSchema();

const app = express();
if (isProd) app.set('trust proxy', 1); // needed for secure cookies behind Render/Fly/nginx etc.

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // The prototype keeps its JS inline. Moving it to public/app.js lets you drop 'unsafe-inline'.
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
  })
);

app.use(express.json({ limit: '1mb' })); // raise later when photo uploads arrive

app.use(
  session({
    name: 'ich.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(attachUser);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Interact Club Hub running at http://localhost:${port}`));
