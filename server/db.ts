import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.FRIRSS_DATA_DIR || path.join(__dirname, '..', 'data');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'frirss.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    email         TEXT,
    password_hash TEXT,
    display_name  TEXT,
    role          TEXT    DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    active        INTEGER DEFAULT 1,
    auth_provider TEXT    DEFAULT 'local' CHECK(auth_provider IN ('local', 'oidc')),
    oidc_sub      TEXT,
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS servers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    name           TEXT,
    url            TEXT    NOT NULL,
    freshrss_user  TEXT    NOT NULL,
    freshrss_token TEXT,
    is_default     INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS preferences (
    user_id INTEGER NOT NULL,
    key     TEXT    NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Migrations (additive, idempotent) ───────────────────────────────
// CREATE TABLE IF NOT EXISTS never alters an existing table, so add any
// newer columns by hand when they're missing on an older database.
function columnExists(table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => (c as { name: string }).name === column);
}
if (!columnExists('users', 'email')) {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
}
// Tracks recent activity → drives the optional background sync worker
// (only users active within CACHE_SYNC_ACTIVE_DAYS are pre-cached).
if (!columnExists('users', 'last_active_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN last_active_at TEXT`);
}

// ── Default global settings ─────────────────────────────────────────
const initSetting = db.prepare(`
  INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
`);

initSetting.run('registration_enabled', 'true');

// Generate a JWT secret if none exists
const existing = db.prepare(`SELECT value FROM settings WHERE key = 'jwt_secret'`).get();
if (!existing) {
  const secret = randomBytes(64).toString('hex');
  initSetting.run('jwt_secret', secret);
}

// Generate a 32-byte AES key (hex) for encrypting FreshRSS tokens at rest
const encKey = db.prepare(`SELECT value FROM settings WHERE key = 'encryption_key'`).get();
if (!encKey) {
  initSetting.run('encryption_key', randomBytes(32).toString('hex'));
}

// ── Expired-session cleanup ─────────────────────────────────────────
// Purge stale sessions on startup, then hourly, so the table doesn't grow
// unbounded with rows that are already past their expiry.
function purgeExpiredSessions(): number {
  return db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run().changes;
}

purgeExpiredSessions();
const sessionCleanupTimer = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
// Don't keep the event loop alive just for the cleanup timer
sessionCleanupTimer.unref?.();

// ── Helpers ─────────────────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getJwtSecret(): string {
  // Always present after init (generated above on first start).
  return getSetting('jwt_secret') ?? '';
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
}

export default db;
