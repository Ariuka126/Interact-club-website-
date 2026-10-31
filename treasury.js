const express = require('express');
const { requireAuth } = require('./middleware');
const K = require('./lib');
const { audit } = require('./audit');

const router = express.Router();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const COLS = 'id, seq, entry_type, amount, category, description, reference_url, balance_after, reverses_id, created_by_name, created_at';

// The Presidents and the Finance Head, nobody else. A 403 also tells nobody the balance.
router.use('/treasury', requireAuth, (req, res, next) =>
  K.canTreasury(req.user) ? next() : bad(res, 'The treasury is visible to the Presidents and the Finance Head only.', 403));

const signed = r => (r.entry_type === 'income' ? 1 : -1) * K.cents(r.amount);

function summarize(rows) {
  let run = 0, income = 0, expense = 0, badSeq = null;
  for (const r of rows) {
    run += signed(r);
    if (r.entry_type === 'income') income += K.cents(r.amount); else expense += K.cents(r.amount);
    if (badSeq === null && K.cents(r.balance_after) !== run) badSeq = r.seq;
  }
  return { balance: run / 100, income: income / 100, expense: expense / 100, integrity: { ok: badSeq === null, badSeq } };
}

router.get('/treasury', async (req, res, next) => {
  try {
    const sb = req.app.locals.supabase;
    const rows = await K.fetchAll(() => sb.from('treasury_ledger').select(COLS).order('seq'));
    const reversed = new Set(rows.filter(r => r.reverses_id).map(r => r.reverses_id));
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    res.set('Cache-Control', 'no-store');
    res.json({
      ...summarize(rows), count: rows.length,
      entries: rows.slice(-limit).reverse().map(r => ({ ...r, reversed: reversed.has(r.id) })),
    });
  } catch (err) { next(err); }
});

async function append(sb, user, { type, amount, category, description, reference, reversesId }) {
  const cents = K.cents(amount);
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await K.fetchAll(() => sb.from('treasury_ledger').select('seq, entry_type, amount, reverses_id').order('seq'));
    if (reversesId && rows.some(r => r.reverses_id === reversesId)) return { status: 409, error: 'That entry was already reversed.' };
    const balance = rows.reduce((a, r) => a + signed(r), 0);
    const next = balance + (type === 'income' ? cents : -cents);
    if (next < 0) return { status: 409, error: `Not enough money: the balance is ${(balance / 100).toFixed(2)}, so ${(cents / 100).toFixed(2)} cannot be spent.` };
    const seq = rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
    const { data, error } = await sb.from('treasury_ledger').insert({
      seq, entry_type: type, amount: cents / 100, category, description, reference_url: reference || null,
      balance_after: next / 100, reverses_id: reversesId || null, created_by: user.id, created_by_name: user.name,
    }).select(COLS).maybeSingle();
    if (!error) return { entry: data, balance: next / 100 };
    if (error.code !== '23505') throw error;
  }
  return { status: 409, error: 'The ledger is busy. Try again in a moment.' };
}

router.post('/treasury', async (req, res, next) => {
  try {
    const b = req.body || {}, u = req.user;
    if (!['income', 'expense'].includes(b.type)) return bad(res, 'Choose income or expense.');
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(K.cents(amount) / 100 - amount) > 1e-9) {
      return bad(res, 'Amount must be more than 0, at most 1,000,000, with at most 2 decimals.');
    }
    const category = K.str(b.category, 1, 60), description = K.str(b.description, 1, 200);
    if (!category) return bad(res, 'Add a category (up to 60 characters).');
    if (!description) return bad(res, 'Add a description (up to 200 characters).');
    let reference = null;
    if (b.reference) { reference = K.normalizeLink(b.reference); if (!reference) return bad(res, 'The receipt link must be a web address.'); }
    const sb = req.app.locals.supabase;
    const r = await append(sb, u, { type: b.type, amount, category, description, reference });
    if (r.error) return bad(res, r.error, r.status);
    await audit(sb, u, 'treasury.' + b.type, 'treasury', r.entry.seq, { amount, category, description, balance_after: r.balance });
    res.status(201).json({ entry: r.entry, balance: r.balance });
  } catch (err) { next(err); }
});

router.post('/treasury/:id/reverse', async (req, res, next) => {
  try {
    const id = K.toId(req.params.id), u = req.user;
    if (!id) return bad(res, 'Invalid entry.');
    const reason = K.str((req.body || {}).reason, 5, 120);
    if (!reason) return bad(res, 'Say why (5 to 120 characters).');
    const sb = req.app.locals.supabase;
    const { data: orig, error } = await sb.from('treasury_ledger').select(COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!orig) return bad(res, 'Entry not found.', 404);
    if (orig.reverses_id) return bad(res, 'A reversal cannot be reversed. Add a new entry instead.', 409);
    const r = await append(sb, u, {
      type: orig.entry_type === 'income' ? 'expense' : 'income', amount: orig.amount, category: 'Reversal',
      description: `Reversal of #${orig.seq}: ${reason}`, reversesId: orig.id,
    });
    if (r.error) return bad(res, r.error, r.status);
    await audit(sb, u, 'treasury.reverse', 'treasury', r.entry.seq, { reverses_seq: orig.seq, amount: orig.amount, reason, balance_after: r.balance });
    res.status(201).json({ entry: r.entry, balance: r.balance });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.summarize = summarize;