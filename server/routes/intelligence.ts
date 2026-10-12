import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Feedback is keyed by the authenticated user and stable article ID. A vote
// replaces the previous vote; DELETE removes it (the UI's undo action).
db.exec(`
  CREATE TABLE IF NOT EXISTS intelligence_feedback (
    user_id INTEGER NOT NULL,
    article_id TEXT NOT NULL,
    article_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, article_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_intelligence_feedback_user_vote
    ON intelligence_feedback(user_id, vote);
`);

// Additive migration for databases created before article text was stored.
for (const [column, definition] of [['summary', "TEXT NOT NULL DEFAULT ''"], ['content', "TEXT NOT NULL DEFAULT ''"]] as const) {
  const columns = db.prepare('PRAGMA table_info(intelligence_feedback)').all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec('ALTER TABLE intelligence_feedback ADD COLUMN ' + column + ' ' + definition);
  }
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

router.get('/feedback', (req, res) => {
  const rows = db.prepare(`
    SELECT article_id AS articleId, article_url AS url, title, summary, content, source_id AS sourceId,
           vote, created_at AS createdAt, updated_at AS updatedAt
    FROM intelligence_feedback WHERE user_id = ?
    ORDER BY updated_at DESC LIMIT 5000
  `).all(req.user.id);
  res.json({ feedback: rows });
});

router.put('/feedback', (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!validText(body.articleId, 512) || !body.articleId.trim()
    || !validText(body.url, 4096) || !validText(body.title, 2000) || !validText(body.summary, 10000)
    || !validText(body.content, 100000) || !validText(body.sourceId, 512)
    || (body.vote !== 1 && body.vote !== -1)) {
    return res.status(400).json({ error: 'Invalid article feedback', fields: {
      articleId: typeof body.articleId === 'string' ? (body.articleId.trim().length ? 'ok' : 'empty') : 'invalid type',
      url: typeof body.url === 'string' ? (body.url.length <= 4096 ? 'ok' : 'too long') : 'invalid type',
      title: typeof body.title === 'string' ? (body.title.length <= 2000 ? 'ok' : 'too long') : 'invalid type',
      summary: typeof body.summary === 'string' ? (body.summary.length <= 10000 ? 'ok' : 'too long') : 'invalid type',
      content: typeof body.content === 'string' ? (body.content.length <= 100000 ? 'ok' : 'too long') : 'invalid type',
      sourceId: typeof body.sourceId === 'string' ? (body.sourceId.length <= 512 ? 'ok' : 'too long') : 'invalid type',
      vote: body.vote === 1 || body.vote === -1 ? 'ok' : 'invalid value',
    } });
  }

  db.prepare(`
    INSERT INTO intelligence_feedback
      (user_id, article_id, article_url, title, summary, content, source_id, vote, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, article_id) DO UPDATE SET
      article_url=excluded.article_url, title=excluded.title,
      summary=excluded.summary, content=excluded.content, source_id=excluded.source_id, vote=excluded.vote,
      updated_at=datetime('now')
  `).run(req.user.id, body.articleId.trim(), body.url, body.title, body.summary, body.content, body.sourceId, body.vote);

  res.json({ ok: true, articleId: body.articleId.trim(), vote: body.vote });
});

router.delete('/feedback/:articleId', (req, res) => {
  if (typeof req.params.articleId !== 'string' || req.params.articleId.length > 512) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }
  const result = db.prepare(
    'DELETE FROM intelligence_feedback WHERE user_id = ? AND article_id = ?'
  ).run(req.user.id, req.params.articleId);
  res.json({ ok: true, removed: result.changes > 0 });
});

export default router;
