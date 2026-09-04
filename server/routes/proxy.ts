import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'stream';
import dns from 'dns';
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
// server-side and ONLY server-side: the client sends X-Server-Id, we look up
// that server's encrypted token and forward it as a GoogleLogin header, only
// toward the server's own origin (see targetBelongsToServer). The real target
// is given in X-Proxy-Target.
//
// A client-supplied credential header is deliberately NOT honoured. An
// X-Freshrss-Auth fallback used to exist "for setup, before a server row
// exists", but nothing ever sent it: the setup flow passes credentials in the
// ClientLogin body and then stores the token through /api/servers. All it did
// was let any authenticated account attach an Authorization of its choosing to
// any allowed target.

const TIMEOUT_MS = 30_000;

/**
 * Plafond de requêtes proxifiées, par utilisateur et par minute.
 *
 * Un compte authentifié peut faire émettre au backend autant de requêtes
 * sortantes qu'il le demande : sans plafond, le proxy est un relais
 * anonymisant et un amplificateur de bande passante offerts avec chaque
 * compte.
 *
 * Le défaut est délibérément haut. La préparation hors-ligne est de loin le
 * plus gros consommateur — une extraction plus jusqu'à `perArticle` images par
 * article, à 4 requêtes simultanées (`BATCH`, `src/lib/imageCache.ts`) — et
 * elle reste sous la centaine de requêtes par minute. Un plafond serré
 * casserait la fonctionnalité sans gêner un abus, qui se contente d'être
 * patient : 600 laisse six fois la marge nécessaire tout en fermant le robinet.
 *
 * `0` désactive complètement le contrôle, pour l'opérateur qui sait ce qu'il
 * fait. Une valeur illisible retombe sur le défaut : un plafond mal saisi ne
 * doit jamais verrouiller le proxy.
 */
export const DEFAULT_PROXY_RATE_LIMIT = 600;

export function proxyRateLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FRIRSS_PROXY_RATE_LIMIT;
  if (raw == null || raw === '') return DEFAULT_PROXY_RATE_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_PROXY_RATE_LIMIT;
}

// ── Ordre des middlewares : l'authentification D'ABORD ───────────────
// `express.raw` mettait jusqu'à 5 Mo en mémoire avant que qui que ce soit ait
// prouvé son identité — un inconnu pouvait donc faire allouer 5 Mo par
// requête pour finir sur un 401. L'identité se lit dans les en-têtes, elle n'a
// jamais eu besoin du corps.
router.use(requireAuth);

// Ensuite seulement la cadence : la clé est l'identifiant de l'utilisateur, pas
// son IP — plusieurs personnes derrière un même NAT ne doivent pas se partager
// un seau, et après `requireAuth` on dispose d'une clé bien meilleure.
//
// Le middleware est EXPORTÉ, et `/api/extract` réutilise cette instance-là.
// `rateLimit()` s'alloue un `MemoryStore` neuf à chaque appel : deux appels,
// même valeur de plafond, donnent deux seaux indépendants indexés par le même
// identifiant d'utilisateur — donc le double du plafond annoncé pour un compte,
// et la protection contournable en changeant d'URL. Une seule instance
// partagée = un seul magasin, donc un seul seau : `FRIRSS_PROXY_RATE_LIMIT`
// borne bien ce qu'un compte peut faire émettre au backend, toutes routes
// sortantes confondues.
const PROXY_RATE_LIMIT = proxyRateLimit();
export const proxyRateLimiter = PROXY_RATE_LIMIT > 0
  ? rateLimit({
    windowMs: 60_000,
    max: PROXY_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: { error: 'Too many proxied requests, please slow down' },
  })
  : null;
if (proxyRateLimiter) router.use(proxyRateLimiter);

// Capture the raw body for any content type (greader writes are urlencoded)
router.use(express.raw({ type: '*/*', limit: '5mb' }));

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

