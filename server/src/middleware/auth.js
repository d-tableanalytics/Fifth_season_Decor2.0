import jwt from 'jsonwebtoken';
import { loadAccess, can } from '../services/access.js';

export const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Session expired, please log in again' });
  }

  const user = await loadAccess(payload.id);
  if (!user) return res.status(401).json({ message: 'User no longer exists' });
  if (!user.isActive) return res.status(401).json({ message: 'Your account has been deactivated' });

  req.user = user;
  next();
};

/** Route guard passing if the user has ANY of the actions: requireAnyPermission('inventory', ['create', 'edit']) */
export const requireAnyPermission = (moduleKey, actions) => (req, res, next) => {
  if (!actions.some((a) => can(req.user, moduleKey, a))) {
    return res.status(403).json({ message: 'You do not have permission to perform this action' });
  }
  next();
};

/** Route guard: requirePermission('employees', 'create') */
export const requirePermission = (moduleKey, action = 'view') => (req, res, next) => {
  if (!can(req.user, moduleKey, action)) {
    return res.status(403).json({ message: 'You do not have permission to perform this action' });
  }
  next();
};
