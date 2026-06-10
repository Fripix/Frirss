import { Router } from 'express';
import express from 'express';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'stream';
import db from '../db.js';
import { decrypt } from '../crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { cacheEnabled, cacheGet, cacheSet, cacheKey, trimStreamJson } from '../cache.js';

const router = Router();

// Same-origin proxy for the FreshRSS Google Reader API (reads + writes +
// favicons) and full-article extraction. Routing through the backend avoids
// cross-origin CORS/preflight failures in production and removes the need for
// FreshRSS to expose CORS headers.
//
// The caller authenticates with the FriRSS JWT (Authorization: Bearer …, via
// requireAuth) — so this is NOT an open proxy. The FreshRSS token is injected
// server-side: the client sends X-Server-Id, we look up that server's encrypted
// token and forward it as a GoogleLogin header (only toward the server's own
// URL — never leaks to external article URLs). X-Freshrss-Auth remains a
// setup-only fallback (ClientLogin, before a server row exists). The real
// target is given in X-Proxy-Target.

// Capture the raw body for any content type (greader writes are urlencoded)
router.use(express.raw({ type: '*/*', limit: '5mb' }));
router.use(requireAuth);

const TIMEOUT_MS = 30_000;

// Optional public→internal target rewrites, so the backend reaches FreshRSS
// directly over the Docker network (e.g. http://freshrss:80) instead of
// hair-pinning through the public domain + reverse proxy + TLS.
//   PROXY_REWRITES="https://rss.example.com=http://freshrss:80,https://b=http://c"
const REWRITES: [string, string][] = (process.env.PROXY_REWRITES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair): [string, string] | null => {
    const i = pair.indexOf('=');
    return i > 0 ? [pair.slice(0, i), pair.slice(i + 1)] : null;
  })
  .filter((p): p is [string, string] => p !== null);

function rewriteTarget(url: string): string {
  for (const [from, to] of REWRITES) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return url;
}

// ── SSRF guard ───────────────────────────────────────────────────────
// Client-supplied targets (X-Proxy-Target) reach arbitrary external article
// URLs for "full content" extraction — that's intended. But we must NOT let a
// logged-in user point the backend at internal services (databases, cloud
// metadata, other containers). So: public hosts are allowed; private/internal
// hosts are blocked UNLESS explicitly trusted.
//
// Trusted internal hosts = PROXY_REWRITES endpoints (both sides) +
// PROXY_INTERNAL_HOSTS (comma-separated), so FreshRSS can be reached locally
// (e.g. http://freshrss:80) on purpose.
const ALLOWED_INTERNAL = new Set<string>();
for (const [from, to] of REWRITES) {
  for (const u of [from, to]) {
    try { ALLOWED_INTERNAL.add(new URL(u).hostname.toLowerCase()); } catch { /* ignore */ }
  }
}
(process.env.PROXY_INTERNAL_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  .forEach((h) => ALLOWED_INTERNAL.add(h));

function isInternalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true;
  if (!h.includes('.') && !h.includes(':')) return true; // bare name (Docker service)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true; // IPv6 ULA/link-local
  return false;
}

// true → the target is allowed to be fetched
function targetAllowed(rawTarget: string): boolean {
  let host: string;
  try { host = new URL(rawTarget).hostname; } catch { return false; }
  if (!isInternalHost(host)) return true;               // public → ok
  return ALLOWED_INTERNAL.has(host.toLowerCase());       // internal → only if trusted
}

// A greader READ endpoint whose response is worth caching (article lists,
// subscription list, unread counts, tag list). Excludes the CSRF write token.
export function isCacheableRead(method: string, target: string): boolean {
  return method === 'GET'
    && target.includes('/reader/api/0/')
    && !target.includes('/reader/api/0/token');
}

interface FetchUpstreamOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}

/**
 * Fetch an upstream URL with the public→internal rewrite and an automatic
 * fallback to the original (public) URL if the internal target is unreachable.
 * Reused by the background sync worker. Returns the fetch Response or throws.
 */