// Strip credential-bearing query parameters before a URL reaches a log.
// The FreshRSS feed-refresh call (see ../actualizeRequest.ts) must be a GET
// carrying the master token in its query string — FreshRSS rejects every other
// form — so any log line printing a target URL would otherwise write that
// secret to disk. The rest of the URL is kept: a redacted log is still useful,
// a silenced one is not.
const SECRET_PARAMS = new Set(['token']);

export function redactUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }   // not a URL → nothing to parse
  let touched = false;
  for (const key of [...u.searchParams.keys()]) {
    if (SECRET_PARAMS.has(key.toLowerCase())) {
      u.searchParams.set(key, 'REDACTED');
      touched = true;
    }
  }
  return touched ? u.toString() : url;
}

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

// True if an IP *literal* is loopback / private / link-local / ULA — i.e. must
// not be reachable from a user-supplied target. Covers IPv4, IPv6 and
// IPv4-mapped IPv6 (::ffff:a.b.c.d).
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return true;   // malformed → unsafe
    return a === 0 || a === 10 || a === 127                // this-net, private, loopback
      || (a === 169 && b === 254)                          // link-local + cloud metadata (169.254.169.254)
      || (a === 172 && b >= 16 && b <= 31)                 // private
      || (a === 192 && b === 168)                          // private
      || (a === 100 && b >= 64 && b <= 127);               // CGNAT
  }
  if (s === '::1' || s === '::') return true;              // loopback / unspecified
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
  if (s.startsWith('fe80') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true; // link-local
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

// A host literal that is internal WITHOUT needing DNS: localhost, a bare name
// (Docker service, or a non-dotted form like a decimal IP), or a private IP.
export function isInternalHostLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (!h.includes('.') && !h.includes(':')) return true;  // bare name / decimal-encoded IP
  return isPrivateIp(h);
}

// Fast, synchronous literal check for the request handler (obvious internal
// targets → immediate 403). The authoritative resolve-based check runs in
// fetchUpstream, on every request AND every redirect hop.
export function targetAllowedLiteral(rawTarget: string): boolean {
  let host: string;
  try { host = new URL(rawTarget).hostname; } catch { return false; }
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (ALLOWED_INTERNAL.has(h)) return true;               // explicitly trusted
  return !isInternalHostLiteral(host);
}

/**
 * Le jeton FreshRSS de `serverUrl` a-t-il le droit d'accompagner `rawTarget` ?
 *
 * La question se pose à chaque requête proxifiée, et la réponse doit être NON
 * pour toute cible que l'utilisateur n'a pas lui-même choisie. Or les URL
 * d'images d'articles et de favicons viennent du CONTENU DES FLUX : celui qui
 * publie un flux choisit donc la cible, et `client.ts` attache `X-Server-Id` à
 * toutes ses requêtes sans distinction.
 *
 * D'où une comparaison d'ORIGINES ANALYSÉES, jamais de préfixe de chaîne. Un
 * `startsWith(srv.url)` acceptait deux hôtes étrangers :
 *   - `https://rss.example.com.attacker.tld/` — un sous-domaine de l'attaquant
 *     qui commence par la chaîne attendue ;
 *   - `https://rss.example.com@attacker.tld/` — où tout ce qui précède le « @ »
 *     n'est qu'un userinfo, l'hôte réel étant `attacker.tld`.
 * Dans les deux cas le jeton greader — un accès complet au compte FreshRSS de
 * la victime — partait chez un tiers.
 *
 * Le chemin est comparé avec une frontière explicite, pour la même raison en
 * plus petit : un serveur déclaré sous `/freshrss` ne couvre pas
 * `/freshrss-public`.
 */
export function targetBelongsToServer(serverUrl: string, rawTarget: string): boolean {
  let target: URL;
  let server: URL;
  try {
    target = new URL(rawTarget);
    server = new URL(serverUrl);
  } catch {
    return false;
  }
  if (target.origin !== server.origin) return false;
  const base = server.pathname.replace(/\/+$/, '');
  return target.pathname === base || target.pathname.startsWith(`${base}/`);
}

