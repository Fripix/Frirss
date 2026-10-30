import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * La préparation hors ligne télécharge chaque `<img src>` d'un article par le
 * proxy (`X-Proxy-Image`), et le client garde la réponse entière en mémoire
 * avant de l'enregistrer. Une `<img>` qui pointait vers une vidéo `.mp4`
 * relayée en flux pendant l'échéance totale (60 s) faisait grossir l'onglet
 * d'environ 50 Mo/s : Android le tuait au même article à chaque essai. Une
 * requête d'image ne relaie plus qu'une image, et jamais au-delà d'un plafond.
 * Vrai amont local, comme `proxyCacheBounds.test.ts`.
 */
process.env.PROXY_INTERNAL_HOSTS = '127.0.0.1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../cache.js', () => ({
  cacheEnabled: false,
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheKey: (u: unknown, t: string) => `k:${String(u)}:${t}`,
  trimStreamJson: (s: string) => s,
  cacheableEntry: (s: string) => s,
}));

const { default: proxyRouter, MAX_PROXIED_IMAGE_BYTES } = await import('../routes/proxy.js');

const CHUNK = Buffer.alloc(1024 * 1024, 0x61);
/** Octets que l'amont a réussi à écrire, par chemin : dit s'il a été arrêté. */
const written: Record<string, number> = {};

/** Un corps sans fin (flux de webcam, vidéo) : n'arrête que si on le coupe. */
function endless(res: http.ServerResponse, path: string, type: string) {
  res.writeHead(200, { 'Content-Type': type });
  written[path] = 0;
  const pump = () => {
    while (written[path] < 4 * MAX_PROXIED_IMAGE_BYTES) {
      written[path] += CHUNK.length;
      if (!res.write(CHUNK)) { res.once('drain', pump); return; }
    }
    res.end();
  };
  res.on('close', () => {}); // la coupure côté proxy arrête `pump` (plus de `drain`)
  pump();
}

const upstream = http.createServer((req, res) => {
  const path = req.url ?? '';
  if (path === '/video.mp4') return endless(res, path, 'video/mp4');
  if (path === '/stream.jpg') return endless(res, path, 'image/jpeg');
  if (path === '/declared-huge.jpg') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX_PROXIED_IMAGE_BYTES + 1) });
    written[path] = 0;
    res.write(CHUNK); // l'amont commence, le proxy doit refuser sur l'en-tête
    return;
  }
  if (path === '/small.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(Buffer.alloc(2048, 1));
  }
  if (path === '/untyped') {
    res.writeHead(200);
    return res.end(Buffer.alloc(1024, 1));
  }
  if (path === '/octet') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return res.end(Buffer.alloc(1024, 1));
  }
  if (path === '/missing.mp4') {
    // Une page d'erreur qui sert une vidéo sans fin : même risque qu'un 200.
    res.writeHead(404, { 'Content-Type': 'video/mp4' });
    written[path] = 0;
    const pump = () => { while (written[path] < 4 * MAX_PROXIED_IMAGE_BYTES) { written[path] += CHUNK.length; if (!res.write(CHUNK)) { res.once('drain', pump); return; } } res.end(); };
    pump();
    return;
  }
  if (path === '/page.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return res.end(Buffer.alloc(4096, 1));
  }
  res.writeHead(404);
  res.end();
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

function call(path: string, image = true): Promise<{ status: number; bytes: number }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = { 'X-Proxy-Target': `${upBase}${path}` };
    if (image) headers['X-Proxy-Image'] = '1';
    const req = http.request({ host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'GET', headers }, (res) => {
      let bytes = 0;
      res.on('data', (c: Buffer) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, bytes }));
      res.on('error', () => resolve({ status: res.statusCode ?? 0, bytes }));
      res.on('aborted', () => resolve({ status: res.statusCode ?? 0, bytes }));
    });
    req.on('error', () => resolve({ status: 0, bytes: 0 }));
    req.end();
  });
}

describe('requête d’image du proxy : une image, et bornée', () => {
  it('refuse ce qui n’est pas une image (une vidéo derrière une <img>)', async () => {
    const res = await call('/video.mp4');
    expect(res.status).toBe(415);
    expect(res.bytes).toBeLessThan(1024);
  });

  it('refuse une image annoncée au-delà du plafond, sans la relayer', async () => {
    const res = await call('/declared-huge.jpg');
    expect(res.status).toBe(413);
    expect(res.bytes).toBeLessThan(1024);
  });

  it('coupe une image sans fin au plafond', async () => {
    const res = await call('/stream.jpg');
    expect(res.bytes).toBeLessThanOrEqual(MAX_PROXIED_IMAGE_BYTES + CHUNK.length);
    expect(written['/stream.jpg']).toBeLessThan(4 * MAX_PROXIED_IMAGE_BYTES);
  }, 30_000);

  it('ne relaie que le statut d’une réponse en erreur, pas son corps', async () => {
    const res = await call('/missing.mp4');
    expect(res.status).toBe(404);
    expect(res.bytes).toBeLessThan(1024);
    // Et le serveur a cessé de tirer l'amont (corps annulé).
    await new Promise((r) => setTimeout(r, 100));
    expect(written['/missing.mp4']).toBeLessThan(4 * MAX_PROXIED_IMAGE_BYTES);
  });

  it('relaie une image ordinaire en entier', async () => {
    expect(await call('/small.png')).toEqual({ status: 200, bytes: 2048 });
  });

  it('laisse passer un type absent ou générique : des CDN servent ainsi des images', async () => {
    expect(await call('/untyped')).toEqual({ status: 200, bytes: 1024 });
    expect(await call('/octet')).toEqual({ status: 200, bytes: 1024 });
  });

  it('ne change rien aux requêtes qui ne sont pas des images', async () => {
    expect(await call('/page.mp4', false)).toEqual({ status: 200, bytes: 4096 });
  });
});
