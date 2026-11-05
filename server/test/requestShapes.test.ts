import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

/*
 * Corps de requête de forme inattendue : un objet là où une chaîne est
 * attendue faisait lever better-sqlite3 ou bcrypt, donc un 500 et une ligne
 * « Internal server error » au journal pour ce qui est une faute du client.
 * Et `PUT /api/admin/settings` écrivait les premiers réglages avant de
 * refuser le suivant.
 */
vi.mock('dns', () => {
  const lookup = vi.fn((_h: string, _o: unknown, cb?: (e: null, a: string, f: number) => void) => { if (typeof cb === 'function') cb(null, '93.184.216.34', 4); });
  const promises = { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) };
  return { default: { lookup, promises }, lookup, promises };
});

const { default: app } = await import('../index.js');
const { getSetting, default: db } = await import('../db.js');

let token = '';
beforeAll(async () => {
  token = (await request(app).post('/api/auth/register')
    .send({ username: 'owner', password: 'secret123', email: 'owner@example.com' })).body.token;
});
const auth = () => ({ Authorization: `Bearer ${token}` });

describe('PUT /api/admin/settings — tout ou rien', () => {
  it('un réglage refusé n’en laisse écrit aucun autre', async () => {
    const before = getSetting('registration_enabled');
    const res = await request(app).put('/api/admin/settings').set(auth())
      .send({ registrationEnabled: before !== 'true', loginAnimation: 'bogus' });
    expect(res.status).toBe(400);
    expect(getSetting('registration_enabled')).toBe(before);
  });

  it('un émetteur OIDC qui n’est pas une chaîne : 400, rien d’écrit', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth())
      .send({ oidcClientId: 'nouveau', oidcIssuer: { url: 'https://idp.example.com' } });
    expect(res.status).toBe(400);
    expect(getSetting('oidc_client_id') ?? '').not.toBe('nouveau');
  });

  it('un booléen qui n’en est pas un : 400', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth()).send({ ssoOnly: 'false' });
    expect(res.status).toBe(400);
  });

  it('une requête valide écrit tout', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth())
      .send({ loginAnimation: 'none', oidcButtonLabel: 'SSO' });
    expect(res.status).toBe(200);
    expect(getSetting('login_animation')).toBe('none');
    expect(getSetting('oidc_button_label')).toBe('SSO');
  });
});

describe('types inattendus → 400, pas 500', () => {
  it('connexion', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await request(app).post('/api/auth/login').send({ username: { $ne: 1 }, password: 'secret123' });
    const b = await request(app).post('/api/auth/login').send({ username: 'owner', password: ['secret123'] });
    err.mockRestore();
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  it('changement de mot de passe', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/auth/change-password').set(auth())
      .send({ currentPassword: { a: 1 }, newPassword: 'nouveau123' });
    err.mockRestore();
    expect(res.status).toBe(400);
  });
});

describe('POST /api/servers — doublon par origine normalisée', () => {
  const add = (url: string) => request(app).post('/api/servers').set(auth())
    .send({ url, freshrssUser: 'me', freshrssToken: 'tok' });

  it('le port par défaut écrit et la casse de l’hôte ne font pas un autre serveur', async () => {
    expect((await add('https://rss.example.com/freshrss')).status).toBe(201);
    expect((await add('https://rss.example.com:443/freshrss')).status).toBe(409);
    expect((await add('https://RSS.Example.com/freshrss/')).status).toBe(409);
    expect((await add('http://rss2.example.com')).status).toBe(201);
    expect((await add('http://rss2.example.com:80/')).status).toBe(409);
  });

  it('un autre chemin, un autre port ou un autre compte restent distincts', async () => {
    expect((await add('https://rss.example.com/autre')).status).toBe(201);
    expect((await add('https://rss.example.com:8443/freshrss')).status).toBe(201);
    const other = await request(app).post('/api/servers').set(auth())
      .send({ url: 'https://rss.example.com/freshrss', freshrssUser: 'toi', freshrssToken: 'tok' });
    expect(other.status).toBe(201);
  });

  // Des jumeaux existent déjà (ajoutés avant 1.9.0, quand la comparaison se
  // faisait sur la chaîne) : modifier l'un sans changer d'identité ne doit pas
  // être refusé — sinon on ne peut plus lui donner de nouveaux identifiants.
  it('un serveur qui a déjà un jumeau reste modifiable tant qu’il ne change pas d’identité', async () => {
    const first = (await add('https://rss4.example.com')).body.server.id;
    const { lastInsertRowid } = db.prepare('INSERT INTO servers (user_id, name, url, freshrss_user, freshrss_token) SELECT user_id, name, ?, freshrss_user, freshrss_token FROM servers WHERE id = ?')
      .run('https://RSS4.example.com:443', first);
    const twin = Number(lastInsertRowid);
    expect((await request(app).put(`/api/servers/${twin}`).set(auth()).send({ name: 'Jumeau' })).status).toBe(200);
    expect((await request(app).put(`/api/servers/${twin}`).set(auth()).send({ freshrssToken: 'neuf' })).status).toBe(200);
  });

  it('une modification ne peut pas rejoindre un serveur existant', async () => {
    const id = (await add('https://rss3.example.com')).body.server.id;
    const res = await request(app).put(`/api/servers/${id}`).set(auth())
      .send({ url: 'https://rss.example.com:443/freshrss', freshrssToken: 'tok2' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/preferences — une clé __proto__', () => {
  it('est rendue comme une clé ordinaire, sans devenir le prototype de la réponse', async () => {
    const put = await request(app).put('/api/preferences').set(auth())
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"pollue":true},"ordinaire":1}');
    expect(put.status).toBe(200);
    const res = await request(app).get('/api/preferences').set(auth());
    const own = JSON.parse(res.text).preferences as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(own, '__proto__')).toBe(true);
    expect(own.ordinaire).toBe(1);
  });
});
