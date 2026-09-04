import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── La file d'analyse pleine, vue de la route ────────────────────────
// La saturation de la file (`EXTRACT_MAX_PENDING`) ne se fabrique pas de
// l'extérieur : l'analyse étant synchrone, il faudrait que six requêtes
// atteignent la file exactement dans le même tour de boucle — un test qui
// dépendrait de l'ordonnancement, donc un test qui clignote. C'est donc
// `withExtractSlot` qui est remplacée ici, pour ne vérifier que la traduction
// du refus en réponse. Le comportement de la file elle-même est couvert
// directement dans `server/test/extract.test.ts`.
//
// Ce que ce test garde : le refus doit être un échec ORDINAIRE, dont le client
// se replie sur son propre extracteur — pas un 200 vide, pas un 403.
vi.mock('../extract.js', async () => {
  const actual = await vi.importActual<typeof import('../extract.js')>('../extract.js');
  return {
    ...actual,
    withExtractSlot: () => Promise.reject(new actual.ExtractorBusyError()),
  };
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

const extractRoutes = (await import('../routes/extract.js')).default;

const app = express();
app.use('/api/extract', extractRoutes);

describe('extract — file d’analyse saturée', () => {
  it('répond un échec ordinaire dont le client peut se replier', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new TextEncoder().encode('<html><body><p>x</p></body></html>')); c.close(); },
      }),
    }));

    const res = await request(app).get('/api/extract').query({ url: 'https://news.example.com/a' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Extractor busy' });
    vi.unstubAllGlobals();
  });
});
