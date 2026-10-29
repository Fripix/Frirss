import { Router } from 'express';
import type { Request, Response, CookieOptions } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import rateLimit from 'express-rate-limit';
import db, { getSetting, getJwtSecret, userCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getOidcConfig, getDiscovery, getRedirectUri, isOidcEnabled, oidcFetch } from '../oidc.js';
import { parseCookieHeader } from '../cookies.js';
import { isValidEmail, rateLimitIpKey } from '../validate.js';

const router = Router();
const SALT_ROUNDS = 12;
// Comparé quand le nom n'existe pas, pour que la réponse coûte le même temps.
const DUMMY_HASH = bcrypt.hashSync('frirss-no-such-user', SALT_ROUNDS);
const SESSION_DAYS = 30;

// Throttle credential endpoints to slow down brute-force / credential-stuffing.
// 10 attempts per IP per 15 min; successful logins don't count against the limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Une IPv6 par /56 : sinon chaque adresse de sa /64 donnait un seau neuf.
  keyGenerator: (req) => rateLimitIpKey(req.ip),
  message: { error: 'Too many attempts, please try again later' },
});

// Changer son mot de passe : un mot de passe actuel se devine depuis une
// session restée ouverte, comme à la connexion. Même plafond, mais compté par
// COMPTE (après `requireAuth`) : c'est lui qu'on protège, et un seau par
// adresse serait partagé avec les connexions de tout le réseau local.
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `user:${(req as { user?: { id?: number } }).user?.id ?? ''}`,
  message: { error: 'Too many attempts, please try again later' },
});


// ── OIDC PKCE / nonce helpers ───────────────────────────────────────
const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// HttpOnly cookie options for the short-lived OIDC handshake values
function oidcCookieOpts(req: Request): CookieOptions {
  return {
    httpOnly: true,
    secure: req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax', // allow cookie on the top-level redirect back from the provider
    path: '/api/auth',
    maxAge: 5 * 60 * 1000, // 5 minutes
  };
}

interface LocalUserRow {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  role: string;
  active: number;
  auth_provider: string;
  oidc_sub: string | null;
}

