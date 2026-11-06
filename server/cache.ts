import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { EXTRACT_VERSION } from './extractVersion.js';
import { stripTrailingSlashes } from './validate.js';

// Optional Redis cache for FreshRSS read responses. Enabled only when
// REDIS_URL is set — otherwise every function is a no-op and the app behaves
// exactly as before (single container, no extra dependency).

const REDIS_URL = process.env.REDIS_URL || '';
export const cacheEnabled = !!REDIS_URL;
const TTL_SECONDS = parseInt(process.env.CACHE_TTL || '86400', 10);
const MAX_PER_FEED = parseInt(process.env.CACHE_ARTICLES_PER_FEED || '50', 10);

let client: Redis | null = null;
if (cacheEnabled) {
  client = new Redis(REDIS_URL, {
    // Fail fast and degrade gracefully when Redis is unavailable, instead of
    // queueing/hanging requests.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    // Une connexion ouverte qui ne répond plus (Redis en pause, réseau coupé sans
    // fermeture) : rien d'autre ne la borne, et le worker resterait arrêté dessus.
    commandTimeout: 5000,
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
  });
  let loggedError = false;
  client.on('error', (e: Error) => {
    if (!loggedError) { console.error('[cache] Redis error:', e.message); loggedError = true; }
  });
  client.on('connect', () => { loggedError = false; console.log('[cache] Redis connected'); });
}

const KEY_PREFIX = 'frirss:c:';

/**
 * Clé d'une lecture greader mise en cache :
 * `frirss:c:<compte>:<serveur>:<sha1(identité du serveur + URL)>`.
 *
 * Le SERVEUR (l'id de sa ligne dans `servers`) en fait partie : deux serveurs
 * d'un même compte peuvent avoir la même adresse — deux utilisateurs FreshRSS
 * sur la même instance — et donc les mêmes URL. Sans lui, la liste de l'un se
 * peignait sous l'autre (M-09, 1.9.0).
 *
 * L'IDENTITÉ du serveur (`serverCacheIdentity` : adresse normalisée et
 * utilisateur FreshRSS, telles que lues au DÉPART de la lecture) entre dans
 * l'empreinte : une ligne qui change d'utilisateur FreshRSS ou d'adresse garde
 * son id, et une lecture de l'ancien compte en vol pendant le changement était
 * écrite APRÈS la purge (`cachePurgeServer`), sous la même clé — peinte sous
 * le nouveau compte jusqu'à `CACHE_TTL` (relecture 1.9.0). Elle tombe
 * désormais sous une clé que plus personne ne lit, et qui expire seule.
 * L'identité reste dans l'empreinte, pas en clair : le motif de purge par
 * serveur (`serverCachePattern`) couvre toujours toutes ses clés.
 *
 * Le proxy et le worker de synchronisation doivent passer le même id et la
 * même identité, sinon le pré-remplissage n'est jamais relu. Les clés d'avant
 * ne sont plus lues et expirent avec `CACHE_TTL` ; `userCachePattern` les
 * couvre encore.
 */
export function cacheKey(userId: number | string, serverId: number | string, identity: string, target: string): string {
  const h = createHash('sha1').update(`${identity}\n${target}`).digest('hex').slice(0, 24);
  return `${KEY_PREFIX}${userId}:${serverId}:${h}`;
}

/**
 * L'identité d'un serveur pour la clé de cache : origine analysée (schéma,
 * hôte en minuscules, port par défaut omis), chemin sans barre finale, et
 * utilisateur FreshRSS. Deux écritures de la même adresse donnent la même
 * identité ; un autre utilisateur ou une autre adresse, une autre.
 */
export function serverCacheIdentity(url: string, freshrssUser: string): string {
  let address = url;
  try {
    const u = new URL(url);
    address = `${u.origin}${stripTrailingSlashes(u.pathname)}`;
  } catch { /* adresse illisible : prise telle quelle */ }
  return `${address}\n${freshrssUser}`;
}

