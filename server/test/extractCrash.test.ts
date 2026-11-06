import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── Le worker d'analyse meurt sans répondre ──────────────────────────
// « extract worker exited » ressortait en 502 nu, celui d'un site injoignable :
// le client se repliait alors sur son propre extracteur, qui refaisait
// l'analyse dans l'onglet, sans borne de durée. Le plantage se dit désormais
// (`crashed`) : un échec passager, pas gardé, sans repli du client.
//
// Le plantage ne se fabrique pas avec un vrai worker sans dépendre du moteur :
// c'est `Worker` qui est remplacé, et tout le reste — `extractInWorker`, la
// file, la route — est le vrai code.
const behaviour = vi.hoisted(() => ({ next: 'exit' as 'exit' | 'error' | 'reply' }));

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeWorker extends Emitter {
    constructor() {
      super();
      const mode = behaviour.next;
      setImmediate(() => {
        if (mode === 'exit') this.emit('exit', 1);
        else if (mode === 'error') this.emit('error', new Error('boom'));
        else this.emit('message', { ok: true, article: { title: 'T', content: '<p>ordinaire</p>', excerpt: '', byline: '', siteName: '', length: 9 } });
      });
    }
    terminate() { return Promise.resolve(0); }
  }
  return { Worker: FakeWorker, default: { Worker: FakeWorker } };
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
const { extractInWorker, ExtractWorkerCrashedError } = await import('../extract.js');
const app = express();
app.use('/api/extract', extractModule.default);

const htmlResponse = () => ({
  ok: true, status: 200,
  headers: new Headers({ 'content-type': 'text/html' }),
  body: new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('<html><body><p>ordinaire</p></body></html>')); c.close(); },
  }),
});

describe('extractInWorker — worker mort sans réponse', () => {
  it('un worker qui sort sans répondre est un plantage typé', async () => {
    behaviour.next = 'exit';
    await expect(extractInWorker('https://example.com/a', '<p>x</p>')).rejects.toBeInstanceOf(ExtractWorkerCrashedError);
  });

  it('une erreur du worker (hors mémoire épuisée) est un plantage typé', async () => {
    behaviour.next = 'error';
    await expect(extractInWorker('https://example.com/a', '<p>x</p>')).rejects.toBeInstanceOf(ExtractWorkerCrashedError);
  });
});

describe('/api/extract — plantage du worker', () => {
  beforeEach(() => {
    dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    extractModule.forgetExtractFailuresForTests();
  });
  afterEach(() => { vi.unstubAllGlobals(); behaviour.next = 'exit'; });

  it('se dit (`crashed`), à part du 502 d’un site injoignable, et n’est pas gardé', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(htmlResponse()));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    behaviour.next = 'exit';
    const first = await request(app).get('/api/extract').query({ url: 'https://news.example.com/plante' });
    expect(first.status).toBe(502);
    expect(first.body).toEqual({ error: 'Extractor crashed', crashed: true });
    expect(first.body.upstreamStatus).toBeUndefined();

    // Pas gardé : la page est redemandée, et réussit.
    behaviour.next = 'reply';
    const second = await request(app).get('/api/extract').query({ url: 'https://news.example.com/plante' });
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
