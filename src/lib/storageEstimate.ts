/** Workbox runtime cache holding article images (see vite.config.js). */
export const IMAGE_CACHE_NAME = 'frirss-images';

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

/** Human size, rounded — never presented as exact. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} Go`;
  return `${Math.round(bytes / MB)} Mo`;
}

/** Drop every cached image (the user-facing "empty the images" action). */
export async function clearImageCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete(IMAGE_CACHE_NAME);
  } catch { /* ignore */ }
}
