require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
app.locals.supabase = supabase;

app.use(express.static('.'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Interact Club Hub listening on port ${port}`);
});