/**
 * Cible refusée. Exportée pour que `/api/extract` lève EXACTEMENT le même
 * échec que le proxy et le fasse repartir par `finishError` : un seul 403, un
 * seul corps, une seule ligne de journal, décrits à un seul endroit.
 */
export class BlockedTargetError extends Error {}

// Throws BlockedTargetError if `rawUrl` must not be fetched. Trusted internal
// hosts (PROXY_REWRITES / PROXY_INTERNAL_HOSTS) pass. Otherwise the host is
// rejected if it is an internal literal, OR if it RESOLVES to a private IP —
// which defeats `10.x.x.x.nip.io` and DNS records aimed at the internal
// network (a string-only check missed those).
async function assertTargetSafe(rawUrl: string): Promise<void> {
  let host: string;
  try { host = new URL(rawUrl).hostname; } catch { throw new BlockedTargetError('bad-url'); }
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (ALLOWED_INTERNAL.has(h)) return;                    // explicitly trusted
  if (isInternalHostLiteral(host)) throw new BlockedTargetError(host);
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new BlockedTargetError(host);                   // unresolvable → block
  }
  if (addrs.some((a) => isPrivateIp(a.address))) throw new BlockedTargetError(host);
}

// A greader READ endpoint whose response is worth caching (article lists,
// subscription list, unread counts, tag list). Excludes the CSRF write token.
function isCacheableRead(method: string, target: string): boolean {
  return method === 'GET'
    && target.includes('/reader/api/0/')
    && !target.includes('/reader/api/0/token');
}

interface FetchUpstreamOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  /** Aborts the request (and any redirect hop still in flight) when triggered. */
  signal?: AbortSignal;
  /** Per-hop timeout override. Defaults to TIMEOUT_MS when omitted. */
  timeoutMs?: number;
  /**
   * When false, a 3xx response is returned as-is instead of being chased.
   * Defaults to true (existing behaviour). Sensitive non-GET calls that carry
   * credentials in the body should pass false: chasing a redirect can
   * downgrade the request to a bodyless GET (see the 301/302/303 handling
   * below), silently dropping those credentials from the retried request.
   */
  followRedirects?: boolean;
}

/**
 * Fetch an upstream URL with the public→internal rewrite and an automatic
 * fallback to the original (public) URL if the internal target is unreachable.
 * Reused by the background sync worker. Returns the fetch Response or throws.
 */
const MAX_REDIRECTS = 5;

