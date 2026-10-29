import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * `/api/extract` n'avait de délai que par saut (en-têtes) et pour le corps :
 * un amont qui redirige toutes les 25 s, sous le délai d'un saut, tenait
 * l'extraction ~230 s — bien après nginx (120 s) et le client (20 s), et un
 * appelant coalescé attendait avec elle.
 */
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('dns', () => {
  const promises = { lookup: dnsLookup };
  const lookup = vi.fn();
  return { default: { lookup, promises }, lookup, promises };
});

const { default: extractRoutes, EXTRACT_FETCH_TIMEOUT_MS } = await import('../routes/extract.js');

const realSetTimeout = globalThis.setTimeout;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('/api/extract — échéance totale', () => {
  it('répond 504 à l’échéance quand l’amont redirige sans fin, chaque saut sous son délai', async () => {
    let hops = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      hops++;
      const t = setTimeout(() => resolve(new Response(null, { status: 302, headers: { Location: `${url}x` } })), 25_000);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal!.reason); }, { once: true });
    })));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const app = express();
    app.use('/api/extract', extractRoutes);
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const result = new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: `/api/extract?url=${encodeURIComponent('https://news.example.com/a')}` }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }).on('error', () => resolve(0));
    });

    // Laisse la requête atteindre `fetch` (vrais allers-retours réseau).
    await new Promise((r) => realSetTimeout(r, 100));
    await vi.advanceTimersByTimeAsync(EXTRACT_FETCH_TIMEOUT_MS + 1_000);
    vi.useRealTimers();
    const status = await Promise.race([result, new Promise<number>((r) => realSetTimeout(() => r(-1), 2_000))]);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));

    expect(status).toBe(504);
    expect(hops).toBeLessThanOrEqual(Math.ceil(EXTRACT_FETCH_TIMEOUT_MS / 25_000));
    expect(EXTRACT_FETCH_TIMEOUT_MS).toBeLessThan(120_000);
  });
});
