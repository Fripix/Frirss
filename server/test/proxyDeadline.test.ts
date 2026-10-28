import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// ── L'échéance TOTALE de `/api/proxy` ─────────────────────────────────
// Le délai par saut de `fetchUpstream` s'arrête aux en-têtes : un amont qui
// envoie ses en-têtes puis retient son corps, ou qui enchaîne des redirections
// lentes, tenait la requête jusqu'à la coupure de nginx (120 s) — au-delà du
// délai que le client s'accorde. La règle (« le serveur répond toujours avant
// que le client abandonne ») ne tient que si chaque appel a une fin bornée.
//
// Un VRAI amont HTTP local, et le vrai `fetch` de Node : c'est le
// comportement réel du corps d'une réponse undici qu'il faut observer, pas
// celui d'une doublure. `127.0.0.1` est déclaré hôte interne de confiance,
// exactement comme un opérateur le ferait pour son FreshRSS.
//
// Seuls `setTimeout`/`clearTimeout` sont simulés : le réseau reste réel, les
// minuteurs de la route et de l'amont deviennent pilotables.
process.env.PROXY_INTERNAL_HOSTS = '127.0.0.1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Cache « activé » : la branche bufferisée (lectures greader) lit tout le corps
// AVANT d'envoyer les en-têtes, elle seule peut donc encore répondre 504.
vi.mock('../cache.js', () => ({
  cacheEnabled: true,
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  cacheKey: (u: unknown, t: string) => `k:${String(u)}:${t}`,
  trimStreamJson: (s: string) => s,
}));

const { default: proxyRouter, PROXY_TOTAL_TIMEOUT_MS } = await import('../routes/proxy.js');

const realSetTimeout = globalThis.setTimeout;
const realDelay = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

const HOP_DELAY_MS = 20_000;   // sous les 30 s par saut : seule l'échéance totale peut couper
const hits: string[] = [];
let hitWaiters: { path: string; resolve: () => void }[] = [];
const upstreamHit = (path: string) => new Promise<void>((resolve) => {
  if (hits.includes(path)) resolve();
  else hitWaiters.push({ path, resolve });
});

// Écriture en cours côté amont : le test la libère quand il le décide, et
// observe si la connexion amont a été coupée entre-temps.
let releaseWrite: () => void = () => {};
const writeSeen: { body: string; closedEarly: boolean; answered: boolean } = { body: '', closedEarly: false, answered: false };

const upstream = http.createServer((req, res) => {
  const path = req.url ?? '';
  hits.push(path);
  hitWaiters.filter((w) => w.path === path).forEach((w) => w.resolve());
  hitWaiters = hitWaiters.filter((w) => w.path !== path);

  if (path === '/stall-body') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('partial');          // en-têtes + un morceau, puis plus rien
    return;
  }
  if (path === '/reader/api/0/stream/contents/stall') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"items":[');
    return;
  }
  if (path === '/silent') return;  // ni en-têtes ni corps
  if (path === '/write' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { body += c; });
    req.on('end', () => {
      writeSeen.body = body;
      req.socket.once('close', () => { if (!writeSeen.answered) writeSeen.closedEarly = true; });
      hitWaiters.filter((w) => w.path === 'write-received').forEach((w) => w.resolve());
      releaseWrite = () => {
        writeSeen.answered = true;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      };
    });
    return;
  }
  const hop = /^\/hop\/(\d+)$/.exec(path);
  if (hop) {
    // Chaque saut répond à temps (20 s < 30 s), mais six sauts font 120 s.
    setTimeout(() => {
      res.writeHead(302, { Location: `/hop/${Number(hop[1]) + 1}` });
      res.end();
    }, HOP_DELAY_MS);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('fine');
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
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => front.close(r));
});

afterEach(() => {
  vi.useRealTimers();
  hits.length = 0;
  hitWaiters = [];
  upstream.closeAllConnections();
});

interface Outcome { status?: number; body: string; complete: boolean }

/** Appelle `/api/proxy` et rend ce que voit le navigateur : statut, corps, et si la réponse est arrivée ENTIÈRE. */
function call(path: string, onFirstChunk?: () => void): Promise<Outcome> {
  return new Promise((resolve) => {
    const out: Outcome = { body: '', complete: false };
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'GET',
      headers: { 'X-Proxy-Target': `${upBase}${path}` },
    }, (res) => {
      out.status = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (c: string) => { out.body += c; onFirstChunk?.(); onFirstChunk = undefined; });
      res.on('end', () => { out.complete = res.complete; resolve(out); });
      res.on('error', () => resolve(out));
      res.on('aborted', () => resolve(out));
    });
    req.on('error', () => resolve(out));
    req.end();
  });
}

/** `p` s'est-il réglé dans `ms` de temps RÉEL ? */
async function settledWithin<T>(p: Promise<T>, ms: number): Promise<boolean> {
  return Promise.race([p.then(() => true), realDelay(ms).then(() => false)]);
}

