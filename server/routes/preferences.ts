import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ── GET /api/preferences ────────────────────────────────────────────
// Returns all preferences for the authenticated user as a flat object
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM preferences WHERE user_id = ?').all(req.user.id) as { key: string; value: string }[];

  const prefs: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      prefs[row.key] = JSON.parse(row.value);
    } catch {
      prefs[row.key] = row.value;
    }
  }

  res.json({ preferences: prefs });
});

// ── PUT /api/preferences ────────────────────────────────────────────
// Bulk upsert: { "key1": value1, "key2": value2, ... }
router.put('/', (req, res) => {
  const prefs = req.body;

  if (!prefs || typeof prefs !== 'object') {
    return res.status(400).json({ error: 'Expected an object of key/value pairs' });
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO preferences (user_id, key, value) VALUES (?, ?, ?)
  `);

  const upsertMany = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) {
      upsert.run(req.user.id, key, JSON.stringify(value));
    }
  });

  upsertMany(Object.entries(prefs));

  res.json({ ok: true });
});

// ── PUT /api/preferences/:key ───────────────────────────────────────
// Set a single preference
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'Value required' });
  }

  db.prepare(`
    INSERT OR REPLACE INTO preferences (user_id, key, value) VALUES (?, ?, ?)
  `).run(req.user.id, key, JSON.stringify(value));

  res.json({ ok: true });
});

// ── DELETE /api/preferences/:key ────────────────────────────────────
router.delete('/:key', (req, res) => {
  const { key } = req.params;

  db.prepare('DELETE FROM preferences WHERE user_id = ? AND key = ?').run(req.user.id, key);

  res.json({ ok: true });
});

// ── DELETE /api/preferences ─────────────────────────────────────────
// Reset all preferences for the user
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM preferences WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
