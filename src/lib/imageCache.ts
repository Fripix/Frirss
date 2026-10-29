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
  /** Download nothing: only find what is already prepared (device full). */
  noFetch: boolean;
  /** Account and server preparing (`user@server`), written on each new entry
   *  so that another server's sweep leaves it alone (`pruneImages`). */
  scope: string;
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
  /** Size of each kept URL: an image shared by several articles (a logo)
   *  must weigh once in the budget, which the caller can only do per URL. */
  sizes: Record<string, number>;
  /** Images that could not be stored. A minority always fails: some hosts
   *  refuse hotlinked requests, others are momentarily unreachable. */
  failed: number;
  /** First failure encountered, kept so a total failure can be diagnosed. */
  error?: string;
  /** A write was refused for lack of space (`QuotaExceededError`): the rest
   *  was only looked up (not counted as failed), and the caller should stop
   *  storing images. */
  full?: boolean;
}

const describe = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : String(e);

const BATCH = 4;

/** Real size of a prepared image, written at preparation so reading the
 *  stats never has to load the bodies. */
export const PREPARED_BYTES_HEADER = 'X-FriRSS-Bytes';
/** Accounts and servers that keep an entry (`user@server`, comma-separated,
 *  each URI-encoded): one browser, several servers, and an image — a logo,
 *  an avatar — may be wanted by more than one of them. */
export const PREPARED_SCOPE_HEADER = 'X-FriRSS-Scope';

/** Scopes keeping an entry; empty for one prepared before 1.8.0. A single
 *  plain `7@1` (the first form of the header) reads the same. */
export function entryScopes(res: Response | undefined): string[] {
  const raw = res?.headers?.get?.(PREPARED_SCOPE_HEADER);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
}

/**
 * Rewrite an entry with another list of scopes. The bytes are copied as they
 * are: the Cache API cannot change a stored response's headers in place.
 * Reads a clone, so `res` itself stays usable.
 */
async function rewriteScopes(cache: Cache, url: string, res: Response, scopes: string[], size?: number): Promise<void> {
  const copy = typeof res.clone === 'function' ? res.clone() : res;
  const headers = new Headers(copy.headers ?? undefined);
  headers.set(PREPARED_SCOPE_HEADER, scopes.map(encodeURIComponent).join(','));
  if (size != null && !headers.has(PREPARED_BYTES_HEADER)) headers.set(PREPARED_BYTES_HEADER, String(size));
  const body = typeof copy.arrayBuffer === 'function'
    ? await copy.arrayBuffer()
    : typeof copy.blob === 'function' ? await copy.blob() : null;
  await cache.put(url, new Response(body, { headers }));
}

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
  /** Only this account and server's entries (and untagged older ones) go:
   *  preparing server 2 removed every image prepared for server 1. An entry
   *  another scope also keeps only loses this one's mark — it goes when no
   *  scope keeps it any more. What a scope that never comes back still
   *  marks (a removed server) waits for "empty the images", which clears
   *  them all. */
  scope?: string,
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
      if (scope) {
        const res = await cache.match(req);
        const scopes = entryScopes(res);
        if (scopes.length && !scopes.includes(scope)) continue;
        const others = scopes.filter((s) => s !== scope);
        if (others.length && res) {
          // Encore voulue ailleurs : seule la marque de cette portée s'en va.
          // Une réécriture refusée la laisse telle quelle, jamais effacée.
          await rewriteScopes(cache, req.url, res, others).catch(() => {});
          continue;
        }
      }
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
  if (!urls.length) return { stored: 0, bytes: 0, reusedBytes: 0, kept: [], sizes: {}, failed: 0 };

  const fetchImage = deps.fetchImage ?? fetchViaProxy;
  const openCache = deps.openCache ?? opener(PREPARED_IMAGE_CACHE_NAME);
  const openBrowsing = deps.openBrowsingCache ?? opener(IMAGE_CACHE_NAME);

  let cache: Cache;
  try {
    cache = await openCache();
  } catch (e) {
    return { stored: 0, bytes: 0, reusedBytes: 0, kept: [], sizes: {}, failed: urls.length, error: `open: ${describe(e)}` };
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
  const sizes: Record<string, number> = {};
  const keep = (url: string, size: number) => { kept.push(url); sizes[url] = size; };
  // Keep the first failure: swallowing every error is what made a
  // 0-images-stored sweep impossible to diagnose.
  const note = (stage: string, e: unknown) => { failed++; error ??= `${stage}: ${describe(e)}`; };
  // Device full: every later image would fail too, after a wasted download —
  // and a full device is what makes the browser wipe the site's whole storage.
  // After it, the rest is only looked up — the images already prepared stay
  // in `kept`, or the final sweep would remove them.
  let full = false;
  const lookupOnly = () => full || deps.noFetch === true;

  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (url) => {
        let img: FetchedImage;
        try {
          const ready = await cache.match(url);
          if (ready) { // already offline-ready
            // Measured on a copy: an older entry without the size header is
            // measured by reading its body, which the rewrite below needs.
            const size = await preparedSize(typeof ready.clone === 'function' ? ready.clone() : ready);
            // Kept by this scope too, from now on: marked by another scope
            // only (or by none, before 1.8.0), its sweep removed an image
            // this one still wanted. A refused rewrite (full device) keeps
            // the image as it was.
            const scopes = entryScopes(ready);
            if (deps.scope && !scopes.includes(deps.scope)) {
              await rewriteScopes(cache, url, ready, [...scopes, deps.scope], size).catch(() => {});
            }
            reusedBytes += size;
            keep(url, size);
            return;
          }
          // Not attempted, so not a failure: « some sites refuse images »
          // would be the wrong explanation. Older entries are not adopted
          // either — adopting takes a write, which a full device refuses.
          if (lookupOnly()) return;
          const older = await browsing?.match(url);
          if (older && isLegacyPrepared(url, older, origin)) {
            // Measured on a copy first: `put` consumes the body.
            const size = await preparedSize(older.clone());
            // Adopted with this scope's mark, or the next sweep of any other
            // scope would take it for an untagged leftover.
            if (deps.scope) await rewriteScopes(cache, url, older, [deps.scope], size);
            else await cache.put(url, older);
            await browsing?.delete(url);
            reusedBytes += size;
            keep(url, size);
            return;
          }
          img = await fetchImage(url);
        } catch (e) {
          // Adopting an older entry writes too: a refusal there is the same
          // full device as below.
          if ((e as { name?: string })?.name === 'QuotaExceededError') { full = true; note('put', e); return; }
          note('fetch', e);
          return;
        }
        try {
          // The real size rides along, so reading the stats never loads bodies.
          const headers = new Headers(img.response.headers ?? undefined);
          headers.set(PREPARED_BYTES_HEADER, String(img.bytes));
          if (deps.scope) headers.set(PREPARED_SCOPE_HEADER, deps.scope);
          await cache.put(url, new Response(img.response.body ?? null, { headers }));
          stored++;
          bytes += img.bytes;
          keep(url, img.bytes);
        } catch (e) {
          if ((e as { name?: string })?.name === 'QuotaExceededError') full = true;
          note('put', e);
        }
      }),
    );
  }
  return { stored, bytes, reusedBytes, kept, sizes, failed, error, ...(full ? { full } : {}) };
}
