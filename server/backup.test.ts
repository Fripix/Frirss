import { describe, it, expect, beforeEach } from 'vitest';
import db from './db.js';
import { collectBackup, summarizeBackup, BACKUP_ENV_KEYS, applyBackup } from './backup.js';
import { encrypt, decrypt } from './crypto.js';
import { randomBytes } from 'crypto';

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

  it("emporte les comptes avec leur hachage de mot de passe", () => {
    const p = collectBackup();
    expect(p.users).toHaveLength(1);
    expect(p.users[0]).toMatchObject({ username: 'alice', password_hash: 'hash-alice' });
  });

  it("emporte les serveurs avec leurs deux jetons", () => {
    const p = collectBackup();
    expect(p.servers[0]).toMatchObject({
      url: 'https://rss.example.com',
      freshrss_token: 'enc:v1:aaa',
      refresh_token: 'enc:v1:bbb',
    });
  });

  it("emporte la clé de chiffrement, sans laquelle les jetons seraient morts", () => {
    const keys = (p: ReturnType<typeof collectBackup>) => p.settings.map((s) => s.key);
    expect(keys(collectBackup())).toContain('encryption_key');
  });

  it('emporte les préférences telles que la base les rend, sans conversion', () => {
    const direct = db.prepare('SELECT * FROM preferences ORDER BY user_id, key').all();
    expect(collectBackup().preferences).toEqual(direct);
  });

  it('emporte les préférences avec leur contenu utile', () => {
    expect(collectBackup().preferences[0]).toMatchObject({ key: 'theme', value: 'dark' });
  });

  it("n'emporte PAS les sessions", () => {
    const p = collectBackup() as unknown as Record<string, unknown>;
    expect(p.sessions).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('jeton-de-session');
  });
});

describe("instantané d'environnement", () => {
  beforeEach(seed);

  it("ne retient que les variables de la liste blanche", () => {
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

  it("omet les variables non définies plutôt que de les rendre vides", () => {
    const saved = process.env.CORS_ORIGIN;
    try {
      delete process.env.CORS_ORIGIN;
      expect(collectBackup().environment).not.toHaveProperty('CORS_ORIGIN');
    } finally {
      if (saved !== undefined) process.env.CORS_ORIGIN = saved;
    }
  });
});

describe('summarizeBackup', () => {
  beforeEach(seed);

  it("compte les comptes et les serveurs", () => {
    const s = summarizeBackup(collectBackup());
    expect(s).toMatchObject({ users: 1, servers: 1 });
  });

  it("rend l'instantané d'environnement pour l'aperçu", () => {
    process.env.CACHE_TTL = '86400';
    try {
      expect(summarizeBackup(collectBackup()).environment.CACHE_TTL).toBe('86400');
    } finally {
      delete process.env.CACHE_TTL;
    }
  });
});

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

    const names = (db.prepare('SELECT username FROM users').all() as Record<string, unknown>[]).map((r) => r.username);
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
