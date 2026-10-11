// Role checks use req.user, which server.js reloads from the database on every request.
// That means a demoted admin loses access immediately, instead of keeping a stale role
// stored in their session until they log out.
const norm = r => String(r || '').toLowerCase();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

function requireRole(...roles) {
  const allowed = roles.map(norm);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    if (!allowed.includes(norm(req.user.role))) return res.status(403).json({ error: 'You do not have access to this.' });
    next();
  };
}

const requireAdmin = requireRole('admin');
// Ready for the event and approval routes: requireRole('pres', 'admin')

module.exports = { requireAuth, requireRole, requireAdmin };
