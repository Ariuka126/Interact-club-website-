// Test harness: runs the REAL backend routes and the REAL page script without Express, Supabase or a browser.
//  - mini express  : routers register routes; dispatch() runs them
//  - mini supabase : an in-memory database speaking the subset of supabase-js the routes use
//  - fake browser  : a small DOM + fetch wired to the routes, so the page script can be driven like a user would
// Usage: node tests/e2e.js      (no npm install needed)
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const BASE = __dirname;
const orig = Module._load;

class MiniRouter {
  constructor() { this.layers = []; }
  use(...a) { let prefix = null; if (typeof a[0] === 'string') prefix = a.shift(); this.layers.push({ method: null, prefix, handlers: a }); }
  _r(method) { return (p, ...h) => this.layers.push({ method, handlers: h, re: new RegExp('^' + p.replace(/:[^/]+/g, '([^/]+)') + '$'), keys: (p.match(/:[^/]+/g) || []).map(k => k.slice(1)) }); }
  get(...a) { return this._r('GET')(...a); } post(...a) { return this._r('POST')(...a); }
  patch(...a) { return this._r('PATCH')(...a); } delete(...a) { return this._r('DELETE')(...a); }
  async dispatch(method, p, req, res) {
    for (const L of this.layers) {
      if (L.method === null) { if (L.prefix && !(p === L.prefix || p.startsWith(L.prefix + '/'))) continue; }
      else { if (L.method !== method) continue; const m = L.re.exec(p); if (!m) continue; req.params = Object.fromEntries(L.keys.map((k, i) => [k, m[i + 1]])); }
      for (const h of L.handlers) { let nxt = false, err = null; await h(req, res, e => { if (e) err = e; else nxt = true; }); if (err) throw err; if (!nxt) return 'handled'; }
    }
    return 'next';
  }
}
Module._load = function (r, ...a) {
  if (r === 'express') return Object.assign(() => {}, { Router: () => new MiniRouter() });
  if (r === 'express-rate-limit') return () => (_q, _r, n) => n();
  return orig.call(this, r, ...a);
};

// ---------------- in-memory supabase ----------------
const UNIQUE = { users: [['email']], signups: [['user_id', 'event_id']], hour_logs: [['user_id', 'event_id', 'day']], log_cheers: [['log_id', 'user_id']],
  treasury_ledger: [['seq'], ['reverses_id']], attendance_logs: [['meeting_id', 'user_id']], role_applications: [['role_id', 'user_id']] };
const APPEND_ONLY = new Set(['treasury_ledger', 'audit_logs']);   // the database triggers refuse every UPDATE and DELETE on these
const CASCADE = { events: [['signups', 'event_id'], ['hour_logs', 'event_id'], ['logistics_tasks', 'event_id']], hour_logs: [['log_cheers', 'log_id'], ['log_comments', 'log_id']],
  logistics_tasks: [['logistics_tasks', 'parent_id']], meetings: [['attendance_logs', 'meeting_id']], sector_roles: [['role_applications', 'role_id']] };
