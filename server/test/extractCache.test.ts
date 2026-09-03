import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── Le cache d'extraction, dans un fichier à lui ─────────────────────
// `cacheEnabled` vaut `false` dans l'environnement de test (pas de
// `REDIS_URL`), donc la lecture et l'écriture du cache — la raison d'être de
// `/api/extract` — ne s'exécutaient dans AUCUN test : un `cacheGet` mal placé
// ou un `cacheSet` oublié serait passé au vert.
//
// Le module `../cache.js` est donc remplacé ici, ce qui ne peut pas se faire
// dans `api.test.ts` sans désarmer les tests de cache du proxy qui, eux,
// veulent le vrai module désactivé. `importActual` garde `extractKey` réel :
// c'est la clé sans identifiant d'utilisateur qu'on veut voir passer, pas une
// fausse.
const { cacheGet, cacheSet } = vi.hoisted(() => ({ cacheGet: vi.fn(), cacheSet: vi.fn() }));

vi.mock('../cache.js', async () => {
  const actual = await vi.importActual<typeof import('../cache.js')>('../cache.js');
  return { ...actual, cacheEnabled: true, cacheGet, cacheSet };
});

// L'authentification n'est pas le sujet ici (elle l'est dans `api.test.ts`) :
// un utilisateur fixe évite de dépendre de l'ordre d'exécution des fichiers
// pour obtenir un JWT sur la base temporaire partagée.
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// `assertTargetSafe` résout l'hôte : sans ce doublon, `news.example.com` ne
// résout pas et tout finirait en 403 avant d'atteindre le cache.
vi.mock('dns', () => {
  const promises = { lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])) };
  const lookup = vi.fn();
  return { default: { lookup, promises }, lookup, promises };
});

const { extractKey } = await import('../cache.js');
const extractRoutes = (await import('../routes/extract.js')).default;

const app = express();
app.use('/api/extract', extractRoutes);

const URL_A = 'https://news.example.com/a';

const ARTICLE = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

const htmlStream = (html: string) => new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(new TextEncoder().encode(html)); c.close(); },
});

describe('extract — cache', () => {
  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sert le cache tel quel, sans appeler l'amont", async () => {
    const cached = JSON.stringify({ title: 'Depuis le cache', content: '<p>déjà extrait</p>' });
    cacheGet.mockResolvedValue(cached);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/extract').query({ url: URL_A });

    expect(res.status).toBe(200);
    expect(res.headers['x-from-cache']).toBe('1');
    expect(res.body).toEqual({ title: 'Depuis le cache', content: '<p>déjà extrait</p>' });
    // Le point entier de la fonctionnalité : la page n'est pas retéléchargée.
    expect(fetchMock).not.toHaveBeenCalled();
    // Et la clé consultée ne porte aucun identifiant d'utilisateur.
    expect(cacheGet).toHaveBeenCalledWith(extractKey(URL_A));
  });

  it("extrait puis écrit dans le cache quand la clé est absente", async () => {
    cacheGet.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body: htmlStream(ARTICLE),
    }));

    const res = await request(app).get('/api/extract').query({ url: URL_A });

    expect(res.status).toBe(200);
    expect(res.headers['x-from-cache']).toBeUndefined();
    expect(res.body.title).toBe('Titre de la page');
    expect(cacheSet).toHaveBeenCalledTimes(1);
    const [key, body] = cacheSet.mock.calls[0] as [string, string];
    expect(key).toBe(extractKey(URL_A));
    // Ce qui est stocké est exactement ce qui a été renvoyé : un cache qui
    // garde autre chose servirait autre chose au coup suivant.
    expect(JSON.parse(body)).toEqual(res.body);
  });

  it("n'écrit rien dans le cache quand la page n'est pas extractible", async () => {
    cacheGet.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: htmlStream('<html><body></body></html>'),
    }));

    const res = await request(app).get('/api/extract').query({ url: 'https://news.example.com/vide' });

    expect(res.status).toBe(422);
    expect(cacheSet).not.toHaveBeenCalled();
  });
});
