import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── M-01 vu de la route : une page piégée ne gèle plus l'instance ─────
// Avant : l'analyse tournait sur la boucle principale, sans borne de durée ;
// 1000 `<div>` imbriqués rendaient `/api/health` muet 17,8 s, et l'échec
// n'étant gardé nulle part, chaque ouverture de l'article recommençait.

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn() }));

vi.mock('dns', () => {
  const promises = { lookup: dnsLookup };
  const lookup = vi.fn();
  return { default: { lookup, promises }, lookup, promises };
});

const extractModule = await import('../routes/extract.js');
const extractRoutes = extractModule.default;

const app = express();
app.use('/api/extract', extractRoutes);

const htmlResponse = (html: string) => ({
  ok: true, status: 200,
  headers: new Headers({ 'content-type': 'text/html' }),
  body: new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(html)); c.close(); },
  }),
});

const nested = (depth: number) => `<html><body>${'<div>'.repeat(depth)}<p>court</p>${'</div>'.repeat(depth)}</body></html>`;

/** Sous les seuils du refus rapide, mais ~1 s d'analyse (20 chaînes de 200 niveaux). */
const costly = () => {
  const chain = `${'<div>'.repeat(200)}<p>court</p>${'</div>'.repeat(200)}`;
  return `<html><body>${chain.repeat(20)}</body></html>`;
};

describe('/api/extract — page piégée', () => {
  beforeEach(() => {
    dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    extractModule.forgetExtractFailuresForTests();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('refuse vite une page imbriquée sur 1000 niveaux, d’un refus que le client sait définitif', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(nested(1000))));
    const started = performance.now();

    const res = await request(app).get('/api/extract').query({ url: 'https://news.example.com/piege' });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Page too complex', tooComplex: true });
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('garde l’échec : la page piégée n’est ni retéléchargée ni réanalysée à l’ouverture suivante', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse(nested(1000))));
    vi.stubGlobal('fetch', fetchMock);

    const first = await request(app).get('/api/extract').query({ url: 'https://news.example.com/piege' });
    const second = await request(app).get('/api/extract').query({ url: 'https://news.example.com/piege' });

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(second.body).toEqual({ error: 'Page too complex', tooComplex: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pendant une analyse coûteuse, la boucle principale continue de servir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(costly())));
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 10);
    try {
      const started = performance.now();
      const res = await request(app).get('/api/extract').query({ url: 'https://news.example.com/couteuse' });
      const elapsed = performance.now() - started;
      // Au moins la moitié des tours possibles pendant la requête : sur la
      // boucle principale, l'analyse (~1 s) n'en laissait passer presque aucun.
      expect(ticks).toBeGreaterThan((elapsed / 10) * 0.5);
      // Et la page a bien été analysée jusqu'au bout, sans refus.
      expect(res.status).toBe(200);
    } finally {
      clearInterval(timer);
    }
  });

  it('ne garde pas un échec réseau : la page est redemandée', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } }))
      .mockImplementation(() => Promise.resolve(htmlResponse(nested(1000))));
    vi.stubGlobal('fetch', fetchMock);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await request(app).get('/api/extract').query({ url: 'https://news.example.com/reseau' });
    const second = await request(app).get('/api/extract').query({ url: 'https://news.example.com/reseau' });

    expect(first.status).toBe(502);
    expect(second.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
