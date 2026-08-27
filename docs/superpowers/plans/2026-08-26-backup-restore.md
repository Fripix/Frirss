# Sauvegarde et restauration chiffrées — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Permettre de télécharger une sauvegarde chiffrée complète de FriRSS et de la restaurer, depuis Administration ou au premier démarrage d'une instance vierge.

**Architecture :** Trois couches nettement séparées côté serveur — `backupCrypto.ts` (enveloppe, sans base, testable à fond), `backup.ts` (collecte et application, transaction unique), `routes/backup.ts` (deux montages, une seule implémentation). Côté client, un composant de restauration partagé entre Administration et l'écran de première connexion, pour que la logique n'existe qu'une fois.

**Tech Stack :** TypeScript strict, Express, better-sqlite3, `node:crypto` (scrypt + AES-256-GCM), React 18, vitest, i18next v26 (9 locales).

**Spec :** `docs/superpowers/specs/2026-08-26-backup-restore-design.md`

## Global Constraints

- **Dossier suivi par git** : `src/components/Preferences/` avec une **majuscule**. macOS masque une erreur de casse que le CI Linux ne pardonne pas.
- **Gates avant chaque commit** : `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **Garde-fou fuite d'infra avant chaque commit**, docs comprises :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` — sortie vide = propre.
- **Valeurs fictives dans les tests** : `example.com`, `10.0.0.1`. Jamais de domaine, IP interne, port ou chemin de volume réels — **y compris dans les instantanés d'environnement des tests**.
- **Messages de commit** : neutres, conventionnels, en anglais. **Jamais** de trailer `Co-Authored-By` ni aucune mention d'IA ou d'assistant.
- **i18n** : toute chaîne d'interface existe dans les **9** locales `src/locales/*.json` (fr, en, de, es, it, nl, pl, pt, uk), repli `fr`. Édition par script Node, round-trip `JSON.stringify(obj, null, 2) + "\n"`.
- **Aucune dépendance nouvelle** : `node:crypto` fournit scrypt et AES-256-GCM.
- **Trois facteurs de forme** : desktop, tablette, smartphone. Cibles tactiles de 44 pt, rien qui dépende du survol.
- **Garde-fous gelés** : `settingsCoverage.test.ts` (232 clés) et `featuresDoc.test.ts` restent verts. Un garde-fou rouge est une question, jamais un relevé à réajuster.
- **Longueur minimale de la phrase de passe : 12 caractères.**
- **Version du format de sauvegarde : 1.** Refuser net toute version supérieure.

---

### Task 1: L'enveloppe chiffrée

**Files:**
- Create: `server/backupCrypto.ts`
- Test: `server/backupCrypto.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `BACKUP_FORMAT`, `BACKUP_VERSION`, `MIN_PASSPHRASE_LENGTH`, `BackupError` (avec `.code`), `BackupEnvelope`, `sealBackup(payload: unknown, passphrase: string, appVersion: string): BackupEnvelope`, `openBackup(envelope: unknown, passphrase: string): unknown`.

**Piège d'implémentation à connaître avant d'écrire** : `crypto.scryptSync` refuse par défaut au-delà de **32 Mio** de mémoire, et `128 × N × r` vaut exactement 33 554 432 octets avec `N=32768, r=8`. On frôle la limite. Passer `maxmem` explicitement (64 Mio) évite un échec dépendant de la version de Node.

- [ ] **Step 1: Write the failing test**

Créer `server/backupCrypto.test.ts` :

```ts
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
const payload = { users: [{ id: 1, username: 'alice' }], note: 'accentué é' };

/**
 * `expect(fn).toThrowError(expect.objectContaining({ code }))` ne compare que
 * le message sous vitest, pas les propriétés : l'assertion passerait quel que
 * soit le code. On attrape donc l'erreur et on lit son code.
 */
function codeThrownBy(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as BackupError).code;
  }
  throw new Error('aucune erreur levée, alors qu’une était attendue');
}

describe('sealBackup', () => {
  it('produit une enveloppe dont l’en-tête est en clair', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(env.format).toBe(BACKUP_FORMAT);
    expect(env.version).toBe(BACKUP_VERSION);
    expect(env.appVersion).toBe('1.4.3');
    expect(env.cipher).toBe('aes-256-gcm');
    expect(env.kdf.algo).toBe('scrypt');
    expect(typeof env.createdAt).toBe('string');
  });

  it('ne laisse fuir aucune donnée en clair dans l’enveloppe', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(JSON.stringify(env)).not.toContain('alice');
  });

  it('produit un sel et un IV différents à chaque appel', () => {
    const a = sealBackup(payload, PASS, '1.4.3');
    const b = sealBackup(payload, PASS, '1.4.3');
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  it('refuse une phrase de passe trop courte', () => {
    expect(codeThrownBy(() => sealBackup(payload, 'court', '1.4.3'))).toBe('weak_passphrase');
  });

  it('accepte une phrase de passe d’exactement la longueur minimale', () => {
    const exact = 'a'.repeat(MIN_PASSPHRASE_LENGTH);
    expect(() => sealBackup(payload, exact, '1.4.3')).not.toThrow();
  });
});