export async function fetchUpstream(
  rawTarget: string,
  { method = 'GET', headers = {}, body, signal, timeoutMs, followRedirects = true }: FetchUpstreamOpts = {}
): Promise<Response> {
  const target = rewriteTarget(rawTarget);

  // Follow redirects manually so we can re-run the SSRF check on every hop
  // (a public page must not be able to bounce us into the internal network).
  async function attempt(startUrl: string): Promise<Response> {
    let url = startUrl;
    let curMethod = method;
    let curHeaders = { ...headers };
    let curBody = body;
    // Renseigné APRÈS le premier `assertTargetSafe` : `new URL()` levait ici un
    // `TypeError` brut pour une URL malformée (`https://`, qui passe pourtant
    // le filtre `^https?://`), avant que `BlockedTargetError` puisse être
    // levée — l'appelant classait alors en 502 ce que le proxy classe en 403.
    let startHost = '';

    for (let hop = 0; ; hop++) {
      await assertTargetSafe(url);
      if (hop === 0) startHost = new URL(url).host;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs ?? TIMEOUT_MS);
      // Combine the caller's signal into this hop's controller so a caller
      // abort (or the caller's own timeout) cancels the in-flight request too.
      const onCallerAbort = () => controller.abort(signal!.reason);
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', onCallerAbort);
      }
      let resp: Response;
      try {
        resp = await fetch(url, { method: curMethod, headers: curHeaders, body: curBody as BodyInit | undefined, redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);
      }

      const loc = resp.status >= 300 && resp.status < 400 ? resp.headers.get('location') : null;
      if (!loc || hop >= MAX_REDIRECTS || !followRedirects) return resp;

      const next = new URL(loc, url);
      // Don't leak the FreshRSS token to a different origin on redirect.
      if (next.host !== startHost) {
        delete curHeaders.Authorization;
        startHost = next.host;
      }
      // Per fetch semantics: 303 (and 301/302 on a non-GET) → GET without body.
      if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && curMethod !== 'GET' && curMethod !== 'HEAD')) {
        curMethod = 'GET';
        curBody = undefined;
      }
      url = next.toString();
    }
  }

  try {
    return await attempt(target);
  } catch (err) {
    if (err instanceof BlockedTargetError) throw err;     // never fall back a blocked target
    const e = err as { name?: string; cause?: { code?: string }; message?: string };
    if (target !== rawTarget && e.name !== 'AbortError') {
      console.warn('Proxy rewrite unreachable (%s), falling back to public:', e.cause?.code || e.message, redactUrl(target));
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
  // SSRF guard (fast literal pre-check; the resolve-based check runs in
  // fetchUpstream, on the real target and every redirect hop).
  //
  // Le refus passe par `finishError` — et pas par un `res.status(403)` écrit
  // ici — pour qu'il soit JOURNALISÉ comme celui de la garde par résolution.
  // C'est ce pré-contrôle qui attrape les sondes les plus bruyantes
  // (`http://127.0.0.1:6379/`, un nom de service nu, une IP privée) : les
  // laisser repartir en silence vidait de son sens la trace promise côté
  // serveur. Le corps, lui, ne nomme toujours pas la cible.
  if (!targetAllowedLiteral(rawTarget)) {
    return finishError(res, new BlockedTargetError(rawTarget), rawTarget);
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
    if (srv && srv.freshrss_token && targetBelongsToServer(srv.url, rawTarget)) {
      const tok = decrypt(srv.freshrss_token);
      if (tok) headers.Authorization = `GoogleLogin auth=${tok}`;
    }
  }
  const accept = req.header('x-proxy-accept');
  if (accept) headers.Accept = accept;
  // Offline image prefetch: many CDNs refuse a bare server-side request
  // (hotlink protection answers 403 unless the Referer looks like the image's
  // own site). The Referer is derived from the target itself, never taken from
  // the client, so this cannot be used to forge an arbitrary one.
  if (req.header('x-proxy-image')) {
    try {
      const origin = new URL(rawTarget).origin;
      headers.Referer = `${origin}/`;
      headers['User-Agent'] =
        'Mozilla/5.0 (compatible; FriRSS offline prefetch; +https://github.com/Fripix/Frirss)';
    } catch { /* target already validated above; ignore */ }
  }
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

/**
 * Traduit l'échec d'un appel sortant en réponse HTTP, de façon identique pour
 * toutes les routes qui passent par `fetchUpstream`.
 *
 * Partagé (et non recopié) exprès : deux routes qui décrivent différemment le
 * même échec — cible refusée, délai dépassé, panne amont — fabriquent un
 * client qui doit connaître la route pour comprendre la réponse. `label`
 * n'existe que pour situer la ligne de journal.
 *
 * Le corps ne dit jamais quelle cible a été refusée ni pourquoi : ce serait
 * offrir un scanner de réseau interne à qui essaie des URL.
 */
export function finishError(res: ExpressResponse, err: unknown, target: string, label = 'Proxy error:') {
  if (err instanceof BlockedTargetError) {
    // Une cible refusée est journalisée : un balayage SSRF doit laisser une
    // trace côté serveur, même si le client, lui, n'apprend rien.
    console.warn(label, 'blocked target →', redactUrl(target));
    return res.status(403).json({ error: 'Target host not allowed' });
  }
  const e = err as { name?: string; cause?: { code?: string }; message?: string };
  if (e.name === 'AbortError') {
    return res.status(504).json({ error: 'Upstream timeout' });
  }
  console.error(label, e.cause?.code || e.message, '→', redactUrl(target));
  res.status(502).json({ error: 'Upstream request failed' });
}

export default router;
