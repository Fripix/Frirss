import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * Avec `REDIS_URL`, une lecture greader est lue EN ENTIER avant d'être
 * renvoyée et mise en cache. « Lecture greader » se décidait sur la chaîne
 * brute de la cible (\`includes('/reader/api/0/')\`), donc n'importe quelle
 * URL publique qui la portait dans sa requête l'était aussi — et rien ne
 * bornait les octets accumulés : un amont rapide remplissait la mémoire du
 * processus. Vrai amont local, comme `proxyDeadline.test.ts`.
 */
process.env.PROXY_INTERNAL_HOSTS = '127.0.0.1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const cacheSet = vi.fn(async () => {});
vi.mock('../cache.js', () => ({
  cacheEnabled: true,
  cacheGet: vi.fn(async () => null),
  cacheSet: (...a: unknown[]) => cacheSet(...(a as [])),
  cacheKey: (u: unknown, t: string) => `k:${String(u)}:${t}`,
  trimStreamJson: (s: string) => s,
}));

const { default: proxyRouter, MAX_CACHED_BODY_BYTES } = await import('../routes/proxy.js');

const CHUNK = Buffer.alloc(1024 * 1024, 0x61);
const upstream = http.createServer((req, res) => {
  const path = req.url ?? '';
  if (path.startsWith('/reader/api/0/stream/contents/huge')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let sent = 0;
    const pump = () => {
      while (sent <= MAX_CACHED_BODY_BYTES + CHUNK.length) {
        sent += CHUNK.length;
        if (!res.write(CHUNK)) { res.once('drain', pump); return; }
      }
      res.end();
    };
    pump();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});

const app = express();
app.use('/api/proxy', proxyRouter);
const front = http.createServer(app);
let upBase = '';
let frontPort = 0;

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r));
  upBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  frontPort = (front.address() as AddressInfo).port;
});
afterAll(async () => {
  upstream.closeAllConnections();
  front.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
  await new Promise<void>((r) => front.close(() => r()));
});
beforeEach(() => { cacheSet.mockClear(); });

function call(path: string): Promise<{ status: number; bytes: number }> {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'GET',
      headers: { 'X-Proxy-Target': `${upBase}${path}` },
    }, (res) => {
      let bytes = 0;
      res.on('data', (c: Buffer) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, bytes }));
      res.on('error', () => resolve({ status: res.statusCode ?? 0, bytes }));
    });
    req.on('error', () => resolve({ status: 0, bytes: 0 }));
    req.end();
  });
}

describe('/api/proxy — lectures mises en cache', () => {
  it('borne le corps lu en mémoire, et ne met rien en cache au-delà', async () => {
    const res = await call('/reader/api/0/stream/contents/huge');
    expect(res.status).toBe(502);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('met en cache une lecture greader ordinaire', async () => {
    const res = await call('/reader/api/0/subscription/list?output=json');
    expect(res.status).toBe(200);
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  it('ne prend pas pour une lecture greader une URL qui ne la porte que dans sa requête', async () => {
    const res = await call('/big?x=/reader/api/0/');
    expect(res.status).toBe(200);
    expect(cacheSet).not.toHaveBeenCalled();
  });
});