// ── POST /api/auth/register ─────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, displayName, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    // Check if registration is allowed (first user always allowed)
    const count = userCount();
    if (count > 0 && getSetting('registration_enabled') !== 'true') {
      return res.status(403).json({ error: 'Registration is disabled' });
    }

    // Check duplicate username
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Recompté APRÈS le hachage, sans plus aucun `await` jusqu'à l'insertion :
    // deux inscriptions simultanées sur une base vide lisaient toutes deux
    // « zéro » avant de hacher, et devenaient toutes deux admin.
    const countNow = userCount();
    if (countNow > 0 && getSetting('registration_enabled') !== 'true') {
      return res.status(403).json({ error: 'Registration is disabled' });
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // First user = admin
    const role = countNow === 0 ? 'admin' : 'user';

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, display_name, role, auth_provider)
      VALUES (?, ?, ?, ?, ?, 'local')
    `).run(username, email, hash, displayName || username, role);

    const userId = result.lastInsertRowid;

    // Create session
    const { token, expiresAt } = createSession(userId);

    // `auth_provider` : le client en a besoin pour proposer « Changer le mot de passe ».
    const user = db.prepare('SELECT id, username, email, display_name, role, auth_provider FROM users WHERE id = ?').get(userId);

    res.status(201).json({
      token,
      expiresAt,
      user,
      isFirstUser: countNow === 0,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare(`
      SELECT id, username, email, display_name, password_hash, role, active, auth_provider, oidc_sub
      FROM users WHERE username = ? AND auth_provider = 'local'
    `).get(username) as LocalUserRow | undefined;

    // Même travail, que le nom existe ou non, et « compte désactivé » seulement
    // après le bon mot de passe : sinon la réponse (et son délai, ~250 ms de
    // bcrypt en moins) disait à n'importe qui quels noms existent.
    // Un compte sans hachage passe aussi par le factice, pour le même délai,
    // mais n'est jamais valide : le mot de passe du factice est public.
    const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.password_hash || !valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Account disabled' });
    }

    const { token, expiresAt } = createSession(user.id);

    res.json({
      token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        // Le client en a besoin pour proposer « Changer le mot de passe ».
        auth_provider: user.auth_provider,
        // … et « Lier au SSO » à un compte qui ne l'est pas encore.
        sso_linked: !!user.oidc_sub,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

// ── GET /api/auth/me ────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  // `sso_linked` : le client propose « Lier au SSO » seulement s'il ne l'est pas.
  const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(req.user.id) as { oidc_sub: string | null } | undefined;
  res.json({ user: { ...req.user, sso_linked: !!row?.oidc_sub } });
});

// ── POST /api/auth/change-password ──────────────────────────────────
router.post('/change-password', requireAuth, passwordLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Only local users can change password
    if (req.user.auth_provider !== 'local') {
      return res.status(400).json({ error: 'SSO users cannot change password here' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as { password_hash: string } | undefined;
    const valid = user ? await bcrypt.compare(currentPassword, user.password_hash) : false;
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

    // Invalidate all other sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.token);

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/status ────────────────────────────────────────────
// Public: returns whether the app has any users yet + registration status
router.get('/status', (req, res) => {
  const count = userCount();
  res.json({
    hasUsers: count > 0,
    registrationEnabled: count === 0 || getSetting('registration_enabled') === 'true',
    loginAnimation: getSetting('login_animation') || 'portal',
  });
});

// ── GET /api/auth/oidc/config ───────────────────────────────────────
// Public: returns whether SSO is enabled + the button label
router.get('/oidc/config', (req, res) => {
  const cfg = getOidcConfig();
  res.json({
    enabled: cfg.enabled,
    buttonLabel: cfg.buttonLabel,
    // Only advertise SSO-only when SSO is actually enabled — otherwise the login
    // screen would hide the local form with no way in (lockout guard).
    ssoOnly: cfg.enabled && cfg.ssoOnly,
  });
});

/**
 * Prépare l'aller vers le fournisseur : cookies PKCE + nonce, état signé, et
 * l'URL d'autorisation. `link` (un id de compte) fait de ce passage un
 * RATTACHEMENT : au retour, l'identité SSO est posée sur ce compte au lieu
 * d'ouvrir une session. Le cookie PKCE lie le retour à CE navigateur : un
 * rattachement lancé ailleurs ne peut pas être terminé par quelqu'un d'autre.
 */
async function authorizationUrl(req: Request, res: Response, link?: number): Promise<string> {
    const cfg = getOidcConfig();
    const disco = await getDiscovery();
    const redirectUri = getRedirectUri(req);

    // PKCE: keep the verifier server-side (HttpOnly cookie), send only the challenge
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    // Nonce: binds the returned id_token to this browser session
    const nonce = base64url(randomBytes(16));

    const opts = oidcCookieOpts(req);
    res.cookie('oidc_verifier', codeVerifier, opts);
    res.cookie('oidc_nonce', nonce, opts);

    // Signed state (5 min) ties the callback to this request + carries the redirect URI
    const state = jwt.sign({ t: 'oidc_state', redirectUri, ...(link ? { link } : {}) }, getJwtSecret(), {
      expiresIn: '5m',
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${disco.authorization_endpoint}?${params.toString()}`;
}

// ── GET /api/auth/oidc/login ────────────────────────────────────────
// Redirects the browser to the OIDC provider's authorization endpoint
router.get('/oidc/login', async (req, res) => {
  try {
    if (!isOidcEnabled()) {
      return res.status(404).json({ error: 'SSO not enabled' });
    }
    res.redirect(await authorizationUrl(req, res));
  } catch (err) {
    console.error('OIDC login error:', err);
    res.redirect('/#oidc_error=login_failed');
  }
});

