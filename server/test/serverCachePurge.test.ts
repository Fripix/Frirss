import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

/*
 * M-09 : la clé du cache des listes porte le serveur (l'id de sa ligne). Une
 * ligne peut pourtant changer de compte FreshRSS sans changer d'id — la
 * modification d'un serveur accepte un autre utilisateur, ou une autre
 * adresse — et ses listes en cache restaient celles de l'ancien compte
 * jusqu'à `CACHE_TTL`, peintes avant la revalidation. Un serveur supprimé
 * laissait de même ses listes derrière lui, comme un compte supprimé avant
 * `cachePurgeUser`.
 */
const { cachePurgeServer } = vi.hoisted(() => ({ cachePurgeServer: vi.fn(async () => {}) }));
vi.mock('../cache.js', async () => ({
  ...await vi.importActual<typeof import('../cache.js')>('../cache.js'),
  cachePurgeServer,
}));
vi.mock('dns', () => {
  const lookup = vi.fn((_h: string, _o: unknown, cb?: (e: null, a: string, f: number) => void) => { if (typeof cb === 'function') cb(null, '93.184.216.34', 4); });
  const promises = { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) };
  return { default: { lookup, promises }, lookup, promises };
});

const { default: app } = await import('../index.js');

let token = '';
let userId = 0;
beforeAll(async () => {
  const res = await request(app).post('/api/auth/register')
    .send({ username: 'purge', password: 'secret123', email: 'purge@example.com' });
  token = res.body.token;
  userId = res.body.user.id;
});
beforeEach(() => { cachePurgeServer.mockClear(); });

const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
const add = async (freshrssUser: string) => (await auth(request(app).post('/api/servers'))
  .send({ name: freshrssUser, url: 'https://rss.example.com', freshrssUser, freshrssToken: 'tok' })).body.server.id as number;

describe('/api/servers — le cache des listes suit le serveur', () => {
  it('purge les listes d’un serveur qui passe à un autre utilisateur FreshRSS', async () => {
    const id = await add('alice');
    const res = await auth(request(app).put(`/api/servers/${id}`)).send({ freshrssUser: 'bob', freshrssToken: 'tok2' });
    expect(res.status).toBe(200);
    expect(cachePurgeServer).toHaveBeenCalledWith(userId, id);
  });

  it('purge les listes d’un serveur qui change d’adresse', async () => {
    const id = await add('carol');
    const res = await auth(request(app).put(`/api/servers/${id}`)).send({ url: 'https://other.example.com', freshrssToken: 'tok2' });
    expect(res.status).toBe(200);
    expect(cachePurgeServer).toHaveBeenCalledWith(userId, id);
  });

  it('garde le cache quand seul le nom change', async () => {
    const id = await add('dave');
    const res = await auth(request(app).put(`/api/servers/${id}`)).send({ name: 'Renommé' });
    expect(res.status).toBe(200);
    expect(cachePurgeServer).not.toHaveBeenCalled();
  });

  it('purge les listes d’un serveur supprimé', async () => {
    const id = await add('erin');
    const res = await auth(request(app).delete(`/api/servers/${id}`));
    expect(res.status).toBe(200);
    expect(cachePurgeServer).toHaveBeenCalledWith(userId, id);
  });
});
