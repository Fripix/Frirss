import { Redis } from 'ioredis';
import { createHash } from 'crypto';

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
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
  });
  let loggedError = false;
  client.on('error', (e: Error) => {
    if (!loggedError) { console.error('[cache] Redis error:', e.message); loggedError = true; }
  });
  client.on('connect', () => { loggedError = false; console.log('[cache] Redis connected'); });
}

const KEY_PREFIX = 'frirss:c:';

/** Namespaced key for a cached response of `target` belonging to `userId`. */
export function cacheKey(userId: number | string, target: string): string {
  const h = createHash('sha1').update(target).digest('hex').slice(0, 24);
  return `${KEY_PREFIX}${userId}:${h}`;
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
 */
export function extractKey(url: string): string {
  return `frirss:x:${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;
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
  } catch {
    /* degrade silently, comme le reste du module */
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
  if (!client) return;
  try {
    let cursor = '0';
    do {
      const [next, keys]: [string, string[]] = await client.scan(cursor, 'MATCH', userCachePattern(userId), 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await client.unlink(...keys);
    } while (cursor !== '0');
  } catch {
    /* degrade silently, comme le reste du module */
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!client) return null;
  try { return await client.get(key); } catch { return null; }
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
 * enregistrer le sien comme « serveur ». Seul du JSON qui s'analyse passe (la
 * lecture depuis le cache le rend en `application/json`), coupé à `max`
 * articles, et jugé APRÈS la coupe : une longue réponse ramenée à 50 articles
 * reste légitime. Le plafond est en octets, ceux que Redis stocke.
 */
export function cacheableEntry(body: string, max = MAX_PER_FEED, maxBytes = MAX_CACHED_ENTRY_BYTES): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object') return null;
  const { items } = parsed as { items?: unknown };
  const entry = Array.isArray(items) && items.length > max
    ? JSON.stringify({ ...parsed, items: items.slice(0, max) })
    : body;
  return Buffer.byteLength(entry) > maxBytes ? null : entry;
}
