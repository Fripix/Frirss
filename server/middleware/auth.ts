import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import db, { getJwtSecret } from '../db.js';
import type { AuthedUser } from '../types.js';

/**
 * JWT authentication middleware.
 * Expects: Authorization: Bearer <token>
 * Sets req.user = { id, username, role, active }
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token required' });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: number };

    // Check session still exists in DB
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as { expires_at: string } | undefined;
    if (!session) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return res.status(401).json({ error: 'Session expired' });
    }

    // Fetch user
    const user = db.prepare('SELECT id, username, email, display_name, role, active, auth_provider FROM users WHERE id = ?').get(payload.userId) as AuthedUser | undefined;
    if (!user || !user.active) {
      return res.status(403).json({ error: 'Account disabled' });
    }

    req.user = user;
    req.token = token;

    // Track activity for the optional background sync worker. Throttled to at
    // most once / 5 min per user to avoid a write on every request.
    db.prepare(
      `UPDATE users SET last_active_at = datetime('now')
       WHERE id = ? AND (last_active_at IS NULL OR last_active_at < datetime('now','-5 minutes'))`
    ).run(user.id);

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Admin-only middleware. Must be used AFTER requireAuth.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
