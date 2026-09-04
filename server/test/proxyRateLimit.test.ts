import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Express, Request, Response, NextFunction } from 'express';

// ── UN seul seau de cadence pour `/api/proxy` et `/api/extract` ───────
// `rateLimit()` s'alloue un `MemoryStore` NEUF à chaque appel : deux appels de
// même configuration donnent deux compteurs indépendants sur le même
// identifiant d'utilisateur — donc le double du plafond annoncé, et une
// protection contournable en changeant d'URL. `/api/extract` doit donc
// réutiliser l'INSTANCE exportée par `server/routes/proxy.ts`.
//
// La version précédente de ce garde-fou lisait le TEXTE de `extract.ts` :
// absence de `rateLimit(`, présence de `router.use(proxyRateLimiter)`. Elle
// restait verte quand on commentait la ligne `router.use(...)` — `toMatch` ne
// distingue pas le code vivant d'un commentaire — et un import renommé
// (`import { rateLimit as limiter }`) passait aussi sa moitié négative.
//
// Il n'a jamais fallu 600 requêtes pour faire mieux : il suffit d'abaisser le
// plafond. Ce qui impose un fichier à part, où l'environnement est fixé AVANT
// le chargement des modules (le plafond est lu une fois, à l'import).
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

/** Monte les deux routeurs sortants sur une même app, avec le plafond voulu. */
async function buildApp(cap: string): Promise<{ app: Express; limiter: unknown }> {
  vi.resetModules();
  vi.stubEnv('FRIRSS_PROXY_RATE_LIMIT', cap);
  const proxy = await import('../routes/proxy.js');
  const extract = (await import('../routes/extract.js')).default;
  const app = express();
  app.use('/api/proxy', proxy.default);
  app.use('/api/extract', extract);
  return { app, limiter: proxy.proxyRateLimiter };
}

// Une requête qui ne sort jamais : le compteur de cadence s'incrémente avant
// le gestionnaire, donc un 400 consomme le budget comme un appel réel — et le
// test n'a besoin ni de réseau ni de double de `fetch`.
const hitProxy = (app: Express) => request(app).get('/api/proxy');
const hitExtract = (app: Express) => request(app).get('/api/extract').query({ url: '' });

describe('cadence sortante — un seau partagé', () => {
  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("compte `/api/extract` dans le seau déjà entamé par `/api/proxy`", async () => {
    const { app } = await buildApp('2');

    expect((await hitProxy(app)).status).toBe(400);
    expect((await hitProxy(app)).status).toBe(400);

    // Troisième requête sortante du même compte, sur l'AUTRE route : avec deux
    // seaux, elle passerait (400) ; avec un seul, elle est refusée.
    const res = await hitExtract(app);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too many proxied requests, please slow down' });
  });

  // Caractérisation du chemin « opérateur qui sait ce qu'il fait » : à 0, aucun
  // middleware n'est monté (ni sur l'une ni sur l'autre route) et rien ne
  // casse. `proxyRateLimiter` vaut `null`, et `router.use(null)` ferait planter
  // Express au chargement — c'est la garde `if (proxyRateLimiter)` qui l'évite.
  it('laisse tout passer quand le plafond est 0', async () => {
    const { app, limiter } = await buildApp('0');
    expect(limiter).toBeNull();

    for (let i = 0; i < 5; i++) expect((await hitProxy(app)).status).toBe(400);
    expect((await hitExtract(app)).status).toBe(400);
  });
});
