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
//
// Revérification (1.9.2) : une icône gardée n'est plus éternelle. Passé
// `FAVICON_MAX_AGE_MS` — ou sans date, pour celles gardées avant —, elle reste
// affichée et `refreshFavicon` la redemande une fois en arrière-plan. Sans
// cela, un navigateur qui avait chargé les icônes pendant que FreshRSS servait
// son icône par défaut (un globe, en 200, pour une adresse qu'il n'a pas
// encore — après son changement de format d'adresse) gardait le globe pour
// toujours, alors que FreshRSS avait depuis la vraie icône (2026-11-24).
// ═══════════════════════════════════════════════════════════════════════

const MEM = new Map<string, string>();
const PREFIX = 'frirss_favicon:';
/** Date de la dernière vérification de chaque icône, une seule clé JSON. */
const CHECKED_KEY = 'frirss_faviconChecked';
export const FAVICON_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let checked: Record<string, number> | null = null;
/** Adresses déjà redemandées dans cette session (réussite ou échec). */
const tried = new Map<string, Promise<string | null>>();

function checkedTimes(): Record<string, number> {
  if (checked) return checked;
  checked = {};
  try {
    const raw = JSON.parse(localStorage.getItem(CHECKED_KEY) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'number') checked[k] = v;
    }
  } catch {
    // Valeur abîmée ou stockage absent : tout est à revérifier, sans erreur.
  }
  return checked;
}

function markChecked(url: string, now: number): void {
  const times = checkedTimes();
  times[url] = now;
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(times));
  } catch {
    // Quota/unavailable — la date vaut pour cette session.
  }
}

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

/** Cache a resolved favicon src (write-through to localStorage), checked now. */
export function setFavicon(url: string | undefined, value: string, now = Date.now()): void {
  if (!url || !value) return;
  MEM.set(url, value);
  markChecked(url, now);
  try {
    localStorage.setItem(PREFIX + url, value);
  } catch {
    // Quota/unavailable — the in-memory copy still serves this session.
  }
}

/** L'icône gardée doit-elle être redemandée (jamais vérifiée, ou trop ancienne) ? */
export function faviconIsStale(url: string, now = Date.now()): boolean {
  const at = checkedTimes()[url];
  return at === undefined || now - at > FAVICON_MAX_AGE_MS;
}

/**
 * Redemande une icône gardée. `fetchImage` rend un `data:` d'image, ou `null`
 * si la réponse n'en est pas une ou échoue : l'icône gardée reste alors, sans
 * nouvel essai dans la session (la prochaine le refera). Une seule requête par
 * adresse et par session, même quand la barre latérale et la liste affichent
 * la même icône au même moment.
 */
export function refreshFavicon(
  url: string,
  fetchImage: (url: string) => Promise<string | null>,
): Promise<string | null> {
  const pending = tried.get(url);
  if (pending) return pending;
  const run = fetchImage(url)
    .catch(() => null)
    .then((value) => {
      if (value) setFavicon(url, value);
      return value;
    });
  tried.set(url, run);
  return run;
}

/** Tests : oublie la session (et la mémoire, pour simuler un rechargement). */
export function resetFaviconSession({ dropMemory = false }: { dropMemory?: boolean } = {}): void {
  tried.clear();
  checked = null;
  if (dropMemory) MEM.clear();
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