describe('openBackup', () => {
  it('rend le contenu d’origine, accents compris', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(openBackup(env, PASS)).toEqual(payload);
  });

  it('distingue une phrase de passe fausse', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    expect(codeThrownBy(() => openBackup(env, 'une-autre-phrase-longue'))).toBe('bad_passphrase');
  });

  it('refuse une charge utile altérée d’un seul octet', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    const raw = Buffer.from(env.payload, 'base64');
    raw[0] ^= 0xff;
    const tampered = { ...env, payload: raw.toString('base64') };
    expect(codeThrownBy(() => openBackup(tampered, PASS))).toBe('bad_passphrase');
  });

  it('distingue un fichier qui n’est pas une sauvegarde FriRSS', () => {
    expect(codeThrownBy(() => openBackup({ hello: 'world' }, PASS))).toBe('not_a_backup');
  });

  it('distingue une version future, sans tenter de la lire', () => {
    const env = sealBackup(payload, PASS, '1.4.3');
    const future = { ...env, version: BACKUP_VERSION + 1 };
    expect(codeThrownBy(() => openBackup(future, PASS))).toBe('unsupported_version');
  });

  it('rejette une enveloppe qui n’est pas un objet', () => {
    expect(codeThrownBy(() => openBackup('pas une enveloppe', PASS))).toBe('not_a_backup');
  });

  it('est bien une instance de BackupError', () => {
    let caught: unknown;
    try { openBackup({}, PASS); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(BackupError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/backupCrypto.test.ts`
Expected: FAIL — `Failed to resolve import "./backupCrypto.js"`.

- [ ] **Step 3: Write minimal implementation**

Créer `server/backupCrypto.ts` :

```ts
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
 * Scelle une charge utile dans une enveloppe chiffrée.
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

/** Ouvre une enveloppe produite par sealBackup(). Lève un BackupError typé. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/backupCrypto.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add server/backupCrypto.ts server/backupCrypto.test.ts
git commit -m "feat(backup): seal and open encrypted backup envelopes"
```

---

### Task 2: Collecter la sauvegarde depuis la base

**Files:**
- Create: `server/backup.ts`
- Test: `server/backup.test.ts`

**Interfaces:**
- Consumes: `db`, `getSetting` depuis `./db.js`.
- Produces: `BACKUP_ENV_KEYS`, `BackupPayload` (`{ users: Row[]; servers: Row[]; preferences: Row[]; settings: Row[]; environment: Record<string, string> }` où `Row = Record<string, unknown>`), `collectBackup(): BackupPayload`, `summarizeBackup(payload: unknown): { users: number; servers: number; environment: Record<string, string> }`.

**Note sur les tests serveur** : `server/test/setup.ts` redirige déjà `FRIRSS_DATA_DIR` vers un dossier temporaire avant tout import de `server/db.js`. Les tests peuvent donc importer le singleton `db` sans toucher à la base réelle. `vitest.config.js` fixe `fileParallelism: false` — les tests serveur partagent cette base et s'exécutent en série.

- [ ] **Step 1: Write the failing test**

Créer `server/backup.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import db from './db.js';
import { collectBackup, summarizeBackup, BACKUP_ENV_KEYS } from './backup.js';

function wipe() {
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM preferences').run();
  db.prepare('DELETE FROM servers').run();
  db.prepare('DELETE FROM users').run();
}

function seed() {
  wipe();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`
  ).run(1, 'alice', 'alice@example.com', 'hash-alice', 'admin');
  db.prepare(
    `INSERT INTO servers (id, user_id, name, url, freshrss_user, freshrss_token, refresh_token, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(7, 1, 'Serveur', 'https://rss.example.com', 'alice', 'enc:v1:aaa', 'enc:v1:bbb', 1);
  db.prepare('INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)').run('1', 'theme', 'dark');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run('jeton-de-session', 1, '2099-01-01T00:00:00.000Z');
}

describe('collectBackup', () => {
  beforeEach(seed);

  it('emporte les comptes avec leur hachage de mot de passe', () => {
    const p = collectBackup();
    expect(p.users).toHaveLength(1);
    expect(p.users[0]).toMatchObject({ username: 'alice', password_hash: 'hash-alice' });
  });

  it('emporte les serveurs avec leurs deux jetons', () => {
    const p = collectBackup();
    expect(p.servers[0]).toMatchObject({
      url: 'https://rss.example.com',
      freshrss_token: 'enc:v1:aaa',
      refresh_token: 'enc:v1:bbb',
    });
  });

  it('emporte la clé de chiffrement, sans laquelle les jetons seraient morts', () => {
    const keys = (p: ReturnType<typeof collectBackup>) => p.settings.map((s) => s.key);
    expect(keys(collectBackup())).toContain('encryption_key');
  });

  it('emporte les préférences en conservant le type de user_id', () => {
    const p = collectBackup();
    expect(p.preferences[0]).toMatchObject({ user_id: '1', key: 'theme', value: 'dark' });
  });

  it('n’emporte PAS les sessions', () => {
    const p = collectBackup() as Record<string, unknown>;
    expect(p.sessions).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('jeton-de-session');
  });
});

describe('instantané d’environnement', () => {
  beforeEach(seed);

  it('ne retient que les variables de la liste blanche', () => {
    process.env.REDIS_URL = 'redis://10.0.0.1:6379';
    process.env.UN_SECRET_D_UN_AUTRE_SERVICE = 'ne-doit-pas-sortir';
    process.env.FRIRSS_INVENTEE = 'ne-doit-pas-sortir-non-plus';
    try {
      const env = collectBackup().environment;
      expect(env.REDIS_URL).toBe('redis://10.0.0.1:6379');
      expect(env.UN_SECRET_D_UN_AUTRE_SERVICE).toBeUndefined();
      expect(env.FRIRSS_INVENTEE).toBeUndefined();
      for (const k of Object.keys(env)) expect(BACKUP_ENV_KEYS).toContain(k);
    } finally {
      delete process.env.REDIS_URL;
      delete process.env.UN_SECRET_D_UN_AUTRE_SERVICE;
      delete process.env.FRIRSS_INVENTEE;
    }
  });

  it('omet les variables non définies plutôt que de les rendre vides', () => {
    delete process.env.CORS_ORIGIN;
    expect(collectBackup().environment).not.toHaveProperty('CORS_ORIGIN');
  });
});

describe('summarizeBackup', () => {
  beforeEach(seed);

  it('compte les comptes et les serveurs', () => {
    const s = summarizeBackup(collectBackup());
    expect(s).toMatchObject({ users: 1, servers: 1 });
  });

  it('rend l’instantané d’environnement pour l’aperçu', () => {
    process.env.CACHE_TTL = '86400';
    try {
      expect(summarizeBackup(collectBackup()).environment.CACHE_TTL).toBe('86400');
    } finally {
      delete process.env.CACHE_TTL;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/backup.test.ts`
Expected: FAIL — `Failed to resolve import "./backup.js"`.

- [ ] **Step 3: Write minimal implementation**

Créer `server/backup.ts` :

```ts
import db from './db.js';

type Row = Record<string, unknown>;

export interface BackupPayload {
  users: Row[];
  servers: Row[];
  preferences: Row[];
  settings: Row[];
  environment: Record<string, string>;
}

/**
 * Variables d'environnement emportées dans la sauvegarde, en LISTE BLANCHE.
 *
 * Jamais `process.env` en bloc : le conteneur peut porter des variables sans
 * rapport avec FriRSS, et les aspirer dans un fichier de sauvegarde serait un
 * vol de secrets par accident. Une variable absente de cette liste n'entre pas
 * dans le fichier, même si son nom commence par `FRIRSS_`.
 *
 * Elles sont enregistrées pour MÉMOIRE : la restauration les affiche, elle ne
 * les applique pas — ce sont des variables lues au démarrage du processus.
 */
export const BACKUP_ENV_KEYS = [
  'FRIRSS_BASE_URL',
  'FRIRSS_DATA_DIR',
  'FRIRSS_REFRESH_MAX_FEEDS',
  'PORT',
  'CORS_ORIGIN',
  'PROXY_REWRITES',
  'PROXY_INTERNAL_HOSTS',
  'REDIS_URL',
  'CACHE_ARTICLES_PER_FEED',
  'CACHE_TTL',
  'CACHE_SYNC_INTERVAL',
  'CACHE_SYNC_ACTIVE_DAYS',
  'CACHE_SYNC_PARALLEL_USERS',
] as const;

function collectEnvironment(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BACKUP_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Tout ce que FriRSS sait de lui-même. `sessions` est la seule table écartée :
 * des jetons porteurs qui expirent, dont le pendant navigateur vit de toute
 * façon dans le localStorage de l'ancienne origine.
 */
export function collectBackup(): BackupPayload {
  return {
    users: db.prepare('SELECT * FROM users ORDER BY id').all() as Row[],
    servers: db.prepare('SELECT * FROM servers ORDER BY id').all() as Row[],
    preferences: db.prepare('SELECT * FROM preferences ORDER BY user_id, key').all() as Row[],
    settings: db.prepare('SELECT * FROM settings ORDER BY key').all() as Row[],
    environment: collectEnvironment(),
  };
}

/** Résumé montré avant tout remplacement. Ne touche pas à la base. */
export function summarizeBackup(payload: unknown): {
  users: number;
  servers: number;
  environment: Record<string, string>;
} {
  const p = payload as Partial<BackupPayload> | null;
  return {
    users: Array.isArray(p?.users) ? p.users.length : 0,
    servers: Array.isArray(p?.servers) ? p.servers.length : 0,
    environment: (p?.environment && typeof p.environment === 'object' ? p.environment : {}) as Record<string, string>,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/backup.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add server/backup.ts server/backup.test.ts
git commit -m "feat(backup): collect the full instance state"
```

---

### Task 3: Appliquer une sauvegarde, en une transaction

**Files:**
- Modify: `server/crypto.ts` (exporter `resetKeyCache`)
- Modify: `server/backup.ts` (ajouter `applyBackup`)
- Modify: `server/backup.test.ts` (ajouter les cas d'application)

**Interfaces:**
- Consumes: `collectBackup()`, `BackupPayload` de la tâche 2.
- Produces: `applyBackup(payload: unknown): void`, et `resetKeyCache(): void` exporté depuis `server/crypto.ts`.

**Le piège central de tout ce chantier** : `server/crypto.ts` garde la clé de chiffrement dans `cachedKey` pour la durée du processus. Restaurer une `encryption_key` différente sans vider ce cache fait échouer **tous** les déchiffrements en silence — `decrypt()` attrape l'erreur et renvoie `null`, ce qui se lit « pas de jeton ». Le test de l'étape 1 le prouve.

- [ ] **Step 1: Write the failing test**

Ajouter à la fin de `server/backup.test.ts` :

```ts
import { applyBackup } from './backup.js';
import { encrypt, decrypt } from './crypto.js';
import { randomBytes } from 'crypto';

describe('applyBackup', () => {
  beforeEach(seed);

  it('restaure un état identique dans une base vidée', () => {
    const before = collectBackup();
    wipe();
    expect(db.prepare('SELECT COUNT(*) c FROM users').get()).toMatchObject({ c: 0 });

    applyBackup(before);

    const after = collectBackup();
    expect(after.users).toEqual(before.users);
    expect(after.servers).toEqual(before.servers);
    expect(after.preferences).toEqual(before.preferences);
  });

  it('remplace l’existant au lieu de fusionner', () => {
    const backup = collectBackup();
    db.prepare(`INSERT INTO users (id, username, role) VALUES (?, ?, ?)`).run(99, 'intrus', 'user');

    applyBackup(backup);

    const names = db.prepare('SELECT username FROM users').all().map((r: Record<string, unknown>) => r.username);
    expect(names).toEqual(['alice']);
  });

  it('vide le cache de clé, sans quoi les jetons restaurés seraient illisibles', () => {
    // Force la mise en cache de la clé actuelle.
    encrypt('amorce');
    // Une sauvegarde portant une AUTRE clé, et un jeton chiffré sous celle-ci.
    const backup = collectBackup();
    const newKey = randomBytes(32).toString('hex');
    backup.settings = backup.settings.map((s) =>
      s.key === 'encryption_key' ? { ...s, value: newKey } : s,
    );

    applyBackup(backup);

    // Après restauration, chiffrer/déchiffrer doit fonctionner avec la NOUVELLE clé.
    const roundTrip = decrypt(encrypt('secret-apres-restauration'));
    expect(roundTrip).toBe('secret-apres-restauration');
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'encryption_key'`).get())
      .toMatchObject({ value: newKey });
  });

  it('n’écrit rien du tout si l’application échoue en cours de route', () => {
    const backup = collectBackup();
    // Un serveur rattaché à un utilisateur absent : la clé étrangère refuse.
    backup.servers = [...backup.servers, {
      id: 999, user_id: 4242, name: 'orphelin', url: 'https://autre.example.com',
      freshrss_user: 'bob', freshrss_token: null, refresh_token: null,
      is_default: 0, created_at: '2026-01-01 00:00:00',
    }];

    expect(() => applyBackup(backup)).toThrow();

    // L'instance est exactement dans son état d'avant.
    expect(db.prepare('SELECT COUNT(*) c FROM users').get()).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM servers').get()).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT username FROM users').all()).toEqual([{ username: 'alice' }]);
  });

  it('refuse une charge utile qui n’a pas la forme attendue', () => {
    expect(() => applyBackup({ users: 'pas un tableau' })).toThrow();
    expect(() => applyBackup(null)).toThrow();
  });

  it('purge les sessions existantes : elles ne survivent pas à un remplacement', () => {
    const backup = collectBackup();
    applyBackup(backup);
    expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toMatchObject({ c: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/backup.test.ts`
Expected: FAIL — `applyBackup is not exported` (et `resetKeyCache` absent de `crypto.ts`).

- [ ] **Step 3: Exposer la remise à zéro du cache de clé**

Dans `server/crypto.ts`, juste après la fonction `key()`, ajouter :

```ts
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
```

- [ ] **Step 4: Write minimal implementation**

Ajouter à la fin de `server/backup.ts` :

```ts
import { resetKeyCache } from './crypto.js';

const TABLES = ['users', 'servers', 'preferences', 'settings'] as const;

function assertPayload(payload: unknown): asserts payload is BackupPayload {
  const p = payload as Partial<BackupPayload> | null;
  if (!p || typeof p !== 'object') throw new Error('Malformed backup payload');
  for (const t of TABLES) {
    if (!Array.isArray(p[t])) throw new Error(`Malformed backup payload: ${t}`);
  }
}

/** Insère un tableau de lignes en nommant les colonnes présentes dans chacune. */
function insertRows(table: string, rows: Row[]): void {
  for (const row of rows) {
    const cols = Object.keys(row);
    if (cols.length === 0) continue;
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    // Les valeurs sont liées telles quelles : `preferences.user_id` est du TEXT
    // là où `users.id` est un INTEGER, et convertir l'un en l'autre
    // orphelinerait toutes les préférences sans la moindre erreur.
    db.prepare(sql).run(...cols.map((c) => row[c] as never));
  }
}

/**
 * Remplace INTÉGRALEMENT le contenu de l'instance par celui de la sauvegarde.
 *
 * Tout se joue dans une seule transaction : si quoi que ce soit échoue, rien
 * n'a bougé et l'instance reste exactement dans son état d'avant.
 */
export function applyBackup(payload: unknown): void {
  assertPayload(payload);

  const run = db.transaction((p: BackupPayload) => {
    // Purge, enfants d'abord — les clés étrangères sont actives.
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM servers').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM settings').run();

    // Réinsertion, parents d'abord.
    insertRows('users', p.users);
    insertRows('servers', p.servers);
    insertRows('preferences', p.preferences);
    insertRows('settings', p.settings);
  });

  run(payload);

  // Après le commit seulement : la clé de chiffrement vient peut-être de
  // changer, et le processus garde l'ancienne en mémoire.
  resetKeyCache();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/backup.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 6: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add server/backup.ts server/backup.test.ts server/crypto.ts
git commit -m "feat(backup): replace the instance state in a single transaction"
```

---

### Task 4: Les routes, une implémentation montée deux fois

**Files:**
- Create: `server/routes/backup.ts`
- Create: `server/version.ts`
- Modify: `server/index.ts` (montage + version partagée)
- Test: `server/routes/backup.test.ts`

**Interfaces:**
- Consumes: `collectBackup`, `applyBackup`, `summarizeBackup` de `../backup.js` ; `sealBackup`, `openBackup`, `BackupError`, `MIN_PASSPHRASE_LENGTH` de `../backupCrypto.js` ; `requireAuth`, `requireAdmin` de `../middleware/auth.js` ; `userCount` de `../db.js`.
- Produces: `adminBackupRouter`, `setupBackupRouter`, et la fonction testable `requireEmptyInstance(req, res, next)`.

**Le garde non négociable** : les routes `/api/setup/*` ne peuvent pas exiger d'être administrateur, puisqu'aucun compte n'existe encore. Elles doivent donc refuser dès qu'**un seul** utilisateur existe. Sans ce garde, n'importe qui remplace l'instance par la sienne.

**Sur la journalisation, un fait déjà vérifié** : le journal d'accès de
`server/index.ts` n'enregistre que méthode, URL, statut et durée — **jamais le
corps** de la requête. La phrase de passe ne peut donc pas fuir par là. Ne pas
ajouter de journalisation de corps dans ces routes, et ne jamais faire figurer
la phrase de passe dans un message d'erreur. `express.json({ limit: '5mb' })`
plafonne la taille reçue, ce qui convient largement à une sauvegarde.

- [ ] **Step 1: Write the failing test**

Créer `server/routes/backup.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../db.js';
import { requireEmptyInstance } from './backup.js';

function fakeRes() {
  const res = { statusCode: 0, body: null as unknown };
  return {
    status(code: number) { res.statusCode = code; return this; },
    json(payload: unknown) { res.body = payload; return this; },
    _res: res,
  };
}

describe('requireEmptyInstance', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM servers').run();
    db.prepare('DELETE FROM users').run();
  });

  it('laisse passer quand aucun compte n’existe', () => {
    const next = vi.fn();
    const res = fakeRes();
    requireEmptyInstance({} as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._res.statusCode).toBe(0);
  });

  it('refuse dès qu’un seul compte existe', () => {
    db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('alice', 'admin');
    const next = vi.fn();
    const res = fakeRes();
    requireEmptyInstance({} as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/backup.test.ts`
Expected: FAIL — `Failed to resolve import "./backup.js"`.

- [ ] **Step 3: Write minimal implementation**

Créer `server/routes/backup.ts` :

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { userCount } from '../db.js';
import { APP_VERSION } from '../version.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { collectBackup, applyBackup, summarizeBackup } from '../backup.js';
import { sealBackup, openBackup, BackupError, MIN_PASSPHRASE_LENGTH } from '../backupCrypto.js';

// Le déchiffrement d'une enveloppe est un oracle : sans limite de cadence,
// il autorise un essai de phrase de passe par requête, indéfiniment.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, please try again later' },
});

/**
 * Garde des routes `/api/setup/*`. Elles ne peuvent pas exiger d'être
 * administrateur — aucun compte n'existe encore — donc elles doivent refuser
 * dès qu'un seul utilisateur existe. Sans ce garde, n'importe qui remplacerait
 * l'instance par la sienne.
 */
export function requireEmptyInstance(_req: Request, res: Response, next: NextFunction) {
  if (userCount() > 0) {
    return res.status(403).json({ error: 'Instance already configured' });
  }
  next();
}

/** Traduit un BackupError en réponse HTTP. Les autres erreurs restent des 500. */
function fail(res: Response, err: unknown) {
  if (err instanceof BackupError) {
    const status = err.code === 'weak_passphrase' ? 400 : err.code === 'bad_passphrase' ? 401 : 422;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: 'Backup operation failed' });
}

function handleBackup(req: Request, res: Response) {
  try {
    const { passphrase } = req.body ?? {};
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return res.status(400).json({ error: 'Passphrase too short', code: 'weak_passphrase' });
    }
    res.json({ backup: sealBackup(collectBackup(), passphrase, APP_VERSION) });
  } catch (err) {
    fail(res, err);
  }
}

function handlePreview(req: Request, res: Response) {
  try {
    const { backup, passphrase } = req.body ?? {};
    const payload = openBackup(backup, String(passphrase ?? ''));
    const summary = summarizeBackup(payload);
    res.json({
      summary,
      createdAt: (backup as { createdAt?: string })?.createdAt ?? null,
      appVersion: (backup as { appVersion?: string })?.appVersion ?? null,
    });
  } catch (err) {
    fail(res, err);
  }
}

function handleRestore(req: Request, res: Response) {
  try {
    const { backup, passphrase } = req.body ?? {};
    const payload = openBackup(backup, String(passphrase ?? ''));
    applyBackup(payload);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
}

// ── Deux montages, une seule implémentation ─────────────────────────
export const adminBackupRouter = Router();
adminBackupRouter.use(requireAuth, requireAdmin);
adminBackupRouter.post('/backup', backupLimiter, handleBackup);
adminBackupRouter.post('/restore/preview', backupLimiter, handlePreview);
adminBackupRouter.post('/restore', backupLimiter, handleRestore);

export const setupBackupRouter = Router();
setupBackupRouter.use(requireEmptyInstance);
setupBackupRouter.post('/restore/preview', backupLimiter, handlePreview);
setupBackupRouter.post('/restore', backupLimiter, handleRestore);
```

**D'abord**, créer `server/version.ts` — la version est aujourd'hui écrite en
dur à `server/index.ts:81` pour la route de santé, et la sauvegarde a besoin de
la même valeur. Deux littéraux dériveraient l'un de l'autre :

```ts
/** Version applicative, partagée par la route de santé et les sauvegardes. */
export const APP_VERSION = '1.4.3';
```

Puis, dans `server/index.ts`, remplacer `version: '1.4.3',` par
`version: APP_VERSION,` et ajouter l'import correspondant.

Ensuite, ajouter l'import des routes auprès des autres :

```ts
import { adminBackupRouter, setupBackupRouter } from './routes/backup.js';
```

et le montage, juste après `app.use('/api/admin', adminRoutes);` :

```ts
app.use('/api/admin', adminBackupRouter);
app.use('/api/setup', setupBackupRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/backup.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Vérifier que le serveur démarre toujours**

Run: `npm run build`
Expected: PASS, `server-dist/routes/backup.js` produit.

```bash
ls server-dist/routes/backup.js
```

- [ ] **Step 6: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add server/routes/backup.ts server/routes/backup.test.ts server/index.ts server/version.ts
git commit -m "feat(backup): expose backup and restore routes"
```

---

### Task 5: Les appels client

**Files:**
- Modify: `src/api/backend.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: les routes de la tâche 4.
- Produces: `BackupEnvelope` et `RestoreSummary` dans `src/types`, puis dans `src/api/backend.ts` :
  `createBackup(passphrase: string): Promise<BackupEnvelope>`,
  `previewRestore(backup: unknown, passphrase: string, setup: boolean): Promise<RestoreSummary>`,
  `applyRestore(backup: unknown, passphrase: string, setup: boolean): Promise<void>`.

- [ ] **Step 1: Déclarer les types**

Ajouter à la fin de `src/types/index.ts` :

```ts
export interface BackupEnvelope {
  format: string;
  version: number;
  createdAt: string;
  appVersion: string;
  kdf: { algo: string; N: number; r: number; p: number; salt: string };
  cipher: string;
  iv: string;
  tag: string;
  payload: string;
}

export interface RestoreSummary {
  summary: { users: number; servers: number; environment: Record<string, string> };
  createdAt: string | null;
  appVersion: string | null;
}
```

- [ ] **Step 2: Ajouter les appels**

Ajouter à la fin de `src/api/backend.ts` :

```ts
/**
 * Produit l'enveloppe chiffrée. En POST, et non en GET : la phrase de passe ne
 * doit apparaître ni dans une URL, ni dans un journal d'accès.
 */
export async function createBackup(passphrase: string): Promise<BackupEnvelope> {
  const { data } = await backend.post<{ backup: BackupEnvelope }>('/admin/backup', { passphrase });
  return data.backup;
}

/** `setup` : instance vierge (premier démarrage) plutôt qu'Administration. */
export async function previewRestore(
  backup: unknown,
  passphrase: string,
  setup: boolean,
): Promise<RestoreSummary> {
  const { data } = await backend.post<RestoreSummary>(
    `${setup ? '/setup' : '/admin'}/restore/preview`,
    { backup, passphrase },
  );
  return data;
}

export async function applyRestore(backup: unknown, passphrase: string, setup: boolean): Promise<void> {
  await backend.post(`${setup ? '/setup' : '/admin'}/restore`, { backup, passphrase });
}
```

Compléter l'import de types en tête du fichier avec `BackupEnvelope` et `RestoreSummary`.

- [ ] **Step 3: Vérifier la compilation**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/api/backend.ts src/types/index.ts
git commit -m "feat(backup): add the client calls for backup and restore"
```

---

### Task 6: Les chaînes, dans les 9 locales

**Files:**
- Modify: `src/locales/fr.json`, `en.json`, `de.json`, `es.json`, `it.json`, `nl.json`, `pl.json`, `pt.json`, `uk.json`

**Interfaces:**
- Consumes: rien.
- Produces: la famille `backup.*` — 24 clés, consommées par les tâches 7 et 8.

**Aucune clé au pluriel** : l'aperçu affiche « Comptes : 3 » plutôt que « 3 comptes ». i18next v26 exigerait sinon les formes `_few` et `_many` pour `pl` et `uk`, pour un gain nul.

- [ ] **Step 1: Écrire les clés par script**

```bash
node -e '
const fs = require("fs");
const T = {
  fr: { title: "Sauvegarde", description: "La sauvegarde contient tout ce qui permet de remonter cette instance à l’identique : comptes et mots de passe, serveurs configurés, jetons FreshRSS et la clé qui les déchiffre. Elle ne contient pas vos articles, qui vivent dans FreshRSS.", whyPassphrase: "C’est pourquoi le chiffrement est obligatoire : sans phrase de passe, ce fichier donnerait accès à tous les comptes.", passphraseLost: "Une phrase de passe perdue rend la sauvegarde définitivement inutilisable. Conservez-la ailleurs que dans le fichier.", passphrase: "Phrase de passe", passphraseConfirm: "Confirmer la phrase de passe", tooShort: "12 caractères minimum.", mismatch: "Les deux phrases de passe diffèrent.", download: "Télécharger la sauvegarde", preparing: "Préparation…", restoreTitle: "Restaurer une sauvegarde", chooseFile: "Choisir un fichier", fileChosen: "Fichier choisi :", check: "Vérifier la sauvegarde", previewTitle: "Contenu de la sauvegarde", createdAt: "Créée le", producedBy: "Produite par FriRSS", usersCount: "Comptes", serversCount: "Serveurs", environment: "Variables d’environnement de l’instance sauvegardée. Elles ne sont pas restaurées : reportez-les dans votre fichier compose.", copy: "Copier", copied: "Copié", replace: "Remplacer définitivement le contenu de cette instance", replaceHint: "Vos comptes, serveurs et préférences actuels seront écrasés. Vous serez déconnecté et devrez vous reconnecter avec les identifiants de la sauvegarde.", restoring: "Restauration…", restored: "Restauration terminée. Reconnectez-vous.", errNotBackup: "Ce fichier n’est pas une sauvegarde FriRSS.", errVersion: "Cette sauvegarde a été produite par une version plus récente de FriRSS.", errPassphrase: "Phrase de passe incorrecte, ou fichier abîmé.", errGeneric: "L’opération a échoué. Réessayez." },
  en: { title: "Backup", description: "The backup holds everything needed to rebuild this instance exactly: accounts and passwords, configured servers, FreshRSS tokens and the key that decrypts them. It does not hold your articles, which live in FreshRSS.", whyPassphrase: "That is why encryption is mandatory: without a passphrase, this file would grant access to every account.", passphraseLost: "A lost passphrase makes the backup permanently unusable. Keep it somewhere other than the file.", passphrase: "Passphrase", passphraseConfirm: "Confirm passphrase", tooShort: "12 characters minimum.", mismatch: "The two passphrases differ.", download: "Download the backup", preparing: "Preparing…", restoreTitle: "Restore a backup", chooseFile: "Choose a file", fileChosen: "Chosen file:", check: "Check the backup", previewTitle: "Backup contents", createdAt: "Created on", producedBy: "Produced by FriRSS", usersCount: "Accounts", serversCount: "Servers", environment: "Environment variables of the backed-up instance. They are not restored: copy them into your compose file.", copy: "Copy", copied: "Copied", replace: "Permanently replace this instance’s contents", replaceHint: "Your current accounts, servers and preferences will be overwritten. You will be signed out and must sign in with the credentials from the backup.", restoring: "Restoring…", restored: "Restore complete. Please sign in again.", errNotBackup: "This file is not a FriRSS backup.", errVersion: "This backup was produced by a newer version of FriRSS.", errPassphrase: "Wrong passphrase, or damaged file.", errGeneric: "The operation failed. Try again." },
  de: { title: "Sicherung", description: "Die Sicherung enthält alles, um diese Instanz identisch wiederherzustellen: Konten und Passwörter, eingerichtete Server, FreshRSS-Tokens und den Schlüssel, der sie entschlüsselt. Ihre Artikel sind nicht enthalten – die liegen in FreshRSS.", whyPassphrase: "Deshalb ist die Verschlüsselung verpflichtend: Ohne Passphrase würde diese Datei Zugriff auf alle Konten gewähren.", passphraseLost: "Eine verlorene Passphrase macht die Sicherung dauerhaft unbrauchbar. Bewahren Sie sie getrennt von der Datei auf.", passphrase: "Passphrase", passphraseConfirm: "Passphrase bestätigen", tooShort: "Mindestens 12 Zeichen.", mismatch: "Die beiden Passphrasen stimmen nicht überein.", download: "Sicherung herunterladen", preparing: "Wird vorbereitet…", restoreTitle: "Sicherung wiederherstellen", chooseFile: "Datei auswählen", fileChosen: "Gewählte Datei:", check: "Sicherung prüfen", previewTitle: "Inhalt der Sicherung", createdAt: "Erstellt am", producedBy: "Erstellt von FriRSS", usersCount: "Konten", serversCount: "Server", environment: "Umgebungsvariablen der gesicherten Instanz. Sie werden nicht wiederhergestellt: Übertragen Sie sie in Ihre Compose-Datei.", copy: "Kopieren", copied: "Kopiert", replace: "Inhalt dieser Instanz endgültig ersetzen", replaceHint: "Ihre aktuellen Konten, Server und Einstellungen werden überschrieben. Sie werden abgemeldet und müssen sich mit den Zugangsdaten aus der Sicherung anmelden.", restoring: "Wird wiederhergestellt…", restored: "Wiederherstellung abgeschlossen. Bitte erneut anmelden.", errNotBackup: "Diese Datei ist keine FriRSS-Sicherung.", errVersion: "Diese Sicherung stammt aus einer neueren FriRSS-Version.", errPassphrase: "Falsche Passphrase oder beschädigte Datei.", errGeneric: "Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen." },
  es: { title: "Copia de seguridad", description: "La copia contiene todo lo necesario para reconstruir esta instancia tal cual: cuentas y contraseñas, servidores configurados, tokens de FreshRSS y la clave que los descifra. No contiene tus artículos, que viven en FreshRSS.", whyPassphrase: "Por eso el cifrado es obligatorio: sin frase de contraseña, este archivo daría acceso a todas las cuentas.", passphraseLost: "Una frase de contraseña perdida deja la copia definitivamente inservible. Guárdala en un lugar distinto del archivo.", passphrase: "Frase de contraseña", passphraseConfirm: "Confirmar la frase de contraseña", tooShort: "12 caracteres como mínimo.", mismatch: "Las dos frases de contraseña no coinciden.", download: "Descargar la copia", preparing: "Preparando…", restoreTitle: "Restaurar una copia", chooseFile: "Elegir un archivo", fileChosen: "Archivo elegido:", check: "Comprobar la copia", previewTitle: "Contenido de la copia", createdAt: "Creada el", producedBy: "Producida por FriRSS", usersCount: "Cuentas", serversCount: "Servidores", environment: "Variables de entorno de la instancia guardada. No se restauran: cópialas en tu archivo compose.", copy: "Copiar", copied: "Copiado", replace: "Reemplazar definitivamente el contenido de esta instancia", replaceHint: "Tus cuentas, servidores y preferencias actuales se sobrescribirán. Se cerrará tu sesión y deberás entrar con las credenciales de la copia.", restoring: "Restaurando…", restored: "Restauración completada. Vuelve a iniciar sesión.", errNotBackup: "Este archivo no es una copia de FriRSS.", errVersion: "Esta copia se creó con una versión más reciente de FriRSS.", errPassphrase: "Frase de contraseña incorrecta, o archivo dañado.", errGeneric: "La operación ha fallado. Inténtalo de nuevo." },
  it: { title: "Backup", description: "Il backup contiene tutto il necessario per ricostruire questa istanza identica: account e password, server configurati, token FreshRSS e la chiave che li decifra. Non contiene i tuoi articoli, che vivono in FreshRSS.", whyPassphrase: "Per questo la cifratura è obbligatoria: senza passphrase, questo file darebbe accesso a tutti gli account.", passphraseLost: "Una passphrase persa rende il backup definitivamente inutilizzabile. Conservala altrove rispetto al file.", passphrase: "Passphrase", passphraseConfirm: "Conferma la passphrase", tooShort: "Almeno 12 caratteri.", mismatch: "Le due passphrase non coincidono.", download: "Scarica il backup", preparing: "Preparazione…", restoreTitle: "Ripristina un backup", chooseFile: "Scegli un file", fileChosen: "File scelto:", check: "Verifica il backup", previewTitle: "Contenuto del backup", createdAt: "Creato il", producedBy: "Prodotto da FriRSS", usersCount: "Account", serversCount: "Server", environment: "Variabili d’ambiente dell’istanza salvata. Non vengono ripristinate: riportale nel tuo file compose.", copy: "Copia", copied: "Copiato", replace: "Sostituisci definitivamente il contenuto di questa istanza", replaceHint: "Account, server e preferenze attuali saranno sovrascritti. Verrai disconnesso e dovrai accedere con le credenziali del backup.", restoring: "Ripristino…", restored: "Ripristino completato. Accedi di nuovo.", errNotBackup: "Questo file non è un backup FriRSS.", errVersion: "Questo backup è stato prodotto da una versione più recente di FriRSS.", errPassphrase: "Passphrase errata, o file danneggiato.", errGeneric: "Operazione non riuscita. Riprova." },
  nl: { title: "Back-up", description: "De back-up bevat alles om deze installatie identiek terug te zetten: accounts en wachtwoorden, ingestelde servers, FreshRSS-tokens en de sleutel die ze ontsleutelt. Uw artikelen zitten er niet in — die staan in FreshRSS.", whyPassphrase: "Daarom is versleuteling verplicht: zonder wachtwoordzin zou dit bestand toegang geven tot alle accounts.", passphraseLost: "Een verloren wachtwoordzin maakt de back-up definitief onbruikbaar. Bewaar hem los van het bestand.", passphrase: "Wachtwoordzin", passphraseConfirm: "Wachtwoordzin bevestigen", tooShort: "Minimaal 12 tekens.", mismatch: "De twee wachtwoordzinnen verschillen.", download: "Back-up downloaden", preparing: "Voorbereiden…", restoreTitle: "Een back-up terugzetten", chooseFile: "Bestand kiezen", fileChosen: "Gekozen bestand:", check: "Back-up controleren", previewTitle: "Inhoud van de back-up", createdAt: "Gemaakt op", producedBy: "Gemaakt door FriRSS", usersCount: "Accounts", serversCount: "Servers", environment: "Omgevingsvariabelen van de opgeslagen installatie. Ze worden niet teruggezet: neem ze over in uw compose-bestand.", copy: "Kopiëren", copied: "Gekopieerd", replace: "Inhoud van deze installatie definitief vervangen", replaceHint: "Uw huidige accounts, servers en voorkeuren worden overschreven. U wordt afgemeld en moet inloggen met de gegevens uit de back-up.", restoring: "Terugzetten…", restored: "Terugzetten voltooid. Log opnieuw in.", errNotBackup: "Dit bestand is geen FriRSS-back-up.", errVersion: "Deze back-up komt van een nieuwere versie van FriRSS.", errPassphrase: "Verkeerde wachtwoordzin, of beschadigd bestand.", errGeneric: "De bewerking is mislukt. Probeer het opnieuw." },
  pl: { title: "Kopia zapasowa", description: "Kopia zawiera wszystko, co pozwala odtworzyć tę instancję bez zmian: konta i hasła, skonfigurowane serwery, tokeny FreshRSS oraz klucz, który je odszyfrowuje. Nie zawiera artykułów — te są w FreshRSS.", whyPassphrase: "Dlatego szyfrowanie jest obowiązkowe: bez hasła ten plik dawałby dostęp do wszystkich kont.", passphraseLost: "Utracone hasło czyni kopię trwale bezużyteczną. Przechowuj je poza plikiem.", passphrase: "Hasło szyfrujące", passphraseConfirm: "Potwierdź hasło szyfrujące", tooShort: "Co najmniej 12 znaków.", mismatch: "Podane hasła różnią się.", download: "Pobierz kopię zapasową", preparing: "Przygotowywanie…", restoreTitle: "Przywróć kopię zapasową", chooseFile: "Wybierz plik", fileChosen: "Wybrany plik:", check: "Sprawdź kopię", previewTitle: "Zawartość kopii", createdAt: "Utworzono", producedBy: "Utworzona przez FriRSS", usersCount: "Konta", serversCount: "Serwery", environment: "Zmienne środowiskowe zapisanej instancji. Nie są przywracane: przenieś je do pliku compose.", copy: "Kopiuj", copied: "Skopiowano", replace: "Trwale zastąp zawartość tej instancji", replaceHint: "Bieżące konta, serwery i ustawienia zostaną nadpisane. Nastąpi wylogowanie i trzeba będzie zalogować się danymi z kopii.", restoring: "Przywracanie…", restored: "Przywracanie zakończone. Zaloguj się ponownie.", errNotBackup: "Ten plik nie jest kopią zapasową FriRSS.", errVersion: "Ta kopia pochodzi z nowszej wersji FriRSS.", errPassphrase: "Błędne hasło lub uszkodzony plik.", errGeneric: "Operacja nie powiodła się. Spróbuj ponownie." },
  pt: { title: "Cópia de segurança", description: "A cópia contém tudo o que permite repor esta instância tal como estava: contas e palavras-passe, servidores configurados, tokens do FreshRSS e a chave que os decifra. Não contém os seus artigos, que residem no FreshRSS.", whyPassphrase: "É por isso que a cifra é obrigatória: sem frase-passe, este ficheiro daria acesso a todas as contas.", passphraseLost: "Uma frase-passe perdida torna a cópia definitivamente inutilizável. Guarde-a fora do ficheiro.", passphrase: "Frase-passe", passphraseConfirm: "Confirmar a frase-passe", tooShort: "No mínimo 12 caracteres.", mismatch: "As duas frases-passe são diferentes.", download: "Transferir a cópia", preparing: "A preparar…", restoreTitle: "Repor uma cópia", chooseFile: "Escolher um ficheiro", fileChosen: "Ficheiro escolhido:", check: "Verificar a cópia", previewTitle: "Conteúdo da cópia", createdAt: "Criada a", producedBy: "Produzida pelo FriRSS", usersCount: "Contas", serversCount: "Servidores", environment: "Variáveis de ambiente da instância guardada. Não são repostas: transcreva-as no seu ficheiro compose.", copy: "Copiar", copied: "Copiado", replace: "Substituir definitivamente o conteúdo desta instância", replaceHint: "As contas, servidores e preferências atuais serão substituídos. A sessão será terminada e terá de entrar com as credenciais da cópia.", restoring: "A repor…", restored: "Reposição concluída. Inicie sessão novamente.", errNotBackup: "Este ficheiro não é uma cópia do FriRSS.", errVersion: "Esta cópia foi produzida por uma versão mais recente do FriRSS.", errPassphrase: "Frase-passe incorreta, ou ficheiro danificado.", errGeneric: "A operação falhou. Tente novamente." },
  uk: { title: "Резервна копія", description: "Копія містить усе для точного відновлення цього примірника: облікові записи та паролі, налаштовані сервери, токени FreshRSS і ключ, який їх розшифровує. Статей вона не містить — вони живуть у FreshRSS.", whyPassphrase: "Саме тому шифрування обовʼязкове: без парольної фрази цей файл давав би доступ до всіх облікових записів.", passphraseLost: "Втрачена парольна фраза робить копію назавжди непридатною. Зберігайте її окремо від файлу.", passphrase: "Парольна фраза", passphraseConfirm: "Підтвердьте парольну фразу", tooShort: "Щонайменше 12 символів.", mismatch: "Парольні фрази не збігаються.", download: "Завантажити копію", preparing: "Підготовка…", restoreTitle: "Відновити з копії", chooseFile: "Вибрати файл", fileChosen: "Вибраний файл:", check: "Перевірити копію", previewTitle: "Вміст копії", createdAt: "Створено", producedBy: "Створено у FriRSS", usersCount: "Облікові записи", serversCount: "Сервери", environment: "Змінні середовища збереженого примірника. Вони не відновлюються: перенесіть їх у ваш файл compose.", copy: "Копіювати", copied: "Скопійовано", replace: "Назавжди замінити вміст цього примірника", replaceHint: "Поточні облікові записи, сервери та налаштування буде перезаписано. Вас буде відʼєднано, і треба буде увійти з даними з копії.", restoring: "Відновлення…", restored: "Відновлення завершено. Увійдіть знову.", errNotBackup: "Цей файл не є резервною копією FriRSS.", errVersion: "Цю копію створено новішою версією FriRSS.", errPassphrase: "Хибна парольна фраза або пошкоджений файл.", errGeneric: "Не вдалося виконати дію. Спробуйте ще раз." },
};
for (const [loc, keys] of Object.entries(T)) {
  const p = `src/locales/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.backup = { ...(j.backup || {}), ...keys };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}
console.log("9 locales mises à jour");
'
```

- [ ] **Step 2: Vérifier la parité**

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Expected: `parité ok`

- [ ] **Step 3: Vérifier le round-trip JSON**

```bash
git diff --stat src/locales/
```
Expected: 9 fichiers, ~26 lignes ajoutées chacun. Des centaines de lignes modifiées signifieraient un round-trip raté : annuler et reprendre.

- [ ] **Step 4: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/locales
git commit -m "i18n(backup): add the backup and restore strings in all locales"
```

---

### Task 7: Le flux de restauration partagé, et le bloc d'Administration

**Files:**
- Create: `src/components/backup/RestoreFlow.tsx`
- Create: `src/components/backup/BackupExport.tsx`
- Create: `src/components/Preferences/admin/BackupBlock.tsx`
- Modify: `src/components/Preferences/AdminTab.tsx` (monter le bloc)

**Interfaces:**
- Consumes: `createBackup`, `previewRestore`, `applyRestore` de la tâche 5 ; la famille `backup.*` de la tâche 6.
- Produces: `RestoreFlow` avec les props `{ setup: boolean; onRestored: () => void }` ; `BackupExport` sans props ; `BackupBlock` sans props.

`RestoreFlow` est **partagé** avec l'écran de première connexion (tâche 8) : c'est pourquoi il vit dans `src/components/backup/` et non sous `Preferences/`. Écrire deux fois la logique de restauration serait le meilleur moyen de n'en corriger qu'une.

- [ ] **Step 1: Créer le flux de restauration**

Créer `src/components/backup/RestoreFlow.tsx` :

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewRestore, applyRestore } from '../../api/backend';
import type { RestoreSummary } from '../../types';

interface RestoreFlowProps {
  /** Instance vierge (premier démarrage) : rien à écraser, avertissement allégé. */
  setup: boolean;
  onRestored: () => void;
}

type Phase = 'idle' | 'checking' | 'preview' | 'restoring' | 'done';

/** Traduit le code d'erreur du serveur en message. Partagé par les deux écrans. */
function messageFor(err: unknown, t: (k: string) => string): string {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  if (code === 'not_a_backup') return t('backup.errNotBackup');
  if (code === 'unsupported_version') return t('backup.errVersion');
  if (code === 'bad_passphrase') return t('backup.errPassphrase');
  return t('backup.errGeneric');
}

export default function RestoreFlow({ setup, onRestored }: RestoreFlowProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [envelope, setEnvelope] = useState<unknown>(null);
  const [passphrase, setPassphrase] = useState('');
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function pickFile(file: File) {
    setError('');
    setSummary(null);
    setFileName(file.name);
    try {
      setEnvelope(JSON.parse(await file.text()));
    } catch {
      setEnvelope(null);
      setError(t('backup.errNotBackup'));
    }
  }

  async function check() {
    setPhase('checking');
    setError('');
    try {
      setSummary(await previewRestore(envelope, passphrase, setup));
      setPhase('preview');
    } catch (err) {
      setError(messageFor(err, t));
      setPhase('idle');
    }
  }

  async function replace() {
    setPhase('restoring');
    setError('');
    try {
      await applyRestore(envelope, passphrase, setup);
      setPhase('done');
      onRestored();
    } catch (err) {
      setError(messageFor(err, t));
      setPhase('preview');
    }
  }

  const envText = summary
    ? Object.entries(summary.summary.environment).map(([k, v]) => `${k}=${v}`).join('\n')
    : '';

  if (phase === 'done') {
    return (
      <p className="text-xs" role="status" style={{ color: 'var(--accent)' }}>
        {t('backup.restored')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg min-h-[44px] transition-colors hover:bg-black/5"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {t('backup.chooseFile')}
        </button>
        {fileName && (
          <span className="text-[11px] truncate" style={{ color: 'var(--list-summary)' }}>
            {t('backup.fileChosen')} {fileName}
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphrase')}
        </label>
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
      </div>

      <button
        type="button"
        onClick={check}
        disabled={!envelope || passphrase === '' || phase === 'checking'}
        aria-busy={phase === 'checking'}
        className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('backup.check')}
      </button>

      {summary && (
        <div className="rounded-lg px-3 py-3 space-y-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--list-title)' }}>{t('backup.previewTitle')}</p>
          <dl className="text-[11px] space-y-1" style={{ color: 'var(--list-summary)' }}>
            <div><dt className="inline">{t('backup.createdAt')} : </dt><dd className="inline">{summary.createdAt ?? '—'}</dd></div>
            <div><dt className="inline">{t('backup.producedBy')} : </dt><dd className="inline">{summary.appVersion ?? '—'}</dd></div>
            <div><dt className="inline">{t('backup.usersCount')} : </dt><dd className="inline">{summary.summary.users}</dd></div>
            <div><dt className="inline">{t('backup.serversCount')} : </dt><dd className="inline">{summary.summary.servers}</dd></div>
          </dl>

          {envText && (
            <div className="space-y-1.5">
              <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.environment')}</p>
              <pre className="text-[11px] overflow-x-auto rounded p-2" style={{ background: 'var(--panel-bg)', color: 'var(--list-title)' }}>{envText}</pre>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(envText); setCopied(true); }}
                className="px-3 py-1.5 text-xs rounded-lg min-h-[44px] transition-colors hover:bg-black/5"
                style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
              >
                {copied ? t('backup.copied') : t('backup.copy')}
              </button>
            </div>
          )}

          {!setup && (
            <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{t('backup.replaceHint')}</p>
          )}

          <button
            type="button"
            onClick={replace}
            disabled={phase === 'restoring'}
            aria-busy={phase === 'restoring'}
            className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] text-white disabled:opacity-50"
            style={{ background: 'var(--danger)' }}
          >
            {phase === 'restoring' ? t('backup.restoring') : t('backup.replace')}
          </button>
        </div>
      )}

      {error && <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Créer l'export**

Créer `src/components/backup/BackupExport.tsx` :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createBackup } from '../../api/backend';

const MIN_PASSPHRASE_LENGTH = 12;

export default function BackupExport() {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = passphrase !== '' && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirm !== '' && confirm !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm === passphrase;

  async function download() {
    setBusy(true);
    setError('');
    try {
      const envelope = await createBackup(passphrase);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = envelope.createdAt.replace(/[-:]/g, '').slice(0, 15);
      a.href = url;
      a.download = `frirss-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setPassphrase('');
      setConfirm('');
    } catch {
      setError(t('backup.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.description')}</p>
      <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>{t('backup.whyPassphrase')}</p>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphrase')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
        {tooShort && <span className="block text-[11px] mt-1" style={{ color: 'var(--danger)' }}>{t('backup.tooShort')}</span>}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--list-summary)' }}>
          {t('backup.passphraseConfirm')}
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        />
        {mismatch && <span className="block text-[11px] mt-1" style={{ color: 'var(--danger)' }}>{t('backup.mismatch')}</span>}
      </div>

      <p className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
        {t('backup.passphraseLost')}
      </p>

      <button
        type="button"
        onClick={download}
        disabled={!ready || busy}
        aria-busy={busy}
        className="px-4 py-2 text-xs font-medium rounded-lg min-h-[44px] disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {busy ? t('backup.preparing') : t('backup.download')}
      </button>

      {error && <p className="text-[11px]" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Assembler le bloc d'Administration**

Créer `src/components/Preferences/admin/BackupBlock.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import BackupExport from '../../backup/BackupExport';
import RestoreFlow from '../../backup/RestoreFlow';
import { useAuthStore } from '../../../stores/authStore';

/**
 * Sauvegarde et restauration, dans Administration : l'opération porte sur
 * l'instance entière, pas sur un compte. Elle vit dans son propre fichier —
 * AdminTab.tsx fait déjà 706 lignes.
 */
export default function BackupBlock() {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--list-summary)' }}>
          {t('backup.title')}
        </h3>
        <BackupExport />
      </div>

      <div style={{ borderTop: '1px solid var(--panel-border)' }} className="pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--list-summary)' }}>
          {t('backup.restoreTitle')}
        </h3>
        {/* La restauration remplace les comptes : la session courante ne vaut
            plus rien ensuite, on déconnecte plutôt que de laisser l'utilisateur
            devant une interface qui ne répond plus. */}
        <RestoreFlow setup={false} onRestored={() => setTimeout(logout, 1500)} />
      </div>
    </div>
  );
}
```

Dans `src/components/Preferences/AdminTab.tsx`, ajouter l'import en tête :

```tsx
import BackupBlock from './admin/BackupBlock';
```

puis monter le bloc à la fin du rendu, juste avant la balise fermante du conteneur racine :

```tsx
      <div className="pt-5" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <BackupBlock />
      </div>
```

- [ ] **Step 4: Vérifier la clé de déconnexion**

```bash
grep -n "logout" src/stores/authStore.ts | head -3
```
Expected: une action `logout` existe. Si son nom diffère, adapter l'appel dans `BackupBlock.tsx` — **ne pas** en créer une nouvelle.

- [ ] **Step 5: Vérifier le garde-fou des réglages**

Run: `npx vitest run src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — 4 tests. Le parcours est récursif depuis le 2026-08-26, le sous-dossier `admin/` est donc vu.

- [ ] **Step 6: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/backup src/components/Preferences/admin src/components/Preferences/AdminTab.tsx
git commit -m "feat(backup): add the backup block to the admin section"
```

---

### Task 8: Restaurer au premier démarrage

**Files:**
- Modify: `src/components/Login/Login.tsx`

**Interfaces:**
- Consumes: `RestoreFlow` de la tâche 7, la famille `backup.*` de la tâche 6.
- Produces: rien pour les tâches suivantes.

`Login.tsx` force déjà `mode = 'register'` quand aucun compte n'existe (ligne 97) et distingue ce cas par `isFirstUser` (ligne 150). On y ajoute un troisième mode, offert **uniquement** dans ce cas.

- [ ] **Step 1: Étendre le type de mode**

Dans `src/components/Login/Login.tsx`, remplacer :

```tsx
  const [mode, setMode] = useState<'login' | 'register'>('login');
```

par :

```tsx
  // 'restore' n'est proposé qu'à la toute première ouverture, quand aucun
  // compte n'existe : c'est le seul moment où il n'y a rien à écraser.
  const [mode, setMode] = useState<'login' | 'register' | 'restore'>('login');
```

- [ ] **Step 2: Ajouter l'import**

En tête du même fichier, auprès des autres imports de composants :

```tsx
import RestoreFlow from '../backup/RestoreFlow';
```

- [ ] **Step 3: Rendre le mode restauration**

Dans le bloc `{isFirstUser && isRegister && (` de la ligne 173, ajouter **après** sa balise fermante un lien vers le mode restauration, puis le mode lui-même. Insérer :

```tsx
          {isFirstUser && mode === 'register' && (
            <button
              type="button"
              onClick={() => setMode('restore')}
              className="mt-3 text-xs font-semibold min-h-[44px]"
              style={{ color: 'var(--accent)' }}
            >
              {t('backup.restoreTitle')}
            </button>
          )}

          {isFirstUser && mode === 'restore' && (
            <div className="mt-3 space-y-3">
              <RestoreFlow setup onRestored={() => setMode('login')} />
              <button
                type="button"
                onClick={() => setMode('register')}
                className="text-xs font-semibold min-h-[44px]"
                style={{ color: 'var(--accent)' }}
              >
                {t('sidebar.cancel')}
              </button>
            </div>
          )}
```

Puis conditionner le formulaire local existant pour qu'il disparaisse en mode restauration : à la ligne 285, remplacer

```tsx
          {!hideLocal && !isFirstUser && (
```

par

```tsx
          {!hideLocal && !isFirstUser && mode !== 'restore' && (
```

et faire de même pour le bloc du formulaire d'inscription : il ne doit pas s'afficher quand `mode === 'restore'`.

- [ ] **Step 4: Vérifier à l'œil, sur une instance vierge**

```bash
FRIRSS_DATA_DIR=$(mktemp -d) npm run dev:server
```

Dans un autre terminal, `npx vite`, puis ouvrir l'application. Aucun compte n'existant, l'écran doit proposer la création du premier compte **et** « Restaurer une sauvegarde ». Vérifier :

1. le lien bascule vers le flux de restauration, et l'annulation ramène à la création de compte ;
2. un fichier qui n'est pas une sauvegarde produit le message dédié, pas une erreur générique ;
3. une phrase de passe fausse produit son propre message ;
4. une sauvegarde valide affiche l'aperçu, puis restaure, puis renvoie à la connexion.

Produire la sauvegarde de test depuis une **autre** instance de développement, jamais depuis la base réelle.

- [ ] **Step 5: Gates et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add src/components/Login/Login.tsx
git commit -m "feat(backup): offer restore on a fresh install"
```

---

### Task 9: Inventaire et vérification finale

**Files:**
- Modify: `docs/FEATURES.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: un inventaire qui ne ment pas.

`featuresDoc.test.ts` exige que les **routes serveur** et les **familles de traductions** figurent dans `docs/FEATURES.md`. Les cinq nouvelles routes et la famille `backup.*` doivent y être, sans quoi le garde-fou rougit — et il aura raison.

- [ ] **Step 1: Réécrire la section Sauvegarde**

Dans `docs/FEATURES.md`, la section actuelle affirme que tout est manuel. La remplacer par :

```markdown
## Sauvegarde et restauration

Sauvegarde **complète et chiffrée**, téléchargeable depuis Administration :
comptes et mots de passe (hachages bcrypt), serveurs avec leur jeton FreshRSS
et leur jeton maître, la **clé qui déchiffre ces jetons**, le secret JWT, le
secret client OIDC, toutes les préférences et tous les réglages d'instance.
Restaurée, l'instance est celle qu'on avait : même mot de passe, flux
immédiats, rien à reconfigurer.

Ne sont **pas** dans la sauvegarde : le contenu FreshRSS (articles, flux, états
de lecture), qui vit dans FreshRSS ; et `sessions`, seule table écartée — des
jetons porteurs qui expirent.

- **Où** : `server/backupCrypto.ts` (enveloppe), `server/backup.ts` (collecte et
  application), `server/routes/backup.ts` (routes),
  `src/components/backup/` (flux partagé), `src/components/Preferences/admin/`
- **Spec** : `docs/superpowers/specs/2026-08-26-backup-restore-design.md`
- **Chiffrement** : `scrypt` puis AES-256-GCM, `node:crypto`, aucune dépendance
  nouvelle. **Phrase de passe obligatoire, 12 caractères minimum** : le fichier
  contient tout, une case « chiffrer » facultative serait un piège. Une phrase
  de passe perdue rend la sauvegarde définitivement inutilisable.
- **Deux chemins de restauration, une seule implémentation** : `/api/admin/*`
  derrière le garde administrateur, `/api/setup/*` derrière un garde « instance
  vierge ». Les deux déchiffrent, montrent un aperçu, puis remplacent.
- **Pièges** :
  - `server/crypto.ts` garde la clé de chiffrement en cache pour la durée du
    processus. La restauration appelle `resetKeyCache()` après le commit ;
    sans cela, **tous** les déchiffrements échoueraient en silence, car
    `decrypt()` renvoie `null` sur erreur — ce qui se lit « pas de jeton ».
  - Les routes `/api/setup/*` ne peuvent pas exiger d'être administrateur
    puisqu'aucun compte n'existe encore : elles refusent dès qu'**un seul**
    utilisateur existe (`userCount()`).
  - L'instantané des variables d'environnement se construit par **liste
    blanche** (`BACKUP_ENV_KEYS`), jamais depuis `process.env` en bloc : le
    conteneur peut porter les secrets d'autres services.
  - Le remplacement est intégral et tient dans **une seule transaction** : un
    échec en cours de route laisse l'instance intacte.
  - `preferences.user_id` est du `TEXT` là où `users.id` est un `INTEGER` : les
    valeurs sont réinsérées telles quelles, une conversion orphelinerait toutes
    les préférences sans erreur.
- **Ce que la sauvegarde ne peut pas restaurer** : les variables
  d'environnement (portées par le fichier compose — l'aperçu les rappelle sans
  les appliquer), l'URL de rappel enregistrée chez le fournisseur OIDC (dérivée
  de `FRIRSS_BASE_URL` ou de l'hôte de la requête), et l'adresse de FreshRSS
  s'il a lui-même déménagé.
- **`scripts/backup-db.js` reste** : instantané brut, sans phrase de passe, pour
  l'opérateur qui a un accès shell. Les deux ne se remplacent pas.
```

- [ ] **Step 2: Ajouter les routes au tableau des routes serveur**

Dans la section « Routes serveur » de `docs/FEATURES.md`, ajouter :

```markdown
| POST | `/api/admin/backup` | Produire la sauvegarde chiffrée |
| POST | `/api/admin/restore/preview` | Déchiffrer et résumer, sans écrire |
| POST | `/api/admin/restore` | Remplacer l'instance |
| POST | `/api/setup/restore/preview` | Idem, instance vierge uniquement |
| POST | `/api/setup/restore` | Idem, instance vierge uniquement |
```

- [ ] **Step 3: Relire la prose voisine**

```bash
grep -n -i "sauvegarde\|backup-db" docs/FEATURES.md
```

Vérifier qu'aucune phrase ailleurs dans le fichier n'affirme encore que la sauvegarde est uniquement manuelle. Corriger ce qui est devenu faux et le rapporter — le garde-fou n'attrape pas les descriptions périmées.

- [ ] **Step 4: Faire tourner tous les garde-fous**

Run: `npx vitest run`
Expected: PASS, `featuresDoc.test.ts` et `settingsCoverage.test.ts` compris.

- [ ] **Step 5: Vérifier la parité des traductions**

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Expected: `parité ok`

- [ ] **Step 6: Vérifier les trois facteurs de forme**

Dans le navigateur, aux trois formats — desktop, tablette, smartphone — ouvrir Préférences → Administration :

1. les champs de phrase de passe et le sélecteur de fichier sont utilisables au doigt, cibles d'au moins 44 pt ;
2. l'aperçu et le bloc des variables d'environnement se lisent sans débordement horizontal — le `<pre>` défile dans son propre conteneur, la page non ;
3. l'avertissement sur le remplacement est lisible en portrait sans être coupé.

**Piège d'outillage** : redimensionner sans recharger ne réévalue pas `useBreakpoint`. Élargir ou rétrécir, **puis recharger**, avant de juger.

- [ ] **Step 7: Un essai de bout en bout, sur des données jetables**

Sur une instance de développement, avec un compte jetable créé pour l'occasion et supprimé ensuite :

1. exporter une sauvegarde ;
2. modifier quelque chose — renommer un serveur, changer une préférence ;
3. restaurer la sauvegarde ;
4. vérifier que la modification a disparu, que la connexion se fait avec le mot de passe d'origine, et que **le jeton FreshRSS fonctionne encore** — c'est la preuve que `resetKeyCache()` a joué son rôle.

- [ ] **Step 8: Gates, garde-fou de fuite et commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```

```bash
git add docs/FEATURES.md
git commit -m "docs: record encrypted backup and restore"
```

- [ ] **Step 9: Pousser et vérifier LES DEUX workflows**

```bash
git push origin dev
```

```bash
gh run list --branch dev --limit 2
```
Expected: `CI` **et** `Publish image`, tous deux `success`. Le garde-fou de fuite tourne dans `CI` avant lint/typecheck/tests : un `CI` rouge ne veut pas dire que le code est cassé.
