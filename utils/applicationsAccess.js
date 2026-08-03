const APPLICATIONS_ACCESS_EMAILS = new Set([
  'robert.manzanillag@gmail.com',
  'paloma.rodriguez.filini@gmail.com'
]);

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function hasApplicationsAccess(user) {
  if (!user) return false;

  return user.isAdmin === true ||
    user.role === 'admin' ||
    APPLICATIONS_ACCESS_EMAILS.has(normalizeEmail(user.email));
}

export function requireApplicationsAccess(req, res, next) {
  const sessionUser = req.session?.user;
  const user = sessionUser || (req.session?.userId ? { email: req.session.userId } : null);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!hasApplicationsAccess(user)) {
    return res.status(403).json({ error: 'Applications access required' });
  }

  next();
}