function makeDb(T) {
  const seq = {}, clone = o => JSON.parse(JSON.stringify(o));
  const nextId = t => (seq[t] = (seq[t] || Math.max(0, ...T[t].map(r => r.id || 0))) + 1);
  function from(name) {
    if (!T[name]) throw new Error('unknown table ' + name);
    if (T.__down) throw new Error('database is down');
    const q = { f: [], op: 'select', payload: null, cols: '*', head: false, count: false, ord: null, lim: null, rng: null, ret: false };
    const b = {
      select(c, o) { q.cols = c || '*'; if (q.op !== 'select') q.ret = true; if (o && o.head) q.head = true; if (o && o.count) q.count = true; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; }, update(p) { q.op = 'update'; q.payload = p; return b; }, delete() { q.op = 'delete'; return b; },
      eq(c, v) { q.f.push(r => r[c] === v); return b; }, neq(c, v) { q.f.push(r => r[c] !== v); return b; }, in(c, vs) { q.f.push(r => vs.includes(r[c])); return b; },
      gt(c, v) { q.f.push(r => r[c] > v); return b; }, gte(c, v) { q.f.push(r => r[c] >= v); return b; }, lt(c, v) { q.f.push(r => r[c] < v); return b; }, lte(c, v) { q.f.push(r => r[c] <= v); return b; },
      is(c, v) { q.f.push(r => (r[c] == null) === (v === null)); return b; }, not(c, op, v) { if (op === 'is' && v === null) q.f.push(r => r[c] != null); return b; },
      order(c, o) { q.ord = [c, !o || o.ascending !== false]; return b; }, limit(n) { q.lim = n; return b; }, range(a, z) { q.rng = [a, z]; return b; },
      maybeSingle() { q.single = true; return b; }, single() { q.single = true; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    const project = rows => q.cols === '*' ? rows.map(clone) : rows.map(r => Object.fromEntries(q.cols.split(',').map(s => s.trim()).map(c => [c, clone(r[c] === undefined ? null : r[c])])));
    function run() {
      const rows = T[name]; let hit = rows.filter(r => q.f.every(g => g(r)));
      if (q.op === 'insert') {
        const made = [];
        for (const it of (Array.isArray(q.payload) ? q.payload : [q.payload]).map(clone)) {
          for (const cols of (UNIQUE[name] || [])) if (!cols.some(c => it[c] == null) && rows.some(r => cols.every(c => String(r[c]).toLowerCase() === String(it[c]).toLowerCase()))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (name !== 'log_cheers') it.id = nextId(name);
          if (it.created_at === undefined && name !== 'log_cheers') it.created_at = new Date().toISOString();
          if (name === 'treasury_ledger' && it.balance_after < 0) return { data: null, error: { code: '23514', message: 'balance_after check' } };
          rows.push(it); made.push(it);
        }
        if (!q.ret) return { data: null, error: null };
        const out = project(made); return { data: q.single ? (out[0] || null) : out, error: null };
      }
      if ((q.op === 'update' || q.op === 'delete') && APPEND_ONLY.has(name)) return { data: null, error: { code: '42501', message: name + ' is append-only: ' + q.op.toUpperCase() + ' is not allowed' } };
      if (q.op === 'update') { hit.forEach(r => Object.assign(r, clone(q.payload))); if (!q.ret) return { data: null, error: null }; const o = project(hit); return { data: q.single ? (o[0] || null) : o, error: null }; }
      if (q.op === 'delete') {
        const drop = (table, row) => { const i = T[table].indexOf(row); if (i < 0) return; T[table].splice(i, 1); for (const [t, fk] of (CASCADE[table] || [])) for (const child of T[t].filter(x => x[fk] === row.id)) drop(t, child); };
        for (const r of hit) drop(name, r); return { data: null, error: null };
      }
      if (q.ord) { const [c, asc] = q.ord; hit = [...hit].sort((a, b2) => (a[c] > b2[c] ? 1 : a[c] < b2[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (q.head) return { data: null, count: hit.length, error: null };
      if (q.rng) hit = hit.slice(q.rng[0], q.rng[1] + 1); if (q.lim != null) hit = hit.slice(0, q.lim);
      const out = project(hit); const r = { data: q.single ? (out[0] || null) : out, error: null }; if (q.count) r.count = hit.length; return r;
    }
    return b;
  }
  return { from };
}

// ---------------- the backend, as a callable ----------------
const TABLES = ['users', 'events', 'signups', 'hour_logs', 'log_cheers', 'log_comments', 'audit_logs', 'treasury_ledger', 'meetings', 'attendance_logs',
  'sector_roles', 'role_applications', 'event_proposals', 'logistics_tasks', 'anonymous_feedback', 'resource_vault'];
function loadApp(T) {
  for (const t of TABLES) if (!T[t]) T[t] = [];   // the real database has every table, even when a test does not use it
  for (const k of Object.keys(require.cache)) if (k.startsWith(BASE + path.sep) && !k.includes(path.sep + 'tests' + path.sep)) delete require.cache[k];
  const GENERAL = ['bootstrap', 'events', 'hours', 'people', 'audit', 'treasury', 'attendance', 'sectorroles', 'proposals', 'logistics', 'feedback', 'vault'];
  const routers = [...GENERAL, 'admin', 'stats'].filter(f => fs.existsSync(path.join(BASE, f + '.js'))).map(f => ({ f, r: require(path.join(BASE, f + '.js')) }));
  const app = { locals: { supabase: makeDb(T) } };
  async function call(method, p, { user = null, body = {}, query = {} } = {}) {
    const out = { code: 200, json: null, text: null, buf: null, hdr: {} }; const req = { user, body, query, params: {}, app };
    const res = { status(c) { out.code = c; return res; }, json(j) { out.json = j; return res; }, set(k, v) { if (typeof k === 'object') Object.assign(out.hdr, k); else out.hdr[k] = v; return res; },
      type(t) { out.hdr['Content-Type'] = t; return res; }, send(x) { if (Buffer.isBuffer(x)) out.buf = x; else out.text = x; return res; } };
    const prefix = p.startsWith('/api/admin') ? '/api/admin' : p.startsWith('/api/stats') ? '/api/stats' : '/api';
    const rel = p.slice(prefix.length) || '/';
    const wanted = prefix === '/api/admin' ? ['admin'] : prefix === '/api/stats' ? ['stats'] : GENERAL;
    try {
      let handled = false;
      for (const { f, r } of routers) { if (!wanted.includes(f)) continue; if (await r.dispatch(method, rel, req, res) === 'handled') { handled = true; break; } }
      if (!handled) { out.code = 404; out.json = { error: 'no route ' + method + ' ' + p }; }
    } catch (e) { out.code = 500; out.json = { error: String((e && e.message) || e) }; }
    return out;
  }
  return { call, T };
}

// ---------------- a browser running the real page ----------------
function makeBrowser(app, T, startUser) {
  const stores = { '#app': { innerHTML: '' }, '#modal': { innerHTML: '' }, '#toast': { textContent: '', hidden: true } };
  const vals = new Map(), checks = new Map(), els = new Map(), handlers = {}, timers = [], fields = new Map();
  const state = { inflight: 0, user: startUser, href: null, printed: false, copied: null, pos: { latitude: 47.9184, longitude: 106.9177, accuracy: 12 }, geoDenied: false, calls: [], toasts: [], authCalls: [], focused: null, requestGates: new Map() };
  const html = () => stores['#app'].innerHTML + stores['#modal'].innerHTML;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagOf = id => (new RegExp('<(?:input|select|textarea)[^>]*\\bid="' + esc(id) + '"[^>]*>').exec(html()) || [])[0];
  const mkEl = id => ({ id, textContent: '', innerHTML: '', style: {}, hidden: false, disabled: false, dataset: {}, firstChild: null, srcObject: null,
    get value() { if (vals.has(id)) return vals.get(id); const t = tagOf(id), m = t && /\bvalue="([^"]*)"/.exec(t); return m ? m[1] : ''; }, set value(v) { vals.set(id, String(v)); },
    get checked() { if (checks.has(id)) return checks.get(id); const t = tagOf(id); return !!t && /\bchecked\b/.test(t); }, set checked(v) { checks.set(id, !!v); },
    focus() {}, select() {}, closest() { return null; }, querySelectorAll() { return []; } });
  const q = sel => { if (stores[sel]) return stores[sel]; if (!sel.startsWith('#')) return null; const id = sel.slice(1); if (!new RegExp('\\bid="' + esc(id) + '"').test(html())) return null; if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  const document = { querySelector: q, querySelectorAll: () => [], addEventListener: (t, f) => (handlers[t] = handlers[t] || []).push(f),
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, fillText() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==' }) };
  const navigator = { clipboard: { writeText: t => { state.copied = t; return Promise.resolve(); } }, mediaDevices: undefined,
    geolocation: { getCurrentPosition: (ok, err) => setImmediate(() => state.geoDenied ? err({ code: 1 }) : ok({ coords: state.pos })) } };
  const location = { set href(v) { state.href = v; } };
  const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, sector: u.sector });
  const resp = (code, data) => ({ ok: code < 400, status: code, json: async () => (data && typeof data === 'object' ? data : {}), text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });
  async function fetchFn(url, opts = {}) {
    state.inflight++;
    try {
      const method = (opts.method || 'GET').toUpperCase(), [p, qs] = url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''));
      state.calls.push(method + ' ' + p);
      if (p === '/api/auth/me') { const u = state.user && T.users.find(x => x.id === state.user.id); return resp(200, { user: u ? pub(u) : null }); }
      if (p === '/api/auth/logout') { state.user = null; return resp(200, { ok: true }); }
      if (p === '/api/auth/register' || p === '/api/auth/login') {      // auth.js needs bcrypt, so the form's own requests are stood in for here
        const body = JSON.parse(opts.body); state.authCalls.push({ path: p, body });
        if (p === '/api/auth/register') { const u = { id: Math.max(0, ...T.users.map(x => x.id)) + 1, name: body.name, email: body.email, role: 'volunteer', sector: null, password_hash: 'x', promotion_requested: 0, created_at: new Date().toISOString() }; T.users.push(u); state.user = u; return resp(201, { user: pub(u) }); }
        const u = T.users.find(x => x.email === body.email); if (!u) return resp(401, { error: 'Invalid email or password.' }); state.user = u; return resp(200, { user: pub(u) });
      }
      const requestGate = state.requestGates.get(method + ' ' + p);
      if (requestGate) await requestGate;
      const row = state.user && T.users.find(x => x.id === state.user.id);   // the server re-reads the user on every request
      const out = await app.call(method, p, { user: row ? pub(row) : null, body: opts.body ? JSON.parse(opts.body) : {}, query });
      return resp(out.code, out.json !== null ? out.json : out.text);
    } finally { state.inflight--; }
  }
  const ctx = vm.createContext({ document, navigator, location, fetch: fetchFn, console, setTimeout, clearTimeout, setInterval: f => { timers.push(f); return timers.length; },
    confirm: () => true, window: { print() { state.printed = true; } },
    FormData: class { constructor() { this.e = [...html().matchAll(/<input[^>]*\bname="([^"]+)"/g)].map(m => [m[1], fields.get(m[1]) || '']); } [Symbol.iterator]() { return this.e[Symbol.iterator](); } } });
  const page = fs.readFileSync(path.join(BASE, 'public', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(page + `;globalThis.__X={get S(){return S},get M(){return M},get E(){return E},get L(){return L},get ME(){return ME},get CI(){return CI},get DATA(){return DATA},get MOD(){return MOD},
    get LIVE(){return LIVE},get CERT(){return CERT},get EXPORT(){return EXPORT},A,IN_,CH,render,loadAll,qrFetch,qrPaint,ciValid,steps,VIEW,reload}`, ctx);
  const X = ctx.__X, sleep = () => new Promise(r => setImmediate(r));
  const b = {
    X, state,
    async settle() { let idle = 0; for (let i = 0; i < 400 && idle < 4; i++) { await sleep(); idle = state.inflight === 0 ? idle + 1 : 0; } },
    el: q, html, app: () => stores['#app'].innerHTML, modal: () => stores['#modal'].innerHTML,
    text: () => html().replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' '),
    toast: () => stores['#toast'].textContent,
    setField: (name, v) => fields.set(name, String(v)), fieldNames: () => [...html().matchAll(/<input[^>]*\bname="([^"]+)"/g)].map(m => m[1]),
    async submit() { const mode = (/data-mode="(\w+)"/.exec(html()) || [])[1]; const btn = { disabled: false };
      const f = { dataset: { mode }, querySelector: s => (s === '[type=submit]' ? btn : s === '[name=confirm]' ? { focus() { state.focused = 'confirm'; } } : null), closest: () => f };
      let prevented = false; await Promise.all((handlers.submit || []).map(h => h({ target: f, preventDefault() { prevented = true; } }))); await b.settle(); return { btn, prevented }; },
    setVal: (id, v) => vals.set(id, String(v)), setChecked: (id, v) => checks.set(id, !!v),
    async act(name, dataset = {}) { const btn = { dataset, disabled: false, textContent: '', closest: () => null }; const r = X.A[name](dataset, btn); if (r && r.then) await r; await b.settle(); },
    async click(name, dataset = {}) { const t = { dataset: { act: name, ...dataset }, closest: s => (s === '[data-act]' ? t : null), disabled: false, textContent: '' }; for (const h of handlers.click) h({ target: t }); await b.settle(); },
    async go(role, tab) { X.S.role = role; if (tab) X.S.tab[role] = tab; X.render(); await b.settle(); },
    tick() { timers.forEach(f => f()); },
    async logout() { state.user = null; },
  };
  return b;
}
async function openAs(app, T, user) { const b = makeBrowser(app, T, user); await b.settle(); return b; }

module.exports = { loadApp, makeDb, makeBrowser, openAs, BASE };
