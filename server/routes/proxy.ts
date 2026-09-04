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

/**
 * Résolution SANS RÉPONSE : le résolveur n'a rien dit du tout, ni « publique »
 * ni « privée ». Une réponse DÉFINITIVE « ce nom n'existe pas » n'en est pas
 * une — voir `lookupFailure`, qui fait le tri.
 *
 * C'est une SOUS-CLASSE de `BlockedTargetError`, et délibérément : sur le
 * chemin de l'appel sortant, rien ne change. `fetchUpstream` ne se replie
 * toujours pas dessus, `finishError` répond toujours le même 403 sans nommer
 * la cible. Un hôte qu'on ne sait pas situer ne doit pas être joint, et lui
 * donner un code à part ferait de la route un oracle : en comparant les deux
 * réponses, un appelant apprendrait qu'un 403 signifie « cet hôte résout vers
 * le réseau interne » — exactement la carte du réseau que le corps du 403
 * s'interdit de dessiner.
 *
 * Ce que le type ajoute ne sert qu'AVANT toute sortie réseau : la garde
 * pré-cache de `/api/extract` (voir sa route) doit pouvoir distinguer une
 * cible refusée d'une panne de résolution, là où rien ne sera joint de toute
 * façon.
 */
export class UnresolvedTargetError extends BlockedTargetError {}

/**
 * Attente maximale d'une résolution avant de la tenir pour sans réponse.
 *
 * `dns.promises.lookup` n'accepte aucun délai : la borne réelle est le budget
 * de reprise du résolveur du système — sous musl, la libc de l'image de
 * production, 5 s par tentative et 2 tentatives par serveur de noms, soit une
 * dizaine de secondes d'immobilité. La garde étant désormais devant CHAQUE
 * extraction, y compris celles que le cache aurait servies sans réseau, ce
 * n'est plus une attente acceptable.
 *
 * Ce que ce plafond borne : UNE résolution, pas la réponse rendue à
 * l'appelant. Une requête qui en déclenche plusieurs les additionne — un échec
 * de cache sur `/api/extract` en fait deux (la garde pré-cache, puis
 * `fetchUpstream`, plus une par saut de redirection) : 10 s avant la première
 * ligne du corps SANS redirection, et jusqu'à ~35 s au bout des
 * `MAX_REDIRECTS` (5) sauts, qui portent le compte à 1 + 6 résolutions. Le
 * chiffre de 10 s seul, longtemps écrit ici trois mots après la clause qui
 * énumère les sauts, décrivait le meilleur cas comme s'il était le plafond.
 * Ce qu'il ne borne PAS non plus : le fil de `libuv`. `dns.lookup` s'exécute
 * sur le pool de threads (4 par défaut — `UV_THREADPOOL_SIZE` n'est fixé nulle
 * part — et partagé avec les entrées-sorties fichier et la cryptographie), et
 * abandonner l'attente ne rend pas le fil, qui reste pris jusqu'à ce que le
 * résolveur abandonne à son tour.
 * Un résolveur en panne continue donc de coûter des fils occupés ; il ne coûte
 * plus des requêtes immobiles. Le refermer complètement demanderait de passer
 * à `dns.promises.resolve4/6` (c-ares, hors pool), qui ignore `/etc/hosts` et
 * ne suit pas les règles de résolution du système : à ne pas troquer à la
 * légère dans la fonction qui garde toutes les sorties du backend.
 */
export const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * `dns.promises.lookup(host, { all: true })`, borné dans le temps.
 *
 * Le perdant de la course garde ses gestionnaires (`Promise.race` en attache
 * un à chacune) : une résolution qui échoue après le délai ne devient pas un
 * rejet non traité.
 *
 * Le rejet du minuteur porte un `code`, comme celui d'un vrai échec de
 * résolution : c'est `lookupFailure` qui classe les deux, et un rejet sans
 * code y passerait pour un nom inexistant.
 */
