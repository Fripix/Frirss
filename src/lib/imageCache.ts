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
  /** First failure encountered, kept so a silent 0 can be diagnosed. */
  error?: string;
}

const describe = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

const BATCH = 4;

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
  const { data } = await client.get<Blob>(url, { responseType: 'blob' });
  return {
    response: new Response(data, {
      headers: { 'Content-Type': data.type || 'application/octet-stream' },
    }),
    bytes: data.size,
  };
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
  if (!urls.length) return { stored: 0, bytes: 0 };

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
    return { stored: 0, bytes: 0, error: `open: ${describe(e)}` };
  }

  let stored = 0;
  let bytes = 0;
  let error: string | undefined;
  // Keep the first failure: swallowing every error is what made a
  // 0-images-stored sweep impossible to diagnose.
  const note = (stage: string, e: unknown) => { error ??= `${stage}: ${describe(e)}`; };

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
  return { stored, bytes, error };
}
