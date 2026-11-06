import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * M-09 (campagne 1.9.0, second round). Avec Redis, deux serveurs du même
 * compte à la même adresse — deux utilisateurs FreshRSS, ce que FEATURES
 * recommande pour lire un autre compte — partageaient la clé de cache, qui ne
 * portait que le compte FriRSS et l'URL. La liste de l'un se peignait sous
 * l'autre (et finissait dans son cache hors ligne). Vraie fonction de clé,
 * Redis remplacé par une table en mémoire, vrai amont local qui répond selon
 * le jeton reçu.
 */
process.env.PROXY_INTERNAL_HOSTS = '127.0.0.1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const store = new Map<string, string>();
vi.mock('../cache.js', async () => ({
  ...await vi.importActual<typeof import('../cache.js')>('../cache.js'),
  cacheEnabled: true,
  cacheGet: vi.fn(async (k: string) => store.get(k) ?? null),
  cacheSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  cacheDel: vi.fn(async (k: string) => { store.delete(k); }),
}));

const { default: proxyRouter } = await import('../routes/proxy.js');
const { encrypt } = await import('../crypto.js');
const { default: db } = await import('../db.js');

// L'amont rend la liste du compte FreshRSS que désigne le jeton.
const upstream = http.createServer((req, res) => {
  const who = /auth=(\w+)/.exec(req.headers.authorization ?? '')?.[1] ?? 'personne';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ items: [{ id: `article-de-${who}` }] }));
});
const app = express();
app.use('/api/proxy', proxyRouter);
const front = http.createServer(app);
let upBase = '';
let frontPort = 0;
let alice = 0;
let bob = 0;

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r));
  upBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  frontPort = (front.address() as AddressInfo).port;
  db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash, role, active, auth_provider) VALUES (1, 'u1', 'u1@example.com', NULL, 'admin', 1, 'local')").run();
  const add = db.prepare('INSERT INTO servers (user_id, url, freshrss_user, freshrss_token) VALUES (1, ?, ?, ?)');
  alice = Number(add.run(upBase, 'alice', encrypt('alice')).lastInsertRowid);
  bob = Number(add.run(upBase, 'bob', encrypt('bob')).lastInsertRowid);
});
afterAll(async () => {
  upstream.closeAllConnections();
  front.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
  await new Promise<void>((r) => front.close(() => r()));
});

const STARRED = '/api/greader.php/reader/api/0/stream/contents/user/-/state/com.google/starred?output=json&n=50';

function call(serverId: number, cacheOnly: boolean): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'GET',
      headers: {
        'X-Proxy-Target': `${upBase}${STARRED}`,
        'X-Server-Id': String(serverId),
        ...(cacheOnly ? { 'X-Cache-Only': '1' } : {}),
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('/api/proxy — cache des lectures, un serveur par clé', () => {
  it("ne peint pas la liste d'un serveur sous un autre à la même adresse", async () => {
    const live = await call(alice, false);
    expect(live.body).toContain('article-de-alice');
    await vi.waitFor(() => expect(store.size).toBe(1));

    // Bob n'a encore rien mis en cache : rien à peindre, pas la liste d'Alice.
    const painted = await call(bob, true);
    expect(painted.body).not.toContain('article-de-alice');
    expect(painted.status).toBe(204);

    // Chacun relit ensuite sa propre liste.
    await call(bob, false);
    await vi.waitFor(() => expect(store.size).toBe(2));
    expect((await call(alice, true)).body).toContain('article-de-alice');
    expect((await call(bob, true)).body).toContain('article-de-bob');
  });
});