async function lookupWithTimeout(host: string): Promise<dns.LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      dns.promises.lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('dns lookup timed out'), { code: 'ETIMEDOUT' })),
          LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Codes de résolution qui disent « réessaie » — les seuls à valoir une panne.
 *
 * Ce sont les trois seuls que ce chemin puisse recevoir pour une absence de
 * réponse : `EAI_AGAIN` (rcode SERVFAIL, ou délai total épuisé), `EAI_FAIL`
 * (les autres rcodes d'échec — FORMERR, NOTIMP, et surtout REFUSED, celui d'un
 * résolveur filtrant qui redémarre) et le dépassement de `LOOKUP_TIMEOUT_MS`,
 * dont le rejet porte `ETIMEDOUT`.
 *
 * Le reste est une réponse DÉFINITIVE : le résolveur a parlé. Ses deux formes —
 * NXDOMAIN, et « ce nom existe mais n'a pas d'adresse » — arrivent ici sous un
 * SEUL code, `ENOTFOUND` : Node relabellise `UV_EAI_NONAME` et `UV_EAI_NODATA`
 * avant qu'aucun appelant ne les voie. C'est ce qui rend la liste ci-dessus
 * sûre — aucun de ses codes ne peut accompagner une réponse du résolveur.
 *
 * `ESERVFAIL` en a été retiré le 2026-09-04 : c'est un code de **c-ares**, que
 * seul `dns.resolve*` produit — jamais appelé dans ce dépôt — et qui ne figure
 * même pas dans la table d'erreurs de libuv (`util.getSystemErrorMap()`). Il
 * n'a donc jamais rien classé : la liste réelle se réduisait à `EAI_AGAIN` et
 * au délai, et une panne rendant `EAI_FAIL` valait un 403.
 */
const TRANSIENT_LOOKUP_CODES = new Set(['EAI_AGAIN', 'EAI_FAIL', 'ETIMEDOUT']);

/**
 * Classe un échec de résolution : panne du résolveur, ou nom inexistant ?
 *
 * La distinction ne sert QUE la garde pré-cache d'`/api/extract` (voir
 * `UnresolvedTargetError`), et elle y est décisive. Un nom qui n'existe pas
 * n'est pas un hoquet : c'est l'état STABLE d'un hôte interne au nom pointé
 * qu'on vient de retirer de `PROXY_REWRITES`, ou dont le conteneur ne voit
 * plus le résolveur interne. C'est aussi — et bien plus souvent, dans un
 * lecteur de flux — l'état stable d'un hôte d'article PUBLIC dont le domaine a
 * expiré ou déménagé : son entrée de cache chaude, autrefois rendue hors
 * ligne, répond désormais 403. Ce 403-là est le plus fréquent de la route, et
 * il est voulu. Tout ranger dans « on ne sait pas » faisait
 * ressortir son entrée de cache — écrite du temps où il était autorisé — en
 * 200 vers n'importe quel compte de l'instance pendant tout `CACHE_TTL` :
 * exactement le trou pour lequel la garde a été avancée devant le cache.
 *
 * D'où un tri par liste POSITIVE : seuls les codes transitoires deviennent une
 * panne ; un code inconnu est traité comme un refus. Le troc est asymétrique —
 * refuser un nom qui n'existe pas ne coûte qu'une lecture de cache qu'on
 * n'aura pas, le servir peut livrer un contenu interne.
 *
 * ⚠️ **Réserve, à connaître** : une panne franche n'est pas toujours reconnue
 * pour telle. Sous musl — la libc de l'image de production — un échec d'ENVOI
 * de la requête (`resolv.conf` illisible, socket refusé, aucun serveur de noms
 * configuré) rend `EAI_SYSTEM`, que libuv ne transmet pas tel quel : sa
 * traduction le remplace par l'`errno` du moment, donc par un code quelconque,
 * absent de la liste ci-dessus. Cette panne-là est donc classée en refus, et
 * une extraction répond 403 là où le cache aurait suffi. Le troc est assumé
 * dans ce sens-là : c'est la disponibilité qui cède, jamais la garde.
 *
 * *(La réserve écrite ici jusqu'au 2026-09-04 nommait `EAI_NONAME` — une chaîne
 * que ce code ne reçoit jamais, Node la relabellisant en `ENOTFOUND` — et
 * prêtait à musl un repliement qu'elle ne fait pas : `EAI_NONAME` est sa
 * réponse NXDOMAIN, le cas définitif, pas un échec replié.)*
 *
 * ⚠️ **Et dans l'autre sens, la fenêtre n'est pas close** : sur la branche
 * transitoire, le repli sert le cache d'extraction — global à l'instance — y
 * compris pour un hôte interne AUTREFOIS autorisé, la seule classe d'entrées
 * qui puisse porter du contenu interne (`ALLOWED_INTERNAL` court-circuite la
 * résolution au moment de l'écriture). Le tri par liste positive a ramené cette
 * fenêtre de « toujours » à « tant que le résolveur bafouille » ; il ne la
 * referme pas. Limite connue et acceptée.
 */
