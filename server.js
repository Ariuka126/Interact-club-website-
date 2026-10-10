require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const authRoutes = require('./auth');

const app = express();
app.set('trust proxy', 1);

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'interact-club-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 7200000
  }
}));

const sanitizeEnvironmentValue = (value = '') =>
  value.trim().replace(/^['"]+|['"]+$/g, '').trim();

let supabaseUrl = sanitizeEnvironmentValue(process.env.SUPABASE_URL);
const supabaseKey = sanitizeEnvironmentValue(process.env.SUPABASE_ANON_KEY);

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL is required.');
}
if (!supabaseKey) {
  throw new Error('SUPABASE_ANON_KEY is required.');
}

if (!/^https?:\/\//i.test(supabaseUrl)) {
  supabaseUrl = `https://${supabaseUrl}`;
}

console.log('Initializing Supabase with URL:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);
app.locals.supabase = supabase;

app.use(authRoutes);
app.use(express.static('.'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Interact Club Hub listening on port ${port}`);
});
4