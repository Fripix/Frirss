import { IMAGE_CACHE_NAME, PREPARED_IMAGE_CACHE_NAME } from './storageEstimate';
import client from '../api/client';

/** A fetched image: a storable response plus its real size in bytes. */
export interface FetchedImage {
  response: Response;
  bytes: number;
}

interface CacheImagesDeps {
  fetchImage: (url: string) => Promise<FetchedImage>;
  /** The prepared-images cache, written by this module only. */
  openCache: () => Promise<Cache>;
  /** The service worker's display cache, read to adopt older prepared entries. */
  openBrowsingCache: () => Promise<Cache>;
}

export interface CacheImagesResult {
  stored: number;
  /** Real bytes stored — readable because the proxy response is same-origin. */
  bytes: number;
  /** Bytes of images already prepared and kept as they were: they count
   *  toward the budget like new ones, or the cache would outgrow it. */
  reusedBytes: number;
  /** Every URL now held in the prepared cache (new or already there). */
  kept: string[];
  /** Images that could not be stored. A minority always fails: some hosts
   *  refuse hotlinked requests, others are momentarily unreachable. */
  failed: number;
  /** First failure encountered, kept so a total failure can be diagnosed. */
  error?: string;
}

const describe = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

const BATCH = 4;

/** Real size of a prepared image, written at preparation so reading the
 *  stats never has to load the bodies. */
export const PREPARED_BYTES_HEADER = 'X-FriRSS-Bytes';

/**
 * Fetch an image through the backend proxy, exactly like feed favicons.
 *
 * A direct cross-origin fetch cannot work here: the CSP sends
 * `connect-src 'self'`, so every such request is blocked by the browser —
 * which is why prefetching silently stored nothing at all. Going through the
 * same-origin proxy also makes the response non-opaque, so its size is
 * readable (cross-origin responses are opaque and padded by browsers).
 */
async function fetchViaProxy(url: string): Promise<FetchedImage> {
  // X-Proxy-Image tells the backend to add a Referer matching the image's own
  // site, which is what hotlink-protected CDNs check before answering 403.
  const { data } = await client.get<Blob>(url, {
    responseType: 'blob',
    headers: { 'X-Proxy-Image': '1' },
  });
  return {
    response: new Response(data, {
      headers: { 'Content-Type': data.type || 'application/octet-stream' },
    }),
    bytes: data.size,
  };
}

const opener = (name: string) => () => {
  if (typeof caches === 'undefined') return Promise.reject(new Error('no CacheStorage'));
  return caches.open(name);
};

/** Size of a prepared entry: its header, or its body for an older entry. */
async function preparedSize(res: Response): Promise<number> {
  const tagged = res.headers?.get?.(PREPARED_BYTES_HEADER);
  if (tagged != null) {
    const n = Number(tagged);
    return Number.isFinite(n) ? n : 0;
  }
  try { return (await res.blob()).size; } catch { return 0; }
}

/** An entry of the display cache that a previous version prepared: readable
 *  (it came through the proxy) although keyed by another site's URL. */
function isLegacyPrepared(url: string, res: Response, origin: string): boolean {
  if (res.headers?.get?.(PREPARED_BYTES_HEADER) != null) return true;
  if (res.type === 'opaque') return false;
  try { return new URL(url).origin !== origin; } catch { return false; }
}

const ownOrigin = () => (typeof location === 'undefined' ? '' : location.origin);

export interface CachedImageStats {
  total: number;
  /** Stored by the offline preparation: readable, real size known. */
  prepared: number;
  preparedBytes: number;
  /** Kept on display by the service worker. Mostly opaque cross-origin
   *  responses: their size is unreadable, and the browser's storage estimate
   *  pads each one by several megabytes. */
  browsing: number;
}

/**
 * What the image caches hold. Surfaced in the preferences: the caches are
 * otherwise invisible, and the browser's own estimate — inflated by opaque
 * entries — cannot say how much space the prepared images really take.
 *
 * Everything in the prepared cache is prepared. The display cache may still
 * hold images prepared by a version that shared it (readable yet keyed by
 * another site's URL); they count as prepared until a preparation adopts them.
 */
export async function cachedImageStats(
  openPrepared: () => Promise<Cache> = opener(PREPARED_IMAGE_CACHE_NAME),
  openBrowsing: () => Promise<Cache> = opener(IMAGE_CACHE_NAME),
  origin: string = ownOrigin(),
): Promise<CachedImageStats> {
  const stats: CachedImageStats = { total: 0, prepared: 0, preparedBytes: 0, browsing: 0 };
  try {
    const cache = await openPrepared();
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      stats.total++;
      stats.prepared++;
      stats.preparedBytes += await preparedSize(res);
    }
  } catch { /* unavailable: report what was counted */ }
  try {
    const cache = await openBrowsing();
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      stats.total++;
      if (isLegacyPrepared(req.url, res, origin)) {
        stats.prepared++;
        stats.preparedBytes += await preparedSize(res);
      } else {
        stats.browsing++;
      }
    }
  } catch { /* unavailable: report what was counted */ }
  return stats;
}