function lookupFailure(host: string, err: unknown): BlockedTargetError {
  const code = (err as { code?: unknown } | null)?.code;
  return TRANSIENT_LOOKUP_CODES.has(String(code))
    ? new UnresolvedTargetError(host)
    : new BlockedTargetError(host);
}

// Throws BlockedTargetError if `rawUrl` must not be fetched. Trusted internal
// hosts (PROXY_REWRITES / PROXY_INTERNAL_HOSTS) pass. Otherwise the host is
// rejected if it is an internal literal, OR if it RESOLVES to a private IP —
// which defeats `10.x.x.x.nip.io` and DNS records aimed at the internal
// network (a string-only check missed those).
//
// Exportée : `/api/extract` doit refuser une cible AVANT de lire son cache
// (clé globale à l'instance, voir sa route), et `targetAllowedLiteral` ne
// suffit pas à ce poste — il ne connaît que `localhost`, les noms SANS point et
// les IP littérales. Un hôte interne au nom POINTÉ (`nas.example.com`, un
// `.lan`, un `*.svc.cluster.local`) lui est invisible ; seule la résolution
// ci-dessous sait le classer.
export async function assertTargetSafe(rawUrl: string): Promise<void> {
  let host: string;
  try { host = new URL(rawUrl).hostname; } catch { throw new BlockedTargetError('bad-url'); }
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (ALLOWED_INTERNAL.has(h)) return;                    // explicitly trusted
  if (isInternalHostLiteral(host)) throw new BlockedTargetError(host);
  let addrs: dns.LookupAddress[];
  try {
    addrs = await lookupWithTimeout(host);
  } catch (err) {
    // Résolution ratée, on ne sait pas où l'on va : on n'y va pas. Le TYPE de
    // l'erreur dit seulement POURQUOI, et seule la garde pré-cache
    // d'`/api/extract` s'en sert — elle qui, justement, ne va nulle part.
    // Partout ailleurs c'est un refus comme un autre : même 403, même journal,
    // aucun repli.
    throw lookupFailure(host, err);                       // unresolvable → block
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
  //
  // EXCEPTION assumée au principe « refuser avant de lire le cache » que
  // `/api/extract` applique : ici, seul le pré-contrôle littéral ci-dessus est
  // passé, `assertTargetSafe` ne tourne pas, et un hôte interne au nom POINTÉ
  // retiré de `PROXY_INTERNAL_HOSTS` peut donc encore se faire rendre son
  // entrée. Ce qui la rend étroite, contrairement au cache d'extraction : la
  // clé porte l'identifiant de l'utilisateur (`cacheKey(req.user.id, …)`) et
  // `isCacheableRead` exige un GET sur `/reader/api/0/` — l'appelant ne peut
  // donc relire que ce que SON compte a lui-même mis en cache du temps où
  // l'hôte était autorisé, jamais le travail d'un autre. Y placer la garde
  // complète coûterait une résolution DNS sur le chemin de peinture instantanée
  // de l'application, celui qui doit répondre sans réseau : le troc n'en vaut
  // pas la peine pour ce périmètre-là.
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
