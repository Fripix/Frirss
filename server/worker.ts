import db from './db.js';
import { decrypt } from './crypto.js';
import { cacheEnabled, cacheKey, cacheSet, trimStreamJson } from './cache.js';
import { fetchUpstream, readBodyText, PROXY_TOTAL_TIMEOUT_MS } from './routes/proxy.js';
import { stripTrailingSlashes } from './validate.js';

// Optional background sync (Model B): periodically pre-fetch each active user's
// main streams (All / Unread / Starred) from FreshRSS and store them in the
// cache, so they're instant on connect — even with no browser open.
// Disabled unless the cache is on (REDIS_URL) and CACHE_SYNC_INTERVAL > 0.

const INTERVAL_MIN = parseInt(process.env.CACHE_SYNC_INTERVAL || '0', 10);
const ACTIVE_DAYS = parseInt(process.env.CACHE_SYNC_ACTIVE_DAYS || '7', 10);
const PARALLEL_USERS = Math.max(1, parseInt(process.env.CACHE_SYNC_PARALLEL_USERS || '3', 10));

// Must mirror the frontend PAGE_SIZE so the cache keys line up; a mismatch only
// makes the pre-cache ineffective (cache miss → live fetch), never breaks.
const N = 50;
const BASE = '/api/greader.php/reader/api/0';
const XT_READ = 'user%2F-%2Fstate%2Fcom.google%2Fread'; // URLSearchParams-encoded

// Exactly the URLs the client builds for the global views (keys must match).
// The home view is `org.freshrss/main` on FreshRSS 1.28+ (feed visibility
// honoured) and `reading-list` before that; the worker cannot tell which one
// a user's server is, so it warms both — the unknown stream answers 400 on an
// old server and is simply skipped below.
function streamTargets(serverUrl: string): string[] {
  const root = `${serverUrl}${BASE}/stream/contents`;
  return [
    `${root}/user/-/state/org.freshrss/main?output=json&n=${N}`,                     // All (1.28+)
    `${root}/user/-/state/org.freshrss/main?output=json&n=${N}&xt=${XT_READ}`,       // Unread (1.28+)
    `${root}/user/-/state/com.google/reading-list?output=json&n=${N}`,               // All (older)
    `${root}/user/-/state/com.google/reading-list?output=json&n=${N}&xt=${XT_READ}`, // Unread (older)
    `${root}/user/-/state/com.google/starred?output=json&n=${N}`,                    // Starred
  ];
}

interface SyncRow {
  user_id: number;
  url: string;
  freshrss_token: string;
}

let running = false;

/**
 * Pré-remplit le cache d'un compte. Chaque flux a une échéance totale et un
 * plafond de corps (ceux des lectures mises en cache du proxy) : le corps était
 * lu par `resp.text()` sans l'un ni l'autre — le délai de `fetchUpstream`
 * s'arrête aux en-têtes. Un serveur qui ne finissait jamais sa réponse bloquait
 * la synchronisation de TOUS les comptes jusqu'au redémarrage, et une réponse
 * sans fin remplissait la mémoire du processus. Exporté pour les tests.
 */
export async function syncUser(row: SyncRow, deadlineMs = PROXY_TOTAL_TIMEOUT_MS): Promise<void> {
  const token = decrypt(row.freshrss_token);
  if (!token) return;
  const serverUrl = stripTrailingSlashes(row.url);
  const headers = { Authorization: `GoogleLogin auth=${token}`, Accept: 'application/json' };
  for (const target of streamTargets(serverUrl)) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deadlineMs);
    try {
      const resp = await fetchUpstream(target, { headers, signal: deadline.signal });
      if (!resp.ok) { resp.body?.cancel().catch(() => {}); continue; }
      const text = await readBodyText(resp, deadline.signal);
      await cacheSet(cacheKey(row.user_id, target), trimStreamJson(text));
    } catch { /* skip this stream, keep going */ } finally {
      clearTimeout(timer);
    }
  }
}

/** Un cycle complet. Exporté pour les tests, qui ne passaient que par `syncUser`. */
export async function runCycle(): Promise<void> {
  if (running) return; // no overlap
  running = true;
  try {
    const users = db.prepare(`
      SELECT s.user_id, s.url, s.freshrss_token
      FROM servers s
      JOIN users u ON u.id = s.user_id
      WHERE s.is_default = 1
        AND s.freshrss_token IS NOT NULL AND s.freshrss_token != ''
        AND u.active = 1
        AND u.last_active_at IS NOT NULL
        AND u.last_active_at > datetime('now', ?)
    `).all(`-${ACTIVE_DAYS} days`) as SyncRow[];

    for (let i = 0; i < users.length; i += PARALLEL_USERS) {
      // Appel explicite : `.map(syncUser)` passait l'index comme échéance
      // (0, 1, 2 ms), et plus rien n'entrait dans le cache.
      await Promise.all(users.slice(i, i + PARALLEL_USERS).map((row) => syncUser(row)));
    }
    if (users.length) console.log(`[sync] pre-cached ${users.length} active user(s)`);
  } catch (e) {
    console.error('[sync] cycle error:', (e as Error).message);
  } finally {
    running = false;
  }
}

export function startBackgroundSync(): void {
  if (!cacheEnabled || INTERVAL_MIN <= 0) return; // opt-in only
  console.log(`[sync] background sync every ${INTERVAL_MIN} min (active ≤ ${ACTIVE_DAYS}d, ${PARALLEL_USERS} parallel)`);
  const first = setTimeout(runCycle, 10_000);    // shortly after startup
  first.unref?.();
  const loop = setInterval(runCycle, INTERVAL_MIN * 60_000);
  loop.unref?.();
}
