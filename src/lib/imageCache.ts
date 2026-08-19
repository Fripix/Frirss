import { IMAGE_CACHE_NAME } from './storageEstimate';

interface CacheImagesDeps {
  fetchFn: typeof fetch;
  openCache: () => Promise<Cache>;
}

/**
 * How many images are actually stored. Surfaced in the preferences: the cache
 * is otherwise invisible, and this number is what distinguishes "nothing was
 * ever stored" from "stored but not served".
 */
export async function countCachedImages(openCache?: () => Promise<Cache>): Promise<number> {
  try {
    const open = openCache
      ?? (() => {
        if (typeof caches === 'undefined') return Promise.reject(new Error('no CacheStorage'));
        return caches.open(IMAGE_CACHE_NAME);
      });
    const cache = await open();
    return (await cache.keys()).length;
  } catch {
    return 0;
  }
}

const BATCH = 4;

/**
 * Store images in the service worker's image cache for offline reading.
 *
 * Fetching alone is NOT enough: the Workbox runtime route matches on
 * `request.destination === 'image'`, which only holds for <img> element loads —
 * a programmatic fetch has an empty destination and never reaches that route.
 * Prefetched images therefore never landed in the cache, and only images the
 * user had actually scrolled past survived offline.
 *
 * So we write to the very cache the route reads from: when an <img> later asks
 * for the same URL offline, CacheFirst finds our entry and serves it.
 *
 * Cross-origin images come back opaque (status 0, unreadable size) — the Cache
 * API stores them fine. Note these direct writes bypass Workbox's expiration
 * bookkeeping, so pruning relies on the app-side budget, purgeOnQuotaError and
 * the user's "empty the images" action.
 *
 * Returns how many images were newly stored. Best-effort throughout.
 */
export async function cacheImages(
  urls: string[],
  deps: Partial<CacheImagesDeps> = {},
): Promise<number> {
  if (!urls.length) return 0;

  const fetchFn = deps.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const openCache = deps.openCache
    ?? (() => {
      if (typeof caches === 'undefined') return Promise.reject(new Error('no CacheStorage'));
      return caches.open(IMAGE_CACHE_NAME);
    });

  let cache: Cache;
  try {
    cache = await openCache();
  } catch {
    return 0;
  }

  let stored = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (url) => {
        try {
          if (await cache.match(url)) return; // already offline-ready
          const res = await fetchFn(url, { mode: 'no-cors', cache: 'force-cache' });
          await cache.put(url, res as Response);
          stored++;
        } catch { /* one bad image must not stop the sweep */ }
      }),
    );
  }
  return stored;
}