/**
 * Clé du cache d'EXTRAITS d'articles.
 *
 * Contrairement à `cacheKey`, elle ne porte **aucun identifiant
 * d'utilisateur** : le texte extrait d'une page est le même pour tout le
 * monde, alors qu'une liste d'articles dépend de l'état de lecture du compte.
 * C'est cette absence qui fait qu'un Mac profite du travail d'un iPhone, et
 * qu'à dix comptes lisant les mêmes flux la page n'est extraite qu'une fois.
 * Y ajouter `userId` multiplierait le volume par le nombre de comptes et
 * annulerait le partage — sans rien casser de visible.
 *
 * Elle porte en revanche la VERSION de l'extraction (`EXTRACT_VERSION`) : un
 * extrait gardé par un algorithme antérieur n'est plus relu et expire avec
 * `CACHE_TTL` (A-2). Les clés de la 1.8.x n'en portaient pas.
 */
export function extractKey(url: string, version: number = EXTRACT_VERSION): string {
  return `frirss:x:v${version}:${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;
}

/**
 * Purge tout le cache applicatif (toutes les clés `frirss:c:*`).
 *
 * Nécessaire après une restauration de sauvegarde : `applyBackup` réinstalle
 * un jeu d'utilisateurs entièrement différent sur les MÊMES identifiants
 * numériques, et les clés de cache sont indexées par ce même identifiant.
 * Sans cette purge, l'utilisateur 1 restauré se verrait servir le cache de
 * l'ancien utilisateur 1 jusqu'à expiration (`CACHE_TTL`) — et c'est ce
 * contenu périmé que le client affiche en premier, avant toute revalidation.
 *
 * No-op si le cache est désactivé (`REDIS_URL` absent) : le cache est
 * optionnel, cette purge doit l'être tout autant.
 */
export async function cachePurgeAll(): Promise<void> {
  if (!client) return;
  try {
    let cursor = '0';
    do {
      const [next, keys]: [string, string[]] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await client.unlink(...keys);
    } while (cursor !== '0');
  } catch (e) {
    // Des listes de l'ancien compte restent jusqu'au TTL : cela doit se lire au journal.
    console.error('[cache] purge failed:', (e as Error).message);
  }
}

/**
 * Motif SCAN des clés de listes d'un compte (`cacheKey`), et d'elles seules.
 * Un nombre, pas la chaîne d'une URL : SQLite lit `'05'` comme 5 et supprime
 * le compte 5, mais le motif `…:05:*` ne couvre pas ses clés `…:5:…`.
 */
export function userCachePattern(userId: number): string {
  return `${KEY_PREFIX}${userId}:*`;
}

/**
 * Efface le cache d'un compte supprimé : ses listes d'articles restaient
 * sinon jusqu'à `CACHE_TTL` (24 h par défaut), une donnée personnelle qui
 * survivait à la suppression. Le cache partagé des extraits n'est pas touché.
 */
export async function cachePurgeUser(userId: number): Promise<void> {
  await purgeMatching(userCachePattern(userId));
}

/**
 * Motif SCAN des clés de listes d'UN serveur d'un compte. Des nombres lus en
 * base, pas l'en-tête ni l'URL, pour la même raison que `userCachePattern`.
 */
export function serverCachePattern(userId: number, serverId: number): string {
  return `${KEY_PREFIX}${userId}:${serverId}:*`;
}

/**
 * Efface les listes en cache d'un serveur supprimé, ou qui change d'identité
 * (autre adresse, autre utilisateur FreshRSS) en gardant son id : sans cela,
 * la ligne modifiée peignait la liste de l'ancien compte FreshRSS jusqu'à
 * `CACHE_TTL`, et un serveur supprimé laissait ses listes derrière lui.
 */
export async function cachePurgeServer(userId: number, serverId: number): Promise<void> {
  await purgeMatching(serverCachePattern(userId, serverId));
}

async function purgeMatching(pattern: string): Promise<void> {
  if (!client) return;
  try {
    let cursor = '0';
    do {
      const [next, keys]: [string, string[]] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await client.unlink(...keys);
    } while (cursor !== '0');
  } catch (e) {
    console.error('[cache] purge failed:', (e as Error).message);
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!client) return null;
  try { return await client.get(key); } catch { return null; }
}

export async function cacheDel(key: string): Promise<void> {
  if (!client) return;
  try { await client.del(key); } catch { /* le cache n'est qu'une aide */ }
}

export async function cacheSet(key: string, value: string, ttl = TTL_SECONDS): Promise<void> {
  if (!client) return;
  try { await client.set(key, value, 'EX', ttl); } catch { /* degrade silently */ }
}

/**
 * Trim a greader stream/contents JSON response to at most `max` items
 * (keeps the most recent — the API already returns newest-first).
 */
export function trimStreamJson(jsonString: string, max = MAX_PER_FEED): string {
  try {
    const obj = JSON.parse(jsonString) as { items?: unknown[] };
    if (Array.isArray(obj.items) && obj.items.length > max) {
      obj.items = obj.items.slice(0, max);
      return JSON.stringify(obj);
    }
    return jsonString;
  } catch {
    return jsonString; // not JSON → store untouched
  }
}


/**
 * Plafond d'une entrée de lecture écrite dans Redis par `/api/proxy`.
 *
 * Mesuré le 2026-10-30 sur 15 flux publics à contenu intégral, enveloppe
 * greader comprise : de 0,1 à 1,7 Mio la page de 50 articles, et 4,5 Mio pour le
 * pire vu (des essais longs, ~90 Kio l'article). 8 Mio laisse le double du pire
 * cas. Au-delà, la page reste servie : elle n'est simplement pas gardée.
 */
export const MAX_CACHED_ENTRY_BYTES = 8 * 1024 * 1024;

/**
 * Ce qu'une lecture proxifiée a le droit de déposer dans Redis, ou `null`.
 *
 * Le corps vient d'un hôte que le compte a choisi : n'importe qui peut
 * enregistrer le sien comme « serveur ». La taille se juge AVANT l'analyse :
 * 31 Mio de petits objets, relus dix fois par seconde, bloquaient la boucle
 * d'événements 5 s d'affilée pour une entrée qui n'était pas gardée. Puis seul
 * du JSON qui s'analyse passe (la lecture depuis le cache le rend en
 * `application/json`), coupé à `max` articles. Un BOM en tête, que `JSON.parse`
 * refuse, est retiré.
 */
export function cacheableEntry(body: string, max = MAX_PER_FEED, maxBytes = MAX_CACHED_ENTRY_BYTES): string | null {
  if (Buffer.byteLength(body) > maxBytes) return null;
  const text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object') return null;
  const { items } = parsed as { items?: unknown };
  if (!Array.isArray(items) || items.length <= max) return text;
  // Après `res.send` côté proxy : une imbrication extrême ne doit rien lever ici.
  try { return JSON.stringify({ ...parsed, items: items.slice(0, max) }); } catch { return null; }
}

/** Lectures gardées en mémoire en même temps par un compte : 4 × 32 Mio au pire. */
export const MAX_CACHE_READS_AT_ONCE = 4;
/** Octets lus pour le cache par compte et par minute : 64 Mio, ~7 s d'analyse au pire. */
export const MAX_CACHE_READ_BYTES_PER_MINUTE = 64 * 1024 * 1024;
const CACHE_READ_WINDOW_MS = 60_000;

const cacheReads = new Map<number | string, { reading: number; spent: number; since: number }>();

/**
 * La part d'un compte dans les lectures destinées au cache. Il enregistre l'hôte qu'il
 * veut comme serveur, donc il choisit le corps reçu : le plafond d'une réponse ne borne
 * ni leur somme en mémoire, ni le temps d'analyse, qui bloque le serveur pour tous.
 * `null` = part épuisée : la réponse est relayée en flux, simplement sans copie.
 */
export function claimCacheRead(userId: number | string, now = Date.now()): { done: (bytes: number) => void } | null {
  const part = cacheReads.get(userId) ?? { reading: 0, spent: 0, since: now };
  cacheReads.set(userId, part);
  if (now - part.since >= CACHE_READ_WINDOW_MS) {
    part.spent = 0;
    part.since = now;
  }
  if (part.reading >= MAX_CACHE_READS_AT_ONCE || part.spent >= MAX_CACHE_READ_BYTES_PER_MINUTE) return null;
  part.reading++;
  return {
    done: (bytes) => {
      part.reading--;
      part.spent += bytes;
    },
  };
}
