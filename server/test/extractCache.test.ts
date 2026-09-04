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
//
// La fonction est hissée pour être pilotable test par test : c'est elle qui
// permet de fabriquer un hôte au nom POINTÉ pointant vers une IP privée — le
// cas qu'aucun contrôle littéral ne sait voir.
const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn() }));

vi.mock('dns', () => {
  const promises = { lookup: dnsLookup };
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
    // Par défaut, tout hôte résout vers une adresse publique.
    dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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

  // ── Le refus de cible passe AVANT la lecture du cache ──────────────
  // La clé d'extraction est globale à l'instance : une entrée écrite du temps
  // où un hôte interne était autorisé (`PROXY_INTERNAL_HOSTS`,
  // `PROXY_REWRITES`) survit à son retrait pendant tout `CACHE_TTL`. Quand le
  // cache était lu en premier, elle repartait en 200 vers n'importe quel compte
  // de l'instance, sans refus et sans ligne de journal.
  //
  // Les deux formes d'hôte interne sont vérifiées, parce qu'elles ne sont PAS
  // attrapées par le même mécanisme : l'IP littérale tombe sur le contrôle
  // syntaxique, le nom pointé n'est classé que par la résolution DNS. Une
  // version n'attendant que le contrôle littéral servait le cache au second.
  //
  // Chaque cas fait donc répondre au doublon DNS l'adresse qui laisse SON
  // mécanisme juger seul : une adresse PUBLIQUE pour l'IP littérale, sans quoi
  // la résolution refusait à la place du contrôle syntaxique et le cas restait
  // vert même en supprimant ce dernier de `assertTargetSafe`.
  const refusals: [string, string, string][] = [
    ['une IP privée littérale', 'http://10.0.0.5/a', '93.184.216.34'],
    // `PROXY_INTERNAL_HOSTS=nas.example.com`, ou une réécriture vers
    // `http://nas.lan:8080` : un hôte interne au nom POINTÉ est invisible pour
    // `isInternalHostLiteral` — d'où le doublon DNS ci-dessus, qui est ici le
    // seul juge.
    ['un nom POINTÉ résolvant en privé', 'http://nas.example.com/secret', '10.0.0.9'],
  ];
  for (const [label, target, address] of refusals) {
    it(`refuse ${label} sans consulter le cache, même s'il a une entrée`, async () => {
      dnsLookup.mockResolvedValue([{ address, family: 4 }]);
      cacheGet.mockResolvedValue(JSON.stringify({ title: 'contenu interne', content: '<p>fuite</p>' }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await request(app).get('/api/extract').query({ url: target });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Target host not allowed' });
      expect(cacheGet).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      // Un balayage SSRF doit laisser une trace côté serveur — et une trace qui
      // NOMME la cible : « il y a eu un avertissement » ne se relit pas.
      expect(warn).toHaveBeenCalledWith('Extract error:', 'blocked target →', target);
      warn.mockRestore();
    });
  }

  // ── Résolveur muet : une panne de disponibilité, pas un refus ──────
  // La garde complète est passée devant le cache, et `assertTargetSafe` refuse
  // aussi bien un hôte qui résout en privé qu'un hôte qui ne résout PAS. Au
  // poste pré-cache, confondre les deux transformait le moindre hoquet du
  // résolveur en 403 sur toutes les extractions — y compris celles que Redis
  // pouvait rendre sans toucher au réseau, et avec un message accusant la
  // cible d'un défaut qui n'était pas le sien.
  it("sert quand même le cache quand la résolution ne répond pas", async () => {
    dnsLookup.mockRejectedValue(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));
    const cached = JSON.stringify({ title: 'Depuis le cache', content: '<p>déjà extrait</p>' });
    cacheGet.mockResolvedValue(cached);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).get('/api/extract').query({ url: URL_A });

    expect(res.status).toBe(200);
    expect(res.headers['x-from-cache']).toBe('1');
    expect(cacheGet).toHaveBeenCalledWith(extractKey(URL_A));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Le pendant du test ci-dessus, et la moitié qui compte pour la sécurité :
  // sans entrée en cache, il n'y a plus rien à servir — et un hôte qu'on ne
  // sait pas situer ne doit pas être joint pour autant. `fetchUpstream` rejoue
  // la garde et refuse avant le moindre appel sortant.
  it("refuse malgré tout de sortir vers un hôte qui ne résout pas", async () => {
    dnsLookup.mockRejectedValue(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));
    cacheGet.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app).get('/api/extract').query({ url: URL_A });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Target host not allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
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
