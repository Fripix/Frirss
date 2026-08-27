import { describe, it, expect } from 'vitest';
import {
  sealBackup,
  openBackup,
  BackupError,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MIN_PASSPHRASE_LENGTH,
} from './backupCrypto.js';

const PASS = 'une-phrase-assez-longue';
const payload = { users: [{ id: 1, username: 'alice' }], note: 'accentue e' };

/**
 * `expect(fn).toThrowError(expect.objectContaining({ code }))` ne compare que
 * le message sous vitest, pas les proprietes : l\'assertion passerait quel que
 * soit le code. On attrape donc l\'erreur et on lit son code.
 */
function codeThrownBy(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as BackupError).code;
  }
  throw new Error('aucune erreur levee, alors qu\'une etait attendue');
}

describe('sealBackup', () => {
  it('produit une enveloppe dont l\'en-tete est en clair', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(env.format).toBe(BACKUP_FORMAT);
    expect(env.version).toBe(BACKUP_VERSION);
    expect(env.appVersion).toBe('1.4.3');
    expect(env.cipher).toBe('aes-256-gcm');
    expect(env.kdf.algo).toBe('scrypt');
    expect(typeof env.createdAt).toBe('string');
  });

  it('ne laisse fuir aucune donnee en clair dans l\'enveloppe', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(JSON.stringify(env)).not.toContain('alice');
  });

  it('produit un sel et un IV differents a chaque appel', () => {
    const a = sealBackup(payload, PASS, '1.4.3');
    const b = sealBackup(payload, PASS, '1.4.3');
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  it('refuse une phrase de passe trop courte', () => {
    expect(codeThrownBy(() => sealBackup(payload, 'court', '1.4.3'))).toBe('weak_passphrase');
  });

  it('accepte une phrase de passe d\'exactement la longueur minimale', () => {
    const exact = 'a'.repeat(MIN_PASSPHRASE_LENGTH);
    expect(() => sealBackup(payload, exact, '1.4.3')).not.toThrow();
  });
});

describe('openBackup', () => {
  it('rend le contenu d\'origine, accents compris', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(openBackup(env, PASS)).toEqual(payload);
  });

  it('distingue une phrase de passe fausse', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(codeThrownBy(() => openBackup(env, 'une-autre-phrase-longue'))).toBe('bad_passphrase');
  });

  it('refuse une charge utile alteree d\'un seul octet', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    const raw = Buffer.from(env.payload, 'base64');
    raw[0] ^= 0xff;
    const tampered = { ...env, payload: raw.toString('base64') };
    expect(codeThrownBy(() => openBackup(tampered, PASS))).toBe('bad_passphrase');
  });

  it('distingue un fichier qui n\'est pas une sauvegarde FriRSS', () => {
    expect(codeThrownBy(() => openBackup({ hello: 'world' }, PASS))).toBe('not_a_backup');
  });

  it('distingue une version future, sans tenter de la lire', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    const future = { ...env, version: BACKUP_VERSION + 1 };
    expect(codeThrownBy(() => openBackup(future, PASS))).toBe('unsupported_version');
  });

  it('rejette une enveloppe qui n\'est pas un objet', () => {
    expect(codeThrownBy(() => openBackup('pas une enveloppe', PASS))).toBe('not_a_backup');
  });

  it('est bien une instance de BackupError', () => {
    let caught: unknown;
    try { openBackup({}, PASS); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(BackupError);
  });
});
