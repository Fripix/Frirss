/** Workbox runtime cache holding article images kept on display (see
 *  vite.config.js): capped, and purged by Workbox on a quota error. */
export const IMAGE_CACHE_NAME = 'frirss-images';

/** Images stored by the offline preparation, apart from the display cache so
 *  its cap and purge never reach them. The service worker falls back to it;
 *  the name is repeated as a literal in vite.config.js (serialized plugin). */
export const PREPARED_IMAGE_CACHE_NAME = 'frirss-offline-images';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Browser-reported storage for this origin. Covers everything (precache,
 * IndexedDB, image cache) — cross-origin images are opaque, so their real size
 * is never readable; this is the honest approximation. `null` when unsupported.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}

/** Human size, rounded — never presented as exact. Units and decimal
 *  separator come from the interface language. */
export function formatBytes(
  bytes: number,
  units: { mb: string; gb: string } = { mb: 'Mo', gb: 'Go' },
  locale = 'fr',
): string {
  if (bytes >= GB) {
    const n = (bytes / GB).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${n} ${units.gb}`;
  }
  // A non-zero size never rounds down to 0: it would read as nothing stored.
  const mb = bytes > 0 ? Math.max(1, Math.round(bytes / MB)) : 0;
  return `${mb.toLocaleString(locale)} ${units.mb}`;
}

/** Drop every cached image, prepared or kept on display (the user-facing
 *  "empty the images" action). */
export async function clearImageCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await Promise.all([caches.delete(IMAGE_CACHE_NAME), caches.delete(PREPARED_IMAGE_CACHE_NAME)]);
  } catch { /* ignore */ }
}
