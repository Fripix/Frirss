import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import db, { getSetting } from './db.js';

// AES-256-GCM encryption for secrets at rest (FreshRSS tokens).
// Key comes from the persisted `encryption_key` setting (32 bytes, hex).
const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    const hex = getSetting('encryption_key');
    if (!hex) throw new Error('encryption_key missing');
    cachedKey = Buffer.from(hex, 'hex');
  }
  return cachedKey;
}

/**
 * Oublie la clé mise en cache, pour que le prochain appel la relise en base.
 *
 * Indispensable après une restauration : sans cela, le processus continuerait
 * d'utiliser l'ancienne clé et TOUS les déchiffrements échoueraient en
 * silence — `decrypt()` attrape l'erreur et renvoie `null`, ce qui se lit
 * « pas de jeton » plutôt que « clé fausse ».
 */
export function resetKeyCache(): void {
  cachedKey = null;
}

/** Encrypt a UTF-8 string → "enc:v1:<iv>:<tag>:<ciphertext>" (all base64). */
export function encrypt(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext == null || plaintext === '') return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a value produced by encrypt(). Plaintext / null pass through unchanged. */
export function decrypt(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) return value ?? null;
  try {
    const [ivb, tagb, ctb] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivb, 'base64'));
    decipher.setAuthTag(Buffer.from(tagb, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctb, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // tampered/corrupt → treat as no token
  }
}

/** One-time migration: encrypt any FreshRSS tokens still stored in plaintext. */
export function migrateEncryptTokens(): number {
  const rows = db.prepare(
    `SELECT id, freshrss_token FROM servers WHERE freshrss_token IS NOT NULL AND freshrss_token != ''`
  ).all() as { id: number; freshrss_token: string }[];
  let migrated = 0;
  const upd = db.prepare('UPDATE servers SET freshrss_token = ? WHERE id = ?');
  for (const r of rows) {
    if (!r.freshrss_token.startsWith(PREFIX)) {
      upd.run(encrypt(r.freshrss_token), r.id);
      migrated++;
    }
  }
  return migrated;
}
