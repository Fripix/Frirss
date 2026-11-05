import { describe, it, expect } from 'vitest';
import { randomBytes, scryptSync, createCipheriv } from 'crypto';
import {
  sealBackup,
  openBackup,
  readBackup,
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

  // GCM vérifie seulement le préfixe d'une étiquette tronquée : 4 octets
  // suffisaient à ouvrir le fichier, et l'authentification de l'en-tête v2
  // ne valait plus que 32 bits.
  it('refuse une étiquette d\'authentification tronquée', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    for (const n of [4, 12]) {
      const short = { ...env, tag: Buffer.from(env.tag, 'base64').subarray(0, n).toString('base64') };
      expect(codeThrownBy(() => openBackup(short, PASS))).toBe('not_a_backup');
    }
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

  describe('bornes des paramètres scrypt', () => {
    /**
     * `p` élevé déplace le TRAVAIL (N × p × r) sans toucher à la MÉMOIRE
     * (128 × r × N) : c'est le vecteur du déni de service que ces bornes
     * empêchent. `maxmem` ne l'aurait pas arrêté. L'assertion de temps est ce
     * qui distingue « refusé avant tout calcul » de « calculé puis refusé » —
     * sans elle, un refus tardif après un scrypt de plusieurs secondes
     * passerait ce test tout en laissant le déni de service intact.
     */
    it('refuse un p élevé sans délai mesurable, avant tout calcul scrypt', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      const forged = { ...env, kdf: { ...env.kdf, N: 2048, r: 8, p: 2048 } };
      const start = performance.now();
      expect(codeThrownBy(() => openBackup(forged, PASS))).toBe('not_a_backup');
      expect(performance.now() - start).toBeLessThan(100);
    });

    it('refuse un N qui n\'est pas une puissance de deux', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      const forged = { ...env, kdf: { ...env.kdf, N: 32000, r: 8, p: 1 } };
      expect(codeThrownBy(() => openBackup(forged, PASS))).toBe('not_a_backup');
    });

    it('refuse un N hors bornes (trop petit et trop grand)', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      const tropPetit = { ...env, kdf: { ...env.kdf, N: 2 ** 11, r: 8, p: 1 } };
      const tropGrand = { ...env, kdf: { ...env.kdf, N: 2 ** 18, r: 8, p: 1 } };
      expect(codeThrownBy(() => openBackup(tropPetit, PASS))).toBe('not_a_backup');
      expect(codeThrownBy(() => openBackup(tropGrand, PASS))).toBe('not_a_backup');
    });

    it('refuse un r hors bornes', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      const nul = { ...env, kdf: { ...env.kdf, N: 32768, r: 0, p: 1 } };
      const trop = { ...env, kdf: { ...env.kdf, N: 32768, r: 17, p: 1 } };
      expect(codeThrownBy(() => openBackup(nul, PASS))).toBe('not_a_backup');
      expect(codeThrownBy(() => openBackup(trop, PASS))).toBe('not_a_backup');
    });

    it('refuse un p hors bornes', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      const nul = { ...env, kdf: { ...env.kdf, N: 32768, r: 8, p: 0 } };
      const trop = { ...env, kdf: { ...env.kdf, N: 32768, r: 8, p: 5 } };
      expect(codeThrownBy(() => openBackup(nul, PASS))).toBe('not_a_backup');
      expect(codeThrownBy(() => openBackup(trop, PASS))).toBe('not_a_backup');
    });

    it('continue d\'ouvrir une enveloppe légitime, aux bornes ou non', () => {
      const env = sealBackup(payload, PASS, '1.4.3');
      expect(openBackup(env, PASS)).toEqual(payload);
    });
  });
});

/**
 * Une enveloppe de version 1, telle que FriRSS l'écrivait jusqu'en 1.8 :
 * en-tête hors du chiffrement authentifié. Paramètres scrypt au minimum admis,
 * pour que le test reste rapide.
 */
function legacyEnvelope(body: unknown, createdAt: string, appVersion: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kdf = { N: 4096, r: 8, p: 1 };
  const key = scryptSync(PASS, salt, 32, { ...kdf, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()]);
  return {
    format: BACKUP_FORMAT, version: 1, createdAt, appVersion,
    kdf: { algo: 'scrypt', ...kdf, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm', iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), payload: ct.toString('base64'),
  };
}

describe('en-tête authentifié (date, version de FriRSS)', () => {
  it('une date ou une version modifiée fait échouer l’ouverture', () => {
    const env = sealBackup(payload, PASS, '1.9.0');
    expect(codeThrownBy(() => openBackup({ ...env, appVersion: '9.9.9' }, PASS))).toBe('bad_passphrase');
    expect(codeThrownBy(() => openBackup({ ...env, createdAt: '2001-01-01T00:00:00.000Z' }, PASS))).toBe('bad_passphrase');
  });

  it('rend la date et la version lues avec la charge', () => {
    const env = sealBackup(payload, PASS, '1.9.0');
    const read = readBackup(env, PASS);
    expect(read.payload).toEqual(payload);
    expect(read.appVersion).toBe('1.9.0');
    expect(read.createdAt).toBe(env.createdAt);
  });

  it('une sauvegarde de version 1 reste lisible', () => {
    const old = legacyEnvelope(payload, '2026-10-01T08:00:00.000Z', '1.8.0');
    const read = readBackup(old, PASS);
    expect(read.payload).toEqual(payload);
    expect(read.appVersion).toBe('1.8.0');
    expect(read.createdAt).toBe('2026-10-01T08:00:00.000Z');
  });

  it('version 1 : un en-tête illisible n’est pas affiché tel quel', () => {
    const old = legacyEnvelope(payload, '<img src=x>', 'n’importe quoi de très long'.repeat(10));
    const read = readBackup(old, PASS);
    expect(read.createdAt).toBeNull();
    expect(read.appVersion).toBeNull();
  });
});
