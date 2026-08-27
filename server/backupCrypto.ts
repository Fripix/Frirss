import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

export const BACKUP_FORMAT = 'frirss-backup';
export const BACKUP_VERSION = 1;
export const MIN_PASSPHRASE_LENGTH = 12;

// N=32768, r=8 demande 128 × N × r = 32 Mio tout rond, soit exactement la
// limite `maxmem` par défaut de Node. On la relève explicitement plutôt que de
// dépendre du sens de l'inégalité dans une version donnée.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export type BackupErrorCode =
  | 'not_a_backup'
  | 'unsupported_version'
  | 'bad_passphrase'
  | 'weak_passphrase';

export class BackupError extends Error {
  constructor(public code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupEnvelope {
  format: string;
  version: number;
  createdAt: string;
  appVersion: string;
  kdf: { algo: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  payload: string;
}

function deriveKey(passphrase: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Buffer {
  return scryptSync(passphrase, salt, SCRYPT.keylen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT.maxmem,
  });
}

/**
 * Scelle une charge utile dans une enveloppe chiffree.
 *
 * L'en-tête reste en clair : il ne révèle rien d'utile, et il permet de
 * distinguer « ce n'est pas une sauvegarde FriRSS », « c'est une version que je
 * ne sais pas lire » et « la phrase de passe est fausse ». Sans lui, les trois
 * échecs rendent le même charabia.
 */
export function sealBackup(payload: unknown, passphrase: string, appVersion: string): BackupEnvelope {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupError('weak_passphrase', `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion,
    kdf: { algo: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    payload: ct.toString('base64'),
  };
}

/** Ouvre une enveloppe produite par sealBackup(). Leve un BackupError type. */
export function openBackup(envelope: unknown, passphrase: string): unknown {
  const e = envelope as Partial<BackupEnvelope> | null;
  if (!e || typeof e !== 'object' || e.format !== BACKUP_FORMAT) {
    throw new BackupError('not_a_backup', 'Not a FriRSS backup file');
  }
  if (typeof e.version !== 'number' || e.version > BACKUP_VERSION) {
    throw new BackupError('unsupported_version', 'Backup was produced by a newer FriRSS');
  }
  if (!e.kdf || e.kdf.algo !== 'scrypt' || typeof e.kdf.salt !== 'string'
      || e.cipher !== 'aes-256-gcm'
      || typeof e.iv !== 'string' || typeof e.tag !== 'string' || typeof e.payload !== 'string') {
    throw new BackupError('not_a_backup', 'Malformed backup envelope');
  }
  try {
    const key = deriveKey(passphrase, Buffer.from(e.kdf.salt, 'base64'), e.kdf);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(e.payload, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    // GCM ne distingue pas « mauvaise clé » de « octets modifiés » : dans les
    // deux cas le contenu n'est pas digne de confiance, et le dire autrement
    // renseignerait un attaquant.
    throw new BackupError('bad_passphrase', 'Wrong passphrase or corrupted file');
  }
}
