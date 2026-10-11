const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
const SESSION_COOKIE = 'ich.sid';

// Compared against when the email is unknown, so "no such user" and
// "wrong password" take about the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, sector: u.sector });

// A fresh session id on login/register prevents session fixation.
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save(e => (e ? reject(e) : resolve()));
    });
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword ?? req.body.confirm_password ?? '');

    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your full name (2 to 80 characters).' });
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords don't match. Please enter the same password twice." });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    // bcrypt only uses the first 72 bytes, so reject longer input instead of silently truncating
    if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password must be 72 bytes or fewer.' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const supabase = req.app.locals.supabase;
    const { data: user, error } = await supabase
      .from('users')
      .insert({ name, email, password_hash: hash, role: 'volunteer' })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw error;
    }

    await startSession(req, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const supabase = req.app.locals.supabase;
    const { data: foundUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    const user = error ? null : foundUser;
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password.' });

    await startSession(req, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });
});

// Used by the frontend on page load. Always 200 so a logged-out visit is not a console error.
router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

module.exports = router;
