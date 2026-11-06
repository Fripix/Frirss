import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── Relecture 1.9.0 (R1-4) : un délai n'est pas une page piégée ──────
// Le délai du worker (10 s) était rendu comme un refus pour complexité :
// `tooComplex`, mémorisé 5 min par le serveur et pour la session par le
// client. Or un serveur chargé (cinq analyses à la fois, une machine lente)
// peut dépasser le délai sur une page ordinaire. Un délai se dit donc à part
// (`timedOut`), n'est pas gardé, et le client peut réessayer.
//
// Le délai réel (10 s) ne se fabrique pas dans un test : c'est
// `extractInWorker` qui est remplacée, pour ne vérifier que la traduction du
// dépassement en réponse. Le dépassement lui-même est couvert dans
// `server/test/extractGuard.test.ts`.
const { extractInWorker } = vi.hoisted(() => ({ extractInWorker: vi.fn() }));
vi.mock('../extract.js', async () => {
  const actual = await vi.importActual<typeof import('../extract.js')>('../extract.js');
  return { ...actual, extractInWorker };
});

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
const { ExtractTimeoutError } = await import('../extract.js');
const app = express();
app.use('/api/extract', extractModule.default);

const htmlResponse = () => ({
  ok: true, status: 200,
  headers: new Headers({ 'content-type': 'text/html' }),
  body: new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('<html><body><p>ordinaire</p></body></html>')); c.close(); },
  }),
});

describe('/api/extract — délai d’analyse dépassé', () => {
  beforeEach(() => {
    dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    extractModule.forgetExtractFailuresForTests();
    extractInWorker.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('se dit à part de la page piégée, et n’est pas gardé : la page est redemandée', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse()));
    vi.stubGlobal('fetch', fetchMock);
    extractInWorker.mockRejectedValueOnce(new ExtractTimeoutError())
      .mockResolvedValueOnce({ title: 'T', content: '<p>ordinaire</p>', excerpt: '', byline: '', siteName: '', length: 9 });

    const first = await request(app).get('/api/extract').query({ url: 'https://news.example.com/lente' });
    expect(first.status).toBe(504);
    expect(first.body).toEqual({ error: 'Extraction timed out', timedOut: true });
    expect(first.body.tooComplex).toBeUndefined();

    const second = await request(app).get('/api/extract').query({ url: 'https://news.example.com/lente' });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