export async function fetchUpstream(rawTarget: string, { method = 'GET', headers = {}, body }: FetchUpstreamOpts = {}): Promise<Response> {
  const target = rewriteTarget(rawTarget);
  async function attempt(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { method, headers, body: body as BodyInit | undefined, redirect: 'follow', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    return await attempt(target);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; message?: string };
    if (target !== rawTarget && e.name !== 'AbortError') {
      console.warn('Proxy rewrite unreachable (%s), falling back to public:', e.cause?.code || e.message, target);
      return await attempt(rawTarget);
    }
    throw err;
  }
}

router.all('/', async (req, res) => {
  const rawTarget = req.header('x-proxy-target');
  if (!rawTarget || !/^https?:\/\//i.test(rawTarget)) {
    return res.status(400).json({ error: 'Invalid or missing X-Proxy-Target' });
  }
  // SSRF guard: block internal/private targets unless explicitly trusted.
  if (!targetAllowed(rawTarget)) {
    return res.status(403).json({ error: 'Target host not allowed' });
  }

  const headers: Record<string, string> = {};
  // ── FreshRSS auth: injected server-side from the DB ──
  // The token never leaves the backend. The client only sends X-Server-Id;
  // we look up that server's (encrypted) token and attach it — but ONLY when
  // the target is that server's own URL, never an external article URL
  // (extraction), so the token can't leak to third-party sites.
  const serverId = req.header('x-server-id');
  if (serverId) {
    const srv = db.prepare('SELECT url, freshrss_token FROM servers WHERE id = ? AND user_id = ?')
      .get(serverId, req.user.id) as { url: string; freshrss_token: string | null } | undefined;
    if (srv && srv.freshrss_token && rawTarget.startsWith(srv.url)) {
      const tok = decrypt(srv.freshrss_token);
      if (tok) headers.Authorization = `GoogleLogin auth=${tok}`;
    }
  }
  // Legacy / setup fallback (e.g. ClientLogin before a server exists): the
  // client may still pass the token directly. Used only if none was injected.
  if (!headers.Authorization) {
    const fauth = req.header('x-freshrss-auth');
    if (fauth) headers.Authorization = `GoogleLogin auth=${fauth}`;
  }
  const accept = req.header('x-proxy-accept');
  if (accept) headers.Accept = accept;
  const ct = req.header('content-type');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length;
  if (hasBody && ct) headers['Content-Type'] = ct;

  const cacheable = cacheEnabled && isCacheableRead(req.method, rawTarget);
  const key = cacheable ? cacheKey(req.user.id, rawTarget) : null;

  // ── Cache-only read: instant paint, no FreshRSS round-trip ──
  if (req.header('x-cache-only')) {
    if (!key) return res.status(204).end();
    const cached = await cacheGet(key);
    if (cached == null) return res.status(204).end();
    res.set('Content-Type', 'application/json');
    res.set('X-From-Cache', '1');
    return res.status(200).send(cached);
  }

  // ── Live request ──
  let upstream: Response;
  try {
    upstream = await fetchUpstream(rawTarget, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
    });
  } catch (err) {
    return finishError(res, err, rawTarget);
  }

  const ctype = upstream.headers.get('content-type');
  if (ctype) res.set('Content-Type', ctype);

  if (cacheable && upstream.ok) {
    // Buffer so we can store a trimmed copy; send the full response untouched.
    const text = Buffer.from(await upstream.arrayBuffer()).toString('utf8');
    res.status(upstream.status).send(text);
    if (key) cacheSet(key, trimStreamJson(text)); // fire-and-forget
    return;
  }

  // Non-cacheable → stream through (faster first byte, no buffering).
  res.status(upstream.status);
  if (!upstream.body) { res.end(); return; }
  const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  stream.on('error', () => { if (!res.headersSent) res.sendStatus(502); res.destroy(); });
  stream.pipe(res);
});

function finishError(res: ExpressResponse, err: unknown, target: string) {
  const e = err as { name?: string; cause?: { code?: string }; message?: string };
  if (e.name === 'AbortError') {
    return res.status(504).json({ error: 'Upstream timeout' });
  }
  console.error('Proxy error:', e.cause?.code || e.message, '→', target);
  res.status(502).json({ error: 'Upstream request failed' });
}

export default router;