/**
 * Remove prepared images the last preparation did not keep — an article that
 * left the 30-day window, or one past the budget. Nothing else ever evicts
 * from this cache: without this sweep it would grow with every preparation.
 */
export async function pruneImages(
  keep: Set<string>,
  openCache: () => Promise<Cache> = opener(PREPARED_IMAGE_CACHE_NAME),
): Promise<number> {
  let removed = 0;
  // Les clés du cache sont normalisées (`Request.url`), les URL gardées sont
  // telles que l'article les écrit : comparées brutes, une image avec un
  // accent, une espace ou un hôte en majuscules était retirée à chaque fois.
  const wanted = new Set([...keep].map((u) => { try { return new URL(u).href; } catch { return u; } }));
  try {
    const cache = await openCache();
    for (const req of await cache.keys()) {
      if (wanted.has(req.url)) continue;
      if (await cache.delete(req)) removed++;
    }
  } catch { /* best effort */ }
  return removed;
}

/**
 * Store images for offline reading, in a cache of their own.
 *
 * Fetching alone is NOT enough: the Workbox runtime route matches on
 * `request.destination === 'image'`, which only holds for <img> element loads —
 * a programmatic fetch has an empty destination and never reaches that route.
 * So we write entries keyed by the ORIGINAL image URL, and the route falls back
 * to this cache when its own has nothing (see vite.config.js): an <img> asking
 * for the image offline is served these bytes, though they came via the proxy.
 *
 * The cache is apart from the display one on purpose: that one is capped and
 * purged on quota errors by Workbox, and a prepared image living there entered
 * the cap the first time it was displayed. Here only the budget, the sweep
 * (`pruneImages`) and "empty the images" remove anything.
 *
 * Best-effort throughout; one bad image never stops the sweep.
 */
export async function cacheImages(
  urls: string[],
  deps: Partial<CacheImagesDeps> = {},
): Promise<CacheImagesResult> {
  if (!urls.length) return { stored: 0, bytes: 0, reusedBytes: 0, kept: [], failed: 0 };

  const fetchImage = deps.fetchImage ?? fetchViaProxy;
  const openCache = deps.openCache ?? opener(PREPARED_IMAGE_CACHE_NAME);
  const openBrowsing = deps.openBrowsingCache ?? opener(IMAGE_CACHE_NAME);

  let cache: Cache;
  try {
    cache = await openCache();
  } catch (e) {
    return { stored: 0, bytes: 0, reusedBytes: 0, kept: [], failed: urls.length, error: `open: ${describe(e)}` };
  }
  // Only used to adopt older prepared entries: its absence changes nothing else.
  const browsing = await openBrowsing().catch(() => null);
  const origin = ownOrigin();

  let stored = 0;
  let bytes = 0;
  let reusedBytes = 0;
  let failed = 0;
  let error: string | undefined;
  const kept: string[] = [];
  // Keep the first failure: swallowing every error is what made a
  // 0-images-stored sweep impossible to diagnose.
  const note = (stage: string, e: unknown) => { failed++; error ??= `${stage}: ${describe(e)}`; };

  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (url) => {
        let img: FetchedImage;
        try {
          const ready = await cache.match(url);
          if (ready) { // already offline-ready
            reusedBytes += await preparedSize(ready);
            kept.push(url);
            return;
          }
          const older = await browsing?.match(url);
          if (older && isLegacyPrepared(url, older, origin)) {
            // Measured on a copy first: `put` consumes the body.
            const size = await preparedSize(older.clone());
            await cache.put(url, older);
            await browsing?.delete(url);
            reusedBytes += size;
            kept.push(url);
            return;
          }
          img = await fetchImage(url);
        } catch (e) {
          note('fetch', e);
          return;
        }
        try {
          // The real size rides along, so reading the stats never loads bodies.
          const headers = new Headers(img.response.headers ?? undefined);
          headers.set(PREPARED_BYTES_HEADER, String(img.bytes));
          await cache.put(url, new Response(img.response.body ?? null, { headers }));
          stored++;
          bytes += img.bytes;
          kept.push(url);
        } catch (e) {
          note('put', e);
        }
      }),
    );
  }
  return { stored, bytes, reusedBytes, kept, failed, error };
}
