import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db, { getSetting, setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { clearDiscoveryCache, getRedirectUri } from '../oidc.js';
import { isValidEmail } from '../validate.js';
import { cachePurgeUser } from '../cache.js';

const router = Router();
const SALT_ROUNDS = 12;

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
  if (!email || !isValidEmail(email)) {
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
    SELECT id, username, email, display_name, role, active, auth_provider, created_at,
      oidc_sub IS NOT NULL AS sso_linked
    FROM users ORDER BY created_at ASC
  `).all() as { sso_linked: number }[];

  // Rattachements SSO visibles : sans cela, une identité rattachée à un compte
  // (par l'ancien rattachement d'office, ou par une session volée) ne se
  // voyait nulle part.
  res.json({ users: users.map((u) => ({ ...u, sso_linked: !!u.sso_linked })) });
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

  // Types stricts : la garde ci-dessous teste `active === false`, alors que
  // l'écriture désactive pour toute valeur fausse — `{"active":0}` passait,
  // et un admin seul rendait l'instance sans administrateur.
  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  if (role !== undefined && typeof role !== 'string') {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Un rôle fourni est l'un des deux, chaîne vide comprise : `role && …`
  // laissait passer `""`, que `COALESCE` écrivait tel quel — l'admin seul
  // retirait ainsi le dernier rôle d'administrateur.
  if (role !== undefined && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Prevent self-demotion from admin
  if (Number(id) === req.user.id && role !== undefined && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot remove your own admin role' });
  }

  // Prevent disabling yourself
  if (Number(id) === req.user.id && active === false) {
    return res.status(400).json({ error: 'Cannot disable your own account' });
  }

  // Validate email if provided (non-empty)
  if (email !== undefined && email !== null && email !== '' && !isValidEmail(email)) {
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

// ── DELETE /api/admin/users/:id/sso ─────────────────────────────────
// Délier l'identité SSO d'un compte local. Un compte qui n'a que le SSO n'a
// pas de mot de passe : le délier le fermerait, il se supprime à la place.
router.delete('/users/:id/sso', (req, res) => {
  const user = db.prepare('SELECT auth_provider FROM users WHERE id = ?').get(req.params.id) as { auth_provider: string } | undefined;
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.auth_provider !== 'local') return res.status(400).json({ error: 'Only a local account can be unlinked' });
  // Toutes les sessions du compte se ferment (voir `DELETE /api/auth/oidc/link`) :
  // rien ne distingue celles que l'identité déliée a ouvertes. Sauf celle de
  // l'admin s'il délie son propre compte.
  db.transaction(() => {
    db.prepare('UPDATE users SET oidc_sub = NULL WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.params.id, req.token);
  })();
  console.log('[oidc] admin id=%s unlinked the SSO identity of account id=%s', req.user.id, req.params.id);
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
  void cachePurgeUser(id); // ses listes en cache partent avec lui

  res.json({ ok: true });
});

// ── GET /api/admin/settings ─────────────────────────────────────────
router.get('/settings', (req, res) => {
  res.json({
    settings: {
      registrationEnabled: getSetting('registration_enabled') === 'true',
      oidcEnabled: getSetting('oidc_enabled') === 'true',
      ssoOnly: getSetting('oidc_sso_only') === 'true',
      // The OIDC callback URL the admin must whitelist in their IdP (Authentik…).
      redirectUri: getRedirectUri(req),
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
  const { registrationEnabled, oidcEnabled, ssoOnly, oidcIssuer, oidcClientId, oidcClientSecret, oidcButtonLabel, loginAnimation } = req.body;

  if (registrationEnabled !== undefined) {
    setSetting('registration_enabled', registrationEnabled ? 'true' : 'false');
  }
  if (ssoOnly !== undefined) {
    setSetting('oidc_sso_only', ssoOnly ? 'true' : 'false');
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
