import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { getSetting, setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { clearDiscoveryCache } from '../oidc.js';

const router = Router();
const SALT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// All routes require admin
router.use(requireAuth, requireAdmin);

// ── POST /api/admin/users ───────────────────────────────────────────
// Admin manually creates a local account (bypasses the registration toggle)
router.post('/users', async (req, res) => {
  const { username, password, email, displayName, role } = req.body;

  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const result = db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, role, auth_provider)
    VALUES (?, ?, ?, ?, ?, 'local')
  `).run(username, email, hash, displayName || username, role === 'admin' ? 'admin' : 'user');

  const user = db.prepare(`
    SELECT id, username, email, display_name, role, active, auth_provider, created_at
    FROM users WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ user });
});

// ── GET /api/admin/users ────────────────────────────────────────────
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, display_name, role, active, auth_provider, created_at
    FROM users ORDER BY created_at ASC
  `).all();

  res.json({ users });
});

// ── PUT /api/admin/users/:id ────────────────────────────────────────
// Update user role or active status
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { role, active, displayName, email } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent self-demotion from admin
  if (Number(id) === req.user.id && role && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot remove your own admin role' });
  }

  // Prevent disabling yourself
  if (Number(id) === req.user.id && active === false) {
    return res.status(400).json({ error: 'Cannot disable your own account' });
  }

  // Validate role
  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Validate email if provided (non-empty)
  if (email !== undefined && email !== null && email !== '' && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  db.prepare(`
    UPDATE users
    SET role = COALESCE(?, role),
        active = COALESCE(?, active),
        display_name = COALESCE(?, display_name),
        email = COALESCE(?, email)
    WHERE id = ?
  `).run(
    role ?? null,
    active !== undefined ? (active ? 1 : 0) : null,
    displayName ?? null,
    email ?? null,
    id
  );

  // If user was deactivated, remove their sessions
  if (active === false) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  const updated = db.prepare(`
    SELECT id, username, email, display_name, role, active, auth_provider, created_at
    FROM users WHERE id = ?
  `).get(id);

  res.json({ user: updated });
});

// ── PUT /api/admin/users/:id/password ───────────────────────────────
// Admin sets a new password for a local user
router.put('/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT id, auth_provider FROM users WHERE id = ?').get(id) as { id: number; auth_provider: string } | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (user.auth_provider !== 'local') {
    return res.status(400).json({ error: 'SSO users have no password' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);

  // Force re-login everywhere except the admin's current session
  if (Number(id) === req.user.id) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, req.token);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  res.json({ ok: true });
});

// ── DELETE /api/admin/users/:id ─────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;

  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // CASCADE will remove sessions, servers, preferences
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.json({ ok: true });
});

// ── GET /api/admin/settings ─────────────────────────────────────────
router.get('/settings', (req, res) => {
  res.json({
    settings: {
      registrationEnabled: getSetting('registration_enabled') === 'true',
      oidcEnabled: getSetting('oidc_enabled') === 'true',
      oidcIssuer: getSetting('oidc_issuer') || '',
      oidcClientId: getSetting('oidc_client_id') || '',
      // Don't expose oidc_client_secret
      oidcButtonLabel: getSetting('oidc_button_label') || 'Authentik',
      loginAnimation: getSetting('login_animation') || 'portal',
    },
  });
});

// ── PUT /api/admin/settings ─────────────────────────────────────────
const LOGIN_ANIMATIONS = ['none', 'portal', 'scanline'];

router.put('/settings', (req, res) => {
  const { registrationEnabled, oidcEnabled, oidcIssuer, oidcClientId, oidcClientSecret, oidcButtonLabel, loginAnimation } = req.body;

  if (registrationEnabled !== undefined) {
    setSetting('registration_enabled', registrationEnabled ? 'true' : 'false');
  }
  if (loginAnimation !== undefined) {
    if (!LOGIN_ANIMATIONS.includes(loginAnimation)) {
      return res.status(400).json({ error: 'Invalid login animation' });
    }
    setSetting('login_animation', loginAnimation);
  }
  if (oidcEnabled !== undefined) {
    setSetting('oidc_enabled', oidcEnabled ? 'true' : 'false');
  }
  if (oidcIssuer !== undefined) {
    setSetting('oidc_issuer', oidcIssuer);
  }
  if (oidcClientId !== undefined) {
    setSetting('oidc_client_id', oidcClientId);
  }
  if (oidcClientSecret !== undefined) {
    setSetting('oidc_client_secret', oidcClientSecret);
  }
  if (oidcButtonLabel !== undefined) {
    setSetting('oidc_button_label', oidcButtonLabel);
  }

  // Issuer may have changed → invalidate cached discovery document
  clearDiscoveryCache();

  res.json({ ok: true });
});

export default router;
