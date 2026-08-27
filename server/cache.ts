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

