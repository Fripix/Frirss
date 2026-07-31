// ═══════════════════════════════════════════════════════════════════════
// Favicon cache — two-tier, persistent.
//
// Feed favicons are fetched through the authenticated backend proxy (a plain
// <img> can't send the JWT), so they can't rely on the browser's HTTP cache.
// We keep the resolved value (a data: URL, or a directly-loadable URL) in an
// in-memory map backed by localStorage, keyed by the (normalised) icon URL.
//
// The persistent tier is what kills the reload flash: on startup FeedFavicon
// reads it synchronously and paints the icon immediately, with no re-fetch.
// ═══════════════════════════════════════════════════════════════════════

const MEM = new Map<string, string>();
const PREFIX = 'frirss_favicon:';

/** Resolved favicon src for a URL (memory → localStorage), or null if unknown. */
export function getFavicon(url: string | undefined): string | null {
  if (!url) return null;
  const cached = MEM.get(url);
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(PREFIX + url);
    if (stored) {
      MEM.set(url, stored); // promote for the rest of the session
      return stored;
    }
  } catch {
    // localStorage unavailable — memory tier only.
  }
  return null;
}

/** Cache a resolved favicon src (write-through to localStorage). */
export function setFavicon(url: string | undefined, value: string): void {
  if (!url || !value) return;
  MEM.set(url, value);
  try {
    localStorage.setItem(PREFIX + url, value);
  } catch {
    // Quota/unavailable — the in-memory copy still serves this session.
  }
}

/** Read a Blob as a data: URL (persistable, usable directly as <img src>). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
