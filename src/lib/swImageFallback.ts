/**
 * Workbox plugin for the image route (vite.config.js): when the display cache
 * has nothing, serve the image the offline preparation stored in its own cache
 * (`PREPARED_IMAGE_CACHE_NAME`). Placed after the expiration plugin, which
 * returns null for a miss.
 *
 * workbox-build copies this function's source into sw.js: it must not refer to
 * anything outside its own body, hence the cache name as a literal (its test
 * checks the literal against the constant).
 */
export const preparedImageFallback = {
  cachedResponseWillBeUsed: async ({ request, cachedResponse }: {
    request: Request;
    cachedResponse?: Response | null;
  }): Promise<Response | null> =>
    cachedResponse ?? (await caches.match(request, { cacheName: 'frirss-offline-images' })) ?? null,
};
