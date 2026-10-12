import { Router } from 'express';
import { createHash } from 'crypto';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Persistent classification cache. Feed IDs are supplied by the authenticated
// client; the account ID and a hash of the sorted subscription set scope it.
db.exec(`
  CREATE TABLE IF NOT EXISTS infrequent_feed_cache (
    user_id INTEGER NOT NULL,
    subscription_hash TEXT NOT NULL,
    feed_ids TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, subscription_hash),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_infrequent_feed_cache_updated
    ON infrequent_feed_cache(updated_at);
`);

const MAX_FEEDS = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FEEDS ||
      value.some((id) => typeof id !== 'string' || id.length > 512)) return null;
  return [...new Set(value as string[])].sort();
}
function signature(ids: string[]): string {
  return createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

router.post('/lookup', (req, res) => {
  const ids = normalizeIds(req.body?.subscriptionIds);
  if (!ids) return res.status(400).json({ error: 'Invalid subscriptionIds' });
  const row = db.prepare(`
    SELECT feed_ids, updated_at FROM infrequent_feed_cache
    WHERE user_id = ? AND subscription_hash = ?
  `).get(req.user.id, signature(ids)) as { feed_ids: string; updated_at: number } | undefined;
  if (!row || Date.now() - row.updated_at > MAX_AGE_MS) {
    return res.json({ cached: false, feedIds: [] });
  }
  try {
    const feedIds = JSON.parse(row.feed_ids);
    if (!Array.isArray(feedIds) || feedIds.some((id) => typeof id !== 'string')) {
      return res.json({ cached: false, feedIds: [] });
    }
    return res.json({ cached: true, feedIds });
  } catch {
    return res.json({ cached: false, feedIds: [] });
  }
});

router.put('/', (req, res) => {
  const ids = normalizeIds(req.body?.subscriptionIds);
  const feedIds = normalizeIds(req.body?.feedIds);
  if (!ids || !feedIds) return res.status(400).json({ error: 'Invalid subscriptionIds or feedIds' });
  const now = Date.now();
  db.prepare(`
    INSERT INTO infrequent_feed_cache (user_id, subscription_hash, feed_ids, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, subscription_hash) DO UPDATE SET
      feed_ids = excluded.feed_ids, updated_at = excluded.updated_at
  `).run(req.user.id, signature(ids), JSON.stringify(feedIds), now);
  // Keep the cache bounded and remove expired rows.
  db.prepare('DELETE FROM infrequent_feed_cache WHERE updated_at < ?').run(now - 30 * 24 * 60 * 60 * 1000);
  res.json({ ok: true });
});

export default router;
