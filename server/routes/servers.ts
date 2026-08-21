import { Router } from 'express';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { buildActualizeRequest, refreshMaxFeeds } from '../actualizeRequest.js';
import { startJob, getJob, isRefreshKind, REFRESH_TIMEOUT_MS } from '../refreshJobs.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchUpstream } from './proxy.js';

const router = Router();

// FreshRSS's master token is a free-text field with no generator and no
// documented format — but it is still a token, not a document. This just
// keeps an obviously-wrong client payload from being handed straight to the
// outgoing request.
const MAX_TEST_TOKEN_LENGTH = 1024;

interface ServerRow {
  id: number;
  user_id: number;
  name: string | null;
  url: string;
  freshrss_user: string;
  freshrss_token: string | null;
  refresh_token: string | null;
  is_default: number;
  created_at: string;
}

// All routes require authentication
router.use(requireAuth);

// ── GET /api/servers ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, url, freshrss_user, freshrss_token, refresh_token, is_default, created_at
    FROM servers WHERE user_id = ? ORDER BY is_default DESC, created_at ASC
  `).all(req.user.id) as ServerRow[];

  // Neither token ever leaves the backend — expose only their presence.
  // freshrss_token is injected server-side by the proxy (see routes/proxy.js).
  const servers = rows.map(({ freshrss_token, refresh_token, ...s }) => ({
    ...s,
    has_token: !!freshrss_token,
    has_refresh_token: !!refresh_token,
  }));

  res.json({ servers });
});

// ── POST /api/servers ───────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, url, freshrssUser, freshrssToken } = req.body;

    if (!url || !freshrssUser) {
      return res.status(400).json({ error: 'URL and FreshRSS username required' });
    }

    // Normalize URL (remove trailing slash)
    const normalizedUrl = url.replace(/\/+$/, '');

    // Check duplicate
    const existing = db.prepare(
      'SELECT id FROM servers WHERE user_id = ? AND url = ? AND freshrss_user = ?'
    ).get(req.user.id, normalizedUrl, freshrssUser);
    if (existing) {
      return res.status(409).json({ error: 'Server already exists' });
    }

    // First server for this user = default
    const count = (db.prepare('SELECT COUNT(*) as c FROM servers WHERE user_id = ?').get(req.user.id) as { c: number }).c;
    const isDefault = count === 0 ? 1 : 0;

    const result = db.prepare(`
      INSERT INTO servers (user_id, name, url, freshrss_user, freshrss_token, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, name || normalizedUrl, normalizedUrl, freshrssUser, encrypt(freshrssToken) || null, isDefault);

    const server = db.prepare('SELECT id, name, url, freshrss_user, is_default, created_at FROM servers WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ server });
  } catch (err) {
    console.error('Add server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/servers/:id ────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, freshrssUser, freshrssToken, refreshToken } = req.body;

    // Check ownership
    const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?').get(id, req.user.id) as ServerRow | undefined;
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const normalizedUrl = url ? url.replace(/\/+$/, '') : server.url;

    db.prepare(`
      UPDATE servers SET name = ?, url = ?, freshrss_user = ?, freshrss_token = ?, refresh_token = ?
      WHERE id = ? AND user_id = ?
    `).run(
      name ?? server.name,
      normalizedUrl,
      freshrssUser ?? server.freshrss_user,
      freshrssToken !== undefined ? encrypt(freshrssToken) : server.freshrss_token,
      refreshToken !== undefined ? encrypt(refreshToken) : server.refresh_token,
      id,
      req.user.id
    );

    const updated = db.prepare('SELECT id, name, url, freshrss_user, is_default, created_at FROM servers WHERE id = ?').get(id);
    res.json({ server: updated });
  } catch (err) {
    console.error('Update server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/servers/:id ─────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?').get(id, req.user.id) as ServerRow | undefined;
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  db.prepare('DELETE FROM servers WHERE id = ? AND user_id = ?').run(id, req.user.id);

  // If deleted server was default, promote the next one
  if (server.is_default) {
    const next = db.prepare('SELECT id FROM servers WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(req.user.id) as { id: number } | undefined;
    if (next) {
      db.prepare('UPDATE servers SET is_default = 1 WHERE id = ?').run(next.id);
    }
  }

  res.json({ ok: true });
});

// ── PUT /api/servers/:id/default ────────────────────────────────────
router.put('/:id/default', (req, res) => {
  const { id } = req.params;

  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  // Reset all, then set this one
  db.prepare('UPDATE servers SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  db.prepare('UPDATE servers SET is_default = 1 WHERE id = ?').run(id);

  res.json({ ok: true });
});

// ── POST /api/servers/:id/actualize ─────────────────────────────────
// Triggers a REAL feed refresh on FreshRSS and returns immediately. The
// request is fired but not awaited: refreshing hundreds of feeds takes
// minutes, and any proxy in between would time out the client long before
// FreshRSS is done — while FreshRSS keeps working regardless.
router.post('/:id/actualize', (req, res) => {
  const { id } = req.params;
  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?')
    .get(id, req.user.id) as ServerRow | undefined;
  if (!server) return res.status(404).json({ error: 'Server not found' });

  // The kind reaches an in-memory registry key, so only the two known values
  // are accepted — never whatever the client happens to send.
  const kind = req.body?.kind ?? 'refresh';
  if (!isRefreshKind(kind)) return res.status(400).json({ error: 'invalid_kind' });

  // Preferences' "Test" button can supply a one-shot token: the value
  // currently typed in the field, which may not be saved yet. Without this,
  // Test could only ever exercise the STORED token, so a user who pastes a
  // freshly-rotated token and hits Test before Save gets a rejection about
  // the token they're in the middle of replacing. Honoured ONLY for 'test' —
  // a real refresh always uses the stored token, no exceptions, even though
  // a client can only ever target their own server. Never persisted, never
  // logged: it lives only for the lifetime of this request/job.
  let token: string;
  if (kind === 'test' && req.body?.token !== undefined) {
    const supplied = req.body.token;
    if (typeof supplied !== 'string' || supplied.length === 0 || supplied.length > MAX_TEST_TOKEN_LENGTH) {
      return res.status(400).json({ error: 'invalid_token' });
    }
    token = supplied;
  } else {
    const stored = decrypt(server.refresh_token);
    if (!stored) return res.status(409).json({ error: 'no_refresh_token' });
    token = stored;
  }

  // Clamp to the operator's ceiling, not to the compiled-in default: an admin
  // who lowered FRIRSS_REFRESH_MAX_FEEDS to spread a first sweep must not be
  // overridden by a client asking for more.
  const maxFeeds = Number.isInteger(req.body?.maxFeeds) && req.body.maxFeeds >= 1
    ? Math.min(req.body.maxFeeds as number, refreshMaxFeeds())
    : undefined;

  const { url, method } = buildActualizeRequest({
    serverUrl: server.url,
    freshrssUser: server.freshrss_user,
    token,
    maxFeeds,
  });

  const job = startJob(req.user.id, server.id, async (signal) => {
    // Routed through fetchUpstream (not a bare fetch) so this outgoing call
    // gets the same SSRF guard — on the initial target AND every redirect hop
    // — as every other FreshRSS call this app makes, plus PROXY_REWRITES
    // (which also keeps the URL, token included, off any public reverse proxy).
    // followRedirects stays off: FreshRSS answers a rejected call with a 302 to
    // its login page, and chasing that would turn a failure into a fake 200.
    const r = await fetchUpstream(url, {
      method,
      signal,
      timeoutMs: REFRESH_TIMEOUT_MS,
      followRedirects: false,
    });
    if (!r.ok) throw new Error(`FreshRSS answered ${r.status}`);
  }, [token], kind);

  res.status(202).json({ job });
});

// ── GET /api/servers/:id/actualize ──────────────────────────────────
router.get('/:id/actualize', (req, res) => {
  const { id } = req.params;
  const server = db.prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(id, req.user.id) as { id: number } | undefined;
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const kind = req.query.kind ?? 'refresh';
  if (!isRefreshKind(kind)) return res.status(400).json({ error: 'invalid_kind' });

  res.json({ job: getJob(req.user.id, server.id, kind) ?? null });
});

export default router;
