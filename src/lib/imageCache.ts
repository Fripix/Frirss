import { IMAGE_CACHE_NAME } from './storageEstimate';
import client from '../api/client';

/** A fetched image: a storable response plus its real size in bytes. */
export interface FetchedImage {
  response: Response;
  bytes: number;
}

interface CacheImagesDeps {
  fetchImage: (url: string) => Promise<FetchedImage>;
  openCache: () => Promise<Cache>;
}

export interface CacheImagesResult {
  stored: number;
  /** Real bytes stored — readable because the proxy response is same-origin. */
  bytes: number;
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
      headers: {
        'Content-Type': data.type || 'application/octet-stream',
        [PREPARED_BYTES_HEADER]: String(data.size),
      },
    }),
    bytes: data.size,
  };
}

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
 * What the image cache holds, split by how it got there. Surfaced in the
 * preferences: the cache is otherwise invisible, and the browser's own
 * estimate — inflated by opaque entries — cannot say how much space the
 * prepared images really take.
 *
 * A prepared image is keyed by its original (other-site) URL yet readable,
 * because its bytes came through the proxy. A readable same-origin entry was
 * kept on display, not prepared.
 */
export async function cachedImageStats(
  openCache?: () => Promise<Cache>,
  origin: string = typeof location === 'undefined' ? '' : location.origin,
): Promise<CachedImageStats> {
  const stats: CachedImageStats = { total: 0, prepared: 0, preparedBytes: 0, browsing: 0 };
  try {
    const open = openCache
      ?? (() => {
        if (typeof caches === 'undefined') return Promise.reject(new Error('no CacheStorage'));
        return caches.open(IMAGE_CACHE_NAME);
      });
    const cache = await open();
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      stats.total++;
      let sameOrigin = false;
      try { sameOrigin = new URL(req.url).origin === origin; } catch { /* keep false */ }
      const tagged = res.headers.get(PREPARED_BYTES_HEADER);
      if (tagged === null && (res.type === 'opaque' || sameOrigin)) {
        stats.browsing++;
        continue;
      }
      stats.prepared++;
      // Entries stored before the header existed: read the size from the body.
      const bytes = tagged !== null ? Number(tagged) : (await res.blob()).size;
      stats.preparedBytes += Number.isFinite(bytes) ? bytes : 0;
    }
  } catch { /* unavailable: report what was counted */ }
  return stats;
}

/**
 * Store images in the service worker's image cache for offline reading.
 *
 * Fetching alone is NOT enough: the Workbox runtime route matches on
 * `request.destination === 'image'`, which only holds for <img> element loads —
 * a programmatic fetch has an empty destination and never reaches that route.
 * So we write to the very cache the route reads from, keyed by the ORIGINAL
 * image URL: when an <img> later asks for it offline, CacheFirst finds our
 * entry and serves it, even though the bytes came through the proxy.
 *
 * Note these direct writes bypass Workbox's expiration bookkeeping, so pruning
 * relies on the app-side budget, purgeOnQuotaError and "empty the images".
 *
 * Best-effort throughout; one bad image never stops the sweep.
 */
export async function cacheImages(
  urls: string[],
  deps: Partial<CacheImagesDeps> = {},
): Promise<CacheImagesResult> {
  if (!urls.length) return { stored: 0, bytes: 0, failed: 0 };

  const fetchImage = deps.fetchImage ?? fetchViaProxy;
  const openCache = deps.openCache
    ?? (() => {
      if (typeof caches === 'undefined') return Promise.reject(new Error('no CacheStorage'));
      return caches.open(IMAGE_CACHE_NAME);
    });

  let cache: Cache;
  try {
    cache = await openCache();
  } catch (e) {
    return { stored: 0, bytes: 0, failed: urls.length, error: `open: ${describe(e)}` };
  }

  let stored = 0;
  let bytes = 0;
  let failed = 0;
  let error: string | undefined;
  // Keep the first failure: swallowing every error is what made a
  // 0-images-stored sweep impossible to diagnose.
  const note = (stage: string, e: unknown) => { failed++; error ??= `${stage}: ${describe(e)}`; };

  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (url) => {
        let img: FetchedImage;
        try {
          if (await cache.match(url)) return; // already offline-ready
          img = await fetchImage(url);
        } catch (e) {
          note('fetch', e);
          return;
        }
        try {
          await cache.put(url, img.response);
          stored++;
          bytes += img.bytes;
        } catch (e) {
          note('put', e);
        }
      }),
    );
  }
  return { stored, bytes, failed, error };
}
