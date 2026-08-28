import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ── Bornes d'écriture ────────────────────────────────────────────────
// Rien ne bornait ces écritures : ni la longueur des clés, ni la taille des
// valeurs, ni leur nombre, ni le total par utilisateur. Un compte authentifié
// pouvait donc remplir le volume SQLite, 5 Mo par requête (la limite du
// parseur JSON), autant de fois qu'il le voulait.
//
// Les plafonds sont calibrés très au-dessus du client réel, qui pousse en une
// fois les ~31 clés de `UI_SYNC_KEYS` + `THEME_SYNC_KEYS` (src/lib/prefsSync.ts).
// La plus grosse valeur de loin est `appLogo`, un PNG en data URL redimensionné
// à 256×256 côté client (`AppearanceTab.tsx`) — quelques centaines de Kio au
// pire. 1 Mio par valeur laisse une marge confortable sans laisser passer un
// dépôt de fichier déguisé.
export const MAX_KEY_LENGTH = 128;
export const MAX_VALUE_BYTES = 1024 * 1024;
export const MAX_KEYS_PER_REQUEST = 200;
export const MAX_KEYS_PER_USER = 500;

interface Rejection { code: string; error: string }

/**
 * Valide une entrée et rend sa forme sérialisée, ou le motif du refus.
 *
 * Le motif porte un `code` : le client doit pouvoir distinguer « clé trop
 * longue » de « valeur trop grosse » sans lire une phrase en anglais, et un
 * message qui devine sa cause est pire que pas de message du tout.
 */
function serializeEntry(key: string, value: unknown): { serialized: string } | Rejection {
  if (key.length > MAX_KEY_LENGTH) {
    return { code: 'key_too_long', error: `Preference key exceeds ${MAX_KEY_LENGTH} characters` };
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return { code: 'unserializable_value', error: 'Preference value cannot be serialized' };
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
    return { code: 'value_too_large', error: `Preference value exceeds ${MAX_VALUE_BYTES} bytes` };
  }
  return { serialized };
}

const isRejection = (r: { serialized: string } | Rejection): r is Rejection => 'code' in r;

/** Nombre de clés déjà stockées pour cet utilisateur. */
function storedKeyCount(userId: number): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM preferences WHERE user_id = ?')
    .get(userId) as { c: number }).c;
}

/** Clés déjà présentes parmi celles proposées — elles ne font pas grossir la table. */
function existingKeys(userId: number, keys: string[]): Set<string> {
  if (!keys.length) return new Set();
  const rows = db.prepare(
    `SELECT key FROM preferences WHERE user_id = ? AND key IN (${keys.map(() => '?').join(', ')})`
  ).all(userId, ...keys) as { key: string }[];
  return new Set(rows.map((r) => r.key));
}

const reject = (res: Response, r: Rejection) => res.status(400).json({ error: r.error, code: r.code });

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

  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return res.status(400).json({ error: 'Expected an object of key/value pairs', code: 'bad_payload' });
  }

  const entries = Object.entries(prefs);
  if (entries.length > MAX_KEYS_PER_REQUEST) {
    return reject(res, { code: 'too_many_keys', error: `At most ${MAX_KEYS_PER_REQUEST} keys per request` });
  }

  // Tout est validé AVANT la moindre écriture : un lot refusé ne doit pas
  // laisser derrière lui les clés qui précédaient la fautive.
  const validated: [string, string][] = [];
  for (const [key, value] of entries) {
    const out = serializeEntry(key, value);
    if (isRejection(out)) return reject(res, out);
    validated.push([key, out.serialized]);
  }

  const known = existingKeys(req.user.id, validated.map(([k]) => k));
  const added = validated.filter(([k]) => !known.has(k)).length;
  if (storedKeyCount(req.user.id) + added > MAX_KEYS_PER_USER) {
    return reject(res, { code: 'too_many_preferences', error: `At most ${MAX_KEYS_PER_USER} stored preferences per user` });
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO preferences (user_id, key, value) VALUES (?, ?, ?)
  `);

  const upsertMany = db.transaction((rows: [string, string][]) => {
    for (const [key, serialized] of rows) {
      upsert.run(req.user.id, key, serialized);
    }
  });

  upsertMany(validated);

  res.json({ ok: true });
});

// ── PUT /api/preferences/:key ───────────────────────────────────────
// Set a single preference
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'Value required', code: 'value_required' });
  }

  const out = serializeEntry(key, value);
  if (isRejection(out)) return reject(res, out);

  const isNew = existingKeys(req.user.id, [key]).size === 0;
  if (isNew && storedKeyCount(req.user.id) + 1 > MAX_KEYS_PER_USER) {
    return reject(res, { code: 'too_many_preferences', error: `At most ${MAX_KEYS_PER_USER} stored preferences per user` });
  }

  db.prepare(`
    INSERT OR REPLACE INTO preferences (user_id, key, value) VALUES (?, ?, ?)
  `).run(req.user.id, key, out.serialized);

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
