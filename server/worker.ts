import db from './db.js';
import { decrypt } from './crypto.js';
import { cacheEnabled, cacheKey, cacheSet, trimStreamJson } from './cache.js';
import { fetchUpstream } from './routes/proxy.js';

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
function streamTargets(serverUrl: string): string[] {
  const root = `${serverUrl}${BASE}/stream/contents`;
  return [
    `${root}/user/-/state/com.google/reading-list?output=json&n=${N}`,               // All
    `${root}/user/-/state/com.google/reading-list?output=json&n=${N}&xt=${XT_READ}`, // Unread
    `${root}/user/-/state/com.google/starred?output=json&n=${N}`,                    // Starred
  ];
}

interface SyncRow {
  user_id: number;
  url: string;
  freshrss_token: string;
}

let running = false;

async function syncUser(row: SyncRow): Promise<void> {
  const token = decrypt(row.freshrss_token);
  if (!token) return;
  const serverUrl = row.url.replace(/\/+$/, '');
  const headers = { Authorization: `GoogleLogin auth=${token}`, Accept: 'application/json' };
  for (const target of streamTargets(serverUrl)) {
    try {
      const resp = await fetchUpstream(target, { headers });
      if (!resp.ok) continue;
      const text = await resp.text();
      await cacheSet(cacheKey(row.user_id, target), trimStreamJson(text));
    } catch { /* skip this stream, keep going */ }
  }
}

async function runCycle(): Promise<void> {
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
      await Promise.all(users.slice(i, i + PARALLEL_USERS).map(syncUser));
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
