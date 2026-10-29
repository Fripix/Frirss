import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { isPrivateIp } from '../routes/proxy.js';
import { sniffCharset } from '../charset.js';

/*
 * Seconde relecture de sécurité 1.8.0 : des valeurs venues du client qui
 * gelaient la boucle d'événements (retour arrière quadratique) ou passaient
 * des gardes qu'elles auraient dû rencontrer. Chaque test échouait avant son
 * correctif.
 */
let admin = '';
let adminId = 0;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register')
    .send({ username: 'owner', password: 'secret123', email: 'owner@example.com' });
  admin = res.body.token;
  adminId = res.body.user.id;
});

const quick = async <T>(p: Promise<T>, ms = 500): Promise<T> => {
  const t0 = performance.now();
  const r = await p;
  expect(performance.now() - t0).toBeLessThan(ms);
  return r;
};

describe('inscription — adresse piégée', () => {
  it('répond tout de suite, sans compte, à une adresse faite de points', async () => {
    const res = await quick(request(app).post('/api/auth/register')
      .send({ username: 'mallory', password: 'secret123', email: `a@${'.'.repeat(300_000)} ` }));
    expect([400, 403]).toContain(res.status);
  });
});

describe('serveurs — URL', () => {
  const add = (url: unknown) => request(app).post('/api/servers')
    .set('Authorization', `Bearer ${admin}`).send({ url, freshrssUser: 'u', freshrssToken: 't' });

  it('répond tout de suite à une rafale de barres, et la refuse', async () => {
    const res = await quick(add(`https://rss.example.com/${'/'.repeat(300_000)}x`));
    expect(res.status).toBe(400);
  });

  it('refuse ce qui n’est pas une URL http(s)', async () => {
    for (const url of ['pas une url', 'ftp://rss.example.com', 'javascript:alert(1)', 42]) {
      expect((await add(url)).status).toBe(400);
    }
  });

  it('accepte une URL ordinaire et retire ses barres finales', async () => {
    const res = await add('https://rss.example.com/freshrss//');
    expect(res.status).toBe(201);
    expect(res.body.server.url).toBe('https://rss.example.com/freshrss');
  });

  it('refuse aussi une URL invalide en modification', async () => {
    const created = await add('https://rss2.example.com');
    const res = await request(app).put(`/api/servers/${created.body.server.id}`)
      .set('Authorization', `Bearer ${admin}`).send({ url: 'ftp://x.example.com', freshrssToken: 't' });
    expect(res.status).toBe(400);
  });
});

describe('administration — rôle', () => {
  // `{"role": ""}` passait `typeof === 'string'`, puis les gardes `role && …`
  // (une chaîne vide est fausse), et `COALESCE('', role)` écrivait un rôle
  // vide : l'admin seul laissait l'instance sans administrateur.
  it('refuse un rôle vide, y compris pour soi', async () => {
    const res = await request(app).put(`/api/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${admin}`).send({ role: '' });
    expect(res.status).toBe(400);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin}`);
    expect(me.body.user.role).toBe('admin');
  });
});

describe('jeu de caractères — balise meta piégée', () => {
  // Le motif `["']?\s*` corrigé sur l'en-tête restait dans META_CHARSET :
  // ~230 ms par extraction pour 2 Ko de début de page, hors de la file.
  it('lit le début de page en temps linéaire', () => {
    const head = new TextEncoder().encode('<meta'.repeat(100) + ' charset=' + ' '.repeat(1400));
    const t0 = performance.now();
    sniffCharset('text/html', head);
    expect(performance.now() - t0).toBeLessThan(30);
    expect(sniffCharset('text/html', new TextEncoder().encode('<meta charset="iso-8859-1">'))).toBe('windows-1252');
    expect(sniffCharset('text/html', new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'))).toBe('utf-8');
  });
});

describe('isPrivateIp — lien-local IPv6', () => {
  it('couvre fe80::/10 en entier', () => {
    for (const ip of ['fe80::1', 'fe81::1', 'fe8f::1', 'febf::1']) expect(isPrivateIp(ip)).toBe(true);
  });
});

describe('connexion — compte local sans mot de passe', () => {
  // Le hachage factice (comparé quand le nom n'existe pas) servait aussi
  // quand le compte n'avait pas de hachage : son mot de passe, écrit en clair
  // dans ce dépôt public, ouvrait alors la session.
  it('n’ouvre pas la session avec le mot de passe du hachage factice', async () => {
    const db = (await import('../db.js')).default;
    db.prepare("INSERT INTO users (username, email, password_hash, role, active, auth_provider) VALUES ('nohash', 'nohash@example.com', NULL, 'user', 1, 'local')").run();
    const res = await request(app).post('/api/auth/login').send({ username: 'nohash', password: 'frirss-no-such-user' });
    expect(res.status).toBe(401);
  });
});