describe('/api/proxy — échéance totale', () => {
  it('vaut 60 s', () => {
    expect(PROXY_TOTAL_TIMEOUT_MS).toBe(60_000);
  });

  it('coupe un corps déjà commencé qui ne finit jamais, à l’échéance et pas avant', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let started!: () => void;
    const firstChunk = new Promise<void>((r) => { started = r; });
    const p = call('/stall-body', () => started());
    await firstChunk;

    await vi.advanceTimersByTimeAsync(PROXY_TOTAL_TIMEOUT_MS - 1_000);
    expect(await settledWithin(p, 100)).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settledWithin(p, 2_000)).toBe(true);
    const out = await p;
    // Les en-têtes sont partis : un 504 n'est plus possible, le client voit
    // une coupure (réponse incomplète), jamais une attente sans fin.
    expect(out.status).toBe(200);
    expect(out.body).toBe('partial');
    expect(out.complete).toBe(false);
  });

  it('répond 504 « Upstream timeout » quand une lecture bufferisée reste sans fin de corps', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = call('/reader/api/0/stream/contents/stall');
    await upstreamHit('/reader/api/0/stream/contents/stall');
    await realDelay(50);           // laisser les en-têtes amont arriver au proxy

    await vi.advanceTimersByTimeAsync(PROXY_TOTAL_TIMEOUT_MS);
    expect(await settledWithin(p, 2_000)).toBe(true);
    const out = await p;
    expect(out.status).toBe(504);
    expect(JSON.parse(out.body)).toEqual({ error: 'Upstream timeout' });
  });

  it('borne une chaîne de redirections lentes, tous sauts compris → 504', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = call('/hop/0');
    for (let hop = 0; hop < 3; hop++) {
      await upstreamHit(`/hop/${hop}`);
      if (hop < 2) await vi.advanceTimersByTimeAsync(HOP_DELAY_MS);
    }
    // 2 sauts de 20 s écoulés, le 3e en cours : l'échéance tombe à 60 s.
    await vi.advanceTimersByTimeAsync(PROXY_TOTAL_TIMEOUT_MS - 2 * HOP_DELAY_MS);
    expect(await settledWithin(p, 2_000)).toBe(true);
    const out = await p;
    expect(out.status).toBe(504);
    expect(JSON.parse(out.body)).toEqual({ error: 'Upstream timeout' });
  });

  it('répond 504 quand l’amont ne répond pas du tout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = call('/silent');
    await upstreamHit('/silent');

    await vi.advanceTimersByTimeAsync(PROXY_TOTAL_TIMEOUT_MS);
    expect(await settledWithin(p, 2_000)).toBe(true);
    const out = await p;
    expect(out.status).toBe(504);
    expect(JSON.parse(out.body)).toEqual({ error: 'Upstream timeout' });
  });

  it('libère l’amont quand le client s’en va avant la réponse', async () => {
    const upstreamClosed = new Promise<void>((resolve) => {
      upstream.once('request', (req: http.IncomingMessage) => req.socket.once('close', () => resolve()));
    });
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'GET',
      headers: { 'X-Proxy-Target': `${upBase}/silent` },
    });
    req.on('error', () => {});
    req.end();
    await upstreamHit('/silent');
    req.destroy();
    // Sans libération, la connexion amont resterait ouverte jusqu'au délai par saut (30 s).
    expect(await settledWithin(upstreamClosed, 2_000)).toBe(true);
  });

  // Une écriture (edit-tag, tout marquer lu) que FreshRSS traite encore ne
  // doit pas être annulée parce que le navigateur est parti : une PWA iOS
  // passée en arrière-plan, une bascule wifi → réseau mobile coupent la
  // connexion juste après le geste. L'échéance totale borne déjà ce cas.
  it('mène une écriture à terme même quand le client s’en va', async () => {
    writeSeen.body = ''; writeSeen.closedEarly = false; writeSeen.answered = false;
    const received = new Promise<void>((resolve) => hitWaiters.push({ path: 'write-received', resolve }));
    const req = http.request({
      host: '127.0.0.1', port: frontPort, path: '/api/proxy', method: 'POST',
      headers: { 'X-Proxy-Target': `${upBase}/write`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    req.on('error', () => {});
    req.end('a=user/-/state/com.google/read&i=42');
    await received;
    req.destroy();
    await realDelay(300);          // laisser la fermeture se propager jusqu'au proxy
    expect(writeSeen.closedEarly).toBe(false);
    releaseWrite();
    await realDelay(50);
    expect(writeSeen.body).toBe('a=user/-/state/com.google/read&i=42');
    expect(writeSeen.closedEarly).toBe(false);
    expect(writeSeen.answered).toBe(true);
  });

  it('laisse passer une réponse normale, entière', async () => {
    const out = await call('/ok');
    expect(out.status).toBe(200);
    expect(out.body).toBe('fine');
    expect(out.complete).toBe(true);
  });
});
