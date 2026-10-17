import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

db.exec(`
  CREATE TABLE IF NOT EXISTS reading_open_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    article_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    article_text TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_reading_opens_user_server_time
    ON reading_open_events(user_id, server_id, opened_at);
  CREATE INDEX IF NOT EXISTS idx_reading_opens_article
    ON reading_open_events(user_id, server_id, article_id, opened_at);
`);

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

// The server is the source of truth. A short dedupe window absorbs React
// remounts/retries without treating a second deliberate read later as new data.
router.post('/open', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const serverId = Number(body.serverId);
  if (!Number.isSafeInteger(serverId) || serverId < 1
    || !validText(body.articleId, 512) || !body.articleId.trim()
    || !validText(body.title, 1000)
    || !validText(body.text, 4000)
    || typeof body.wordCount !== 'number' || !Number.isSafeInteger(body.wordCount) || body.wordCount < 0 || body.wordCount > 1000000) {
    return res.status(400).json({ error: 'Invalid reading event' });
  }

  const ownedServer = db.prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?').get(serverId, req.user.id);
  if (!ownedServer) return res.status(404).json({ error: 'FreshRSS server not found' });

  const recent = db.prepare(`
    SELECT id FROM reading_open_events
    WHERE user_id = ? AND server_id = ? AND article_id = ?
      AND opened_at >= datetime('now', '-30 seconds')
    ORDER BY id DESC LIMIT 1
  `).get(req.user.id, serverId, body.articleId.trim());

  if (recent) return res.json({ ok: true, deduplicated: true });

  db.prepare(`
    INSERT INTO reading_open_events
      (user_id, server_id, article_id, title, article_text, word_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, serverId, body.articleId.trim(), body.title, body.text, body.wordCount);

  // Bound disk growth while retaining a useful all-time history.
  db.prepare(`
    DELETE FROM reading_open_events
    WHERE user_id = ? AND server_id = ?
      AND id NOT IN (
        SELECT id FROM reading_open_events
        WHERE user_id = ? AND server_id = ?
        ORDER BY id DESC LIMIT 5000
      )
  `).run(req.user.id, serverId, req.user.id, serverId);

  res.status(201).json({ ok: true });
});

router.get('/', (req, res) => {
  const serverId = Number(req.query.serverId);
  if (!Number.isSafeInteger(serverId) || serverId < 1) {
    return res.status(400).json({ error: 'A valid serverId is required' });
  }
  const ownedServer = db.prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?').get(serverId, req.user.id);
  if (!ownedServer) return res.status(404).json({ error: 'FreshRSS server not found' });

  const events = db.prepare(`
    SELECT article_id AS articleId, title, article_text AS text, word_count AS wordCount,
           CAST(strftime('%s', opened_at) AS INTEGER) * 1000 AS openedAt
    FROM reading_open_events
    WHERE user_id = ? AND server_id = ?
    ORDER BY opened_at DESC LIMIT 5000
  `).all(req.user.id, serverId);
  res.json({ events });
});

export default router;