// ── POST /api/auth/oidc/link ────────────────────────────────────────
// Rattacher une identité SSO au compte LOCAL connecté. Rend l'URL du
// fournisseur ; le client y navigue. Seul chemin de rattachement depuis 1.8.0 :
// le rattachement d'office par adresse e-mail, qui ne l'exigeait pas vérifiée,
// donnait le compte (admin compris) à qui inscrivait son adresse dans son
// profil chez le fournisseur.
router.post('/oidc/link', requireAuth, async (req, res) => {
  try {
    if (!isOidcEnabled()) return res.status(404).json({ error: 'SSO not enabled' });
    if (req.user.auth_provider !== 'local') return res.status(400).json({ error: 'Only a local account can be linked' });
    const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(req.user.id) as { oidc_sub: string | null } | undefined;
    if (row?.oidc_sub) return res.status(409).json({ error: 'Account already linked' });
    res.json({ url: await authorizationUrl(req, res, req.user.id) });
  } catch (err) {
    console.error('OIDC link error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/oidc/callback ─────────────────────────────────────
// Provider redirects here with ?code=...&state=...
router.get('/oidc/callback', async (req, res) => {
  try {
    if (!isOidcEnabled()) {
      return res.redirect('/#oidc_error=disabled');
    }
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const providerError = req.query.error as string | undefined;
    if (providerError) {
      return res.redirect(`/#oidc_error=${encodeURIComponent(providerError)}`);
    }
    if (!code || !state) {
      return res.redirect('/#oidc_error=missing_params');
    }

    // Verify state
    let decoded: { t?: string; redirectUri?: string; link?: number };
    try {
      decoded = jwt.verify(state, getJwtSecret(), { algorithms: ['HS256'] }) as { t?: string; redirectUri?: string; link?: number };
    } catch {
      return res.redirect('/#oidc_error=invalid_state');
    }
    if (decoded.t !== 'oidc_state') {
      return res.redirect('/#oidc_error=invalid_state');
    }

    // Retrieve & immediately clear the PKCE verifier + nonce cookies
    const cookies = parseCookieHeader(req.headers.cookie);
    const codeVerifier = cookies.oidc_verifier;
    const expectedNonce = cookies.oidc_nonce;
    const clearOpts: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/api/auth' };
    res.clearCookie('oidc_verifier', clearOpts);
    res.clearCookie('oidc_nonce', clearOpts);
    if (!codeVerifier) {
      return res.redirect('/#oidc_error=missing_verifier');
    }

    const cfg = getOidcConfig();
    const disco = await getDiscovery();
    const redirectUri = decoded.redirectUri || getRedirectUri(req);

    // Exchange the authorization code for tokens (with PKCE verifier)
    // `oidcFetch`, pas un `fetch` nu : l'URL vient du document de découverte,
    // la garde anti-SSRF s'applique (hôte de l'émetteur de confiance).
    const tokenRes = await oidcFetch(disco.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error('OIDC token exchange failed:', tokenRes.status, txt);
      return res.redirect('/#oidc_error=token_exchange');
    }
    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };

    // Verify the id_token nonce matches the one we issued (replay protection)
    if (tokens.id_token) {
      const claims = jwt.decode(tokens.id_token) as { nonce?: string } | null;
      if (!claims || (expectedNonce && claims.nonce !== expectedNonce)) {
        console.error('OIDC nonce mismatch');
        return res.redirect('/#oidc_error=nonce_mismatch');
      }
    }

    // Fetch userinfo
    const userinfoRes = await oidcFetch(disco.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userinfoRes.ok) {
      console.error('OIDC userinfo failed:', userinfoRes.status);
      return res.redirect('/#oidc_error=userinfo');
    }
    const info = (await userinfoRes.json()) as {
      sub?: string; name?: string; preferred_username?: string; email?: string; email_verified?: boolean;
    };

    const sub = info.sub;
    if (!sub) {
      return res.redirect('/#oidc_error=no_sub');
    }

    // Pas l'adresse elle-même : une donnée personnelle par connexion dans les
    // journaux, pour un diagnostic qui n'a besoin que de savoir si elle existe.
    console.log('[oidc] callback sub=%s has_email=%s email_verified=%s',
      sub, !!info.email, info.email_verified);

    // Rattachement demandé depuis un compte connecté : l'identité va sur CE
    // compte, aucune session n'est ouverte (celle du navigateur continue).
    if (decoded.link) {
      const holder = db.prepare('SELECT id FROM users WHERE oidc_sub = ?').get(sub) as { id: number } | undefined;
      if (holder && holder.id !== decoded.link) return res.redirect('/#oidc_link_error=already_linked');
      if (!holder) {
        const done = db.prepare(
          "UPDATE users SET oidc_sub = ? WHERE id = ? AND active = 1 AND auth_provider = 'local' AND oidc_sub IS NULL",
        ).run(sub, decoded.link);
        if (!done.changes) return res.redirect('/#oidc_link_error=link_failed');
        console.log('[oidc] linked an SSO identity to account id=%s from its own session', decoded.link);
      }
      return res.redirect('/#oidc_linked=1');
    }

    // Une identité déjà rattachée ouvre son compte.
    let user = db
      .prepare(`SELECT id, active FROM users WHERE oidc_sub = ?`)
      .get(sub) as { id: number; active: number } | undefined;
    if (user) console.log('[oidc] matched an existing account by sub (id=%s)', user.id);

    // Plus de rattachement d'office par l'adresse e-mail (1.8.0) : le
    // fournisseur ne la garantit pas (Authentik envoie email_verified=false par
    // défaut), et la prendre pour preuve donnait le compte — admin compris — à
    // qui l'inscrivait dans son profil. Un compte local qui porte cette adresse
    // se rattache depuis Préférences › Général › Compte ; on ne crée pas de
    // doublon à côté de lui.
    if (!user && info.email) {
      const existing = db
        .prepare(`SELECT id FROM users WHERE email = ? COLLATE NOCASE AND oidc_sub IS NULL`)
        .get(info.email);
      if (existing) return res.redirect('/#oidc_error=link_required');
    }

    if (user) {
      if (!user.active) {
        return res.redirect('/#oidc_error=account_disabled');
      }
    } else {
      // Auto-provision
      const count = userCount();
      const role = count === 0 ? 'admin' : 'user';
      const displayName = info.name || info.preferred_username || info.email || 'SSO User';

      // Derive a unique username
      let baseUsername =
        info.preferred_username || info.email?.split('@')[0] || `sso_${sub.slice(0, 8)}`;
      baseUsername = baseUsername.replace(/[^a-zA-Z0-9_.-]/g, '');
      if (baseUsername.length < 3) baseUsername = `sso_${baseUsername}`;

      let username = baseUsername;
      let suffix = 1;
      while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        username = `${baseUsername}_${suffix++}`;
      }

      const result = db
        .prepare(
          `INSERT INTO users (username, email, display_name, role, auth_provider, oidc_sub)
           VALUES (?, ?, ?, ?, 'oidc', ?)`
        )
        .run(username, info.email || null, displayName, role, sub);
      user = { id: Number(result.lastInsertRowid), active: 1 };
    }

    // Create a FriRSS session and hand the token to the SPA via URL fragment
    // (fragments are never sent to the server, so the token stays out of logs)
    const { token } = createSession(user.id);
    res.redirect(`/#oidc_token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('OIDC callback error:', err);
    res.redirect('/#oidc_error=callback_failed');
  }
});

// ── Helper ──────────────────────────────────────────────────────────
function createSession(userId: number | bigint): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // jti makes each token unique even when two sessions are created within the
  // same second (JWT `iat` has 1s resolution) — otherwise the token strings
  // would collide on the sessions.token primary key.
  const token = jwt.sign(
    { userId: Number(userId), jti: randomBytes(16).toString('hex') },
    getJwtSecret(),
    { expiresIn: `${SESSION_DAYS}d` }
  );

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);

  return { token, expiresAt };
}

export default router;
