import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

/*
 * `/api/servers` acceptait n'importe quelle taille et n'importe quel nombre :
 * cinq serveurs nommés de 4 Mo passaient (la base remplie par un seul compte,
 * comme les préférences avant leurs bornes). Et la relève (`/:id/actualize`)
 * échappait au plafond par minute que partagent le proxy et l'extraction.
 */
process.env.FRIRSS_PROXY_RATE_LIMIT = '3';
vi.mock('dns', () => {
  const lookup = vi.fn((_h: string, _o: unknown, cb?: (e: null, a: string, f: number) => void) => { if (typeof cb === 'function') cb(null, '93.184.216.34', 4); });
  const promises = { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) };
  return { default: { lookup, promises }, lookup, promises };
});
vi.stubGlobal('fetch', vi.fn(async () => new Response('OK', { status: 200 })));

const { default: app } = await import('../index.js');

let token = '';
beforeAll(async () => {
  token = (await request(app).post('/api/auth/register')
    .send({ username: 'owner', password: 'secret123', email: 'owner@example.com' })).body.token;
});
const add = (body: Record<string, unknown>) => request(app).post('/api/servers').set('Authorization', `Bearer ${token}`).send(body);
const base = (n: number) => ({ name: `S${n}`, url: `https://rss${n}.example.com`, freshrssUser: 'me', freshrssToken: 'tok' });

describe('/api/servers — champs bornés', () => {
  it('refuse un nom, un identifiant ou un jeton démesuré', async () => {
    expect((await add({ ...base(1), name: 'x'.repeat(201) })).status).toBe(400);
    expect((await add({ ...base(1), freshrssUser: 'x'.repeat(201) })).status).toBe(400);
    expect((await add({ ...base(1), freshrssToken: 'x'.repeat(1025) })).status).toBe(400);
  });

  it('refuse un champ qui n’est pas une chaîne', async () => {
    expect((await add({ ...base(1), name: { a: 1 } })).status).toBe(400);
    expect((await add({ ...base(1), freshrssUser: ['me'] })).status).toBe(400);
  });

  it('refuse aussi une modification démesurée', async () => {
    const id = (await add(base(2))).body.server.id;
    const res = await request(app).put(`/api/servers/${id}`).set('Authorization', `Bearer ${token}`).send({ name: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('limite le nombre de serveurs par compte', async () => {
    for (let i = 10; i < 10 + 49; i++) await add(base(i)); // avec celui du test précédent : 50
    const res = await add(base(99));
    expect(res.status).toBe(400);
  });
});

describe('/api/servers/:id/actualize — plafond par minute partagé', () => {
  it('compte dans le même seau que le proxy', async () => {
    const id = (await request(app).get('/api/servers').set('Authorization', `Bearer ${token}`)).body.servers[0].id;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(app).post(`/api/servers/${id}/actualize`).set('Authorization', `Bearer ${token}`).send({})).status);
    }
    expect(statuses).toContain(429);
  });
});
