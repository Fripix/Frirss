// @vitest-environment jsdom
// jsdom is needed because this module now reaches the API client (for the
// backend proxy), which pulls in a store that reads localStorage at load.
import { describe, it, expect, vi } from 'vitest';
import { cacheImages, cachedImageStats, pruneImages, PREPARED_BYTES_HEADER, PREPARED_SCOPE_HEADER } from './imageCache';

/** Minimal stand-in for the Cache API, recording what gets stored. */
function fakeCache(preloaded: string[] = []) {
  const store = new Map<string, unknown>(preloaded.map((u) => [u, { opaque: true }]));
  return {
    store,
    match: vi.fn(async (url: string) => store.get(url)),
    put: vi.fn(async (url: string, res: unknown) => { store.set(url, res); }),
  };
}

const image = (bytes = 1000) => async () => ({ response: { body: 'x' } as never, bytes });

describe('cacheImages', () => {
  // Disque plein : chaque image suivante échouerait aussi, après avoir été
  // téléchargée pour rien. Et un appareil plein pousse le navigateur à effacer
  // TOUT le stockage du site (vu sur Android) : on s'arrête à la première.
  it('s’arrête à la première erreur « espace plein » et le signale', async () => {
    const cache = fakeCache();
    cache.put.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const fetchImage = vi.fn(image());
    const urls = Array.from({ length: 9 }, (_, i) => `https://a/${i}.jpg`);
    const res = await cacheImages(urls, { fetchImage, openCache: async () => cache as never });
    expect(res.full).toBe(true);
    expect(res.stored).toBe(0);
    expect(fetchImage.mock.calls.length).toBeLessThanOrEqual(4); // le premier lot, pas les suivants
  });

  // Après le refus, les images DÉJÀ préparées des lots suivants restent
  // gardées : le retrait final les ôtait (elles manquaient à `kept`).
  it('après un refus de quota, garde ce qui était déjà préparé, sans rien télécharger', async () => {
    const cache = fakeCache(['https://a/5.jpg', 'https://a/6.jpg']);
    cache.put.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const fetchImage = vi.fn(image());
    const urls = Array.from({ length: 7 }, (_, i) => `https://a/${i}.jpg`);
    const res = await cacheImages(urls, { fetchImage, openCache: async () => cache as never });
    expect(res.full).toBe(true);
    expect([...res.kept].sort()).toEqual(['https://a/5.jpg', 'https://a/6.jpg']);
    expect(fetchImage.mock.calls.length).toBeLessThanOrEqual(4);
    // Seules les images tentées comptent en échec : celles qu'on n'a pas
    // tentées faute de place ne sont pas « refusées par le site ».
    expect(res.failed).toBe(fetchImage.mock.calls.length);
  });

  it('un refus de quota en reprenant une ancienne image arrête aussi les téléchargements', async () => {
    const cache = fakeCache();
    cache.put.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const legacy = { type: 'default', headers: new Headers({ [PREPARED_BYTES_HEADER]: '100' }), clone() { return this; } };
    const browsing = { match: vi.fn(async (u: string) => (u.includes('/old') ? legacy : undefined)), delete: vi.fn() };
    const fetchImage = vi.fn(image());
    // Un premier lot fait d'anciennes images, puis des neuves : le refus en
    // reprenant les anciennes doit suffire à ne rien télécharger ensuite.
    const res = await cacheImages(['old1', 'old2', 'old3', 'old4', 'n1', 'n2', 'n3', 'n4'].map((n) => `https://a/${n}.jpg`), {
      fetchImage, openCache: async () => cache as never, openBrowsingCache: async () => browsing as never,
    });
    expect(res.full).toBe(true);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('donne la taille de chaque image gardée', async () => {
    const cache = fakeCache(['https://a/old.jpg']);
    const res = await cacheImages(['https://a/old.jpg', 'https://a/new.jpg'], { fetchImage: image(700), openCache: async () => cache as never });
    expect(res.sizes['https://a/new.jpg']).toBe(700);
    expect(res.sizes).toHaveProperty(['https://a/old.jpg']);
  });

  it('sans téléchargement (`noFetch`), ne fait que retrouver ce qui est préparé', async () => {
    const cache = fakeCache(['https://a/1.jpg']);
    // Une ancienne image du cache d'affichage : la reprendre demanderait une
    // écriture, que l'appareil plein refuserait — elle n'est pas reprise.
    const legacy = { type: 'default', headers: new Headers({ [PREPARED_BYTES_HEADER]: '100' }), clone() { return this; } };
    const browsing = { match: vi.fn(async () => legacy), delete: vi.fn() };
    const fetchImage = vi.fn(image());
    const res = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchImage, openCache: async () => cache as never, openBrowsingCache: async () => browsing as never, noFetch: true,
    });
    expect(fetchImage).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(res.kept).toEqual(['https://a/1.jpg']);
    expect(res.stored).toBe(0);
    expect(res.failed).toBe(0);
  });

  it('ne signale pas « plein » pour une autre erreur d’écriture', async () => {
    const cache = fakeCache();
    cache.put.mockRejectedValue(new TypeError('bad body'));
    const res = await cacheImages(['https://a/1.jpg'], { fetchImage: image(), openCache: async () => cache as never });
    expect(res.full).toBeFalsy();
  });

  it('stores every image in the cache, not just fetches it', async () => {
    const cache = fakeCache();
    const { stored } = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchImage: image(),
      openCache: async () => cache as never,
    });
    expect(stored).toBe(2);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect([...cache.store.keys()]).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });

  it('keys the entry by the original url, whatever fetched it', async () => {
    // The bytes come through the proxy, but an <img> asks for the original URL
    // offline — that is the key the cache must answer to.
    const cache = fakeCache();
    await cacheImages(['https://cdn.example/photo.jpg'], {
      fetchImage: image(),
      openCache: async () => cache as never,
    });
    expect(cache.put).toHaveBeenCalledWith('https://cdn.example/photo.jpg', expect.anything());
  });

  it('reports the real number of bytes stored', async () => {
    const cache = fakeCache();
    const { bytes } = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchImage: image(1500),
      openCache: async () => cache as never,
    });
    expect(bytes).toBe(3000);
  });

  it('skips images already in the cache', async () => {
    const cache = fakeCache(['https://a/1.jpg']);
    const fetchImage = vi.fn(image());
    const { stored } = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchImage: fetchImage as never,
      openCache: async () => cache as never,
    });
    expect(stored).toBe(1);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fetchImage).toHaveBeenCalledWith('https://a/2.jpg');
  });

  it('keeps going when one image fails', async () => {
    const cache = fakeCache();
    const fetchImage = async (url: string) => {
      if (url.includes('bad')) throw new Error('network');
      return { response: {} as never, bytes: 10 };
    };
    const { stored } = await cacheImages(['https://a/bad.jpg', 'https://a/good.jpg'], {
      fetchImage, openCache: async () => cache as never,
    });
    expect(stored).toBe(1);
    expect([...cache.store.keys()]).toEqual(['https://a/good.jpg']);
  });

  it('returns 0 when the cache cannot be opened, and says why', async () => {
    const { stored, error } = await cacheImages(['https://a/1.jpg'], {
      fetchImage: image(),
      openCache: async () => { throw new Error('no CacheStorage'); },
    });
    expect(stored).toBe(0);
    expect(error).toContain('open');
  });

  it('reports why storing failed instead of swallowing it', async () => {
    const cache = fakeCache();
    const rejecting = { ...cache, put: async () => { throw new TypeError('opaque not allowed'); } };
    const { stored, error } = await cacheImages(['https://a/1.jpg'], {
      fetchImage: image(), openCache: async () => rejecting as never,
    });
    expect(stored).toBe(0);
    expect(error).toContain('put');
    expect(error).toContain('opaque not allowed');
  });

  it('counts the images that failed, since a minority always does', async () => {
    const cache = fakeCache();
    const fetchImage = async (url: string) => {
      if (url.includes('bad')) throw new Error('403');
      return { response: {} as never, bytes: 10 };
    };
    const { stored, failed } = await cacheImages(
      ['https://a/bad1.jpg', 'https://a/bad2.jpg', 'https://a/good.jpg'],
      { fetchImage, openCache: async () => cache as never },
    );
    expect(stored).toBe(1);
    expect(failed).toBe(2);
  });

  it('reports a fetch failure distinctly from a put failure', async () => {
    const cache = fakeCache();
    const { error } = await cacheImages(['https://a/1.jpg'], {
      fetchImage: async () => { throw new TypeError('Load failed'); },
      openCache: async () => cache as never,
    });
    expect(error).toContain('fetch');
    expect(error).toContain('Load failed');
  });

  it('does nothing for an empty list', async () => {
    const openCache = vi.fn();
    const res = await cacheImages([], { fetchImage: image(), openCache: openCache as never });
    expect(res).toEqual({ stored: 0, bytes: 0, reusedBytes: 0, kept: [], sizes: {}, failed: 0 });
    expect(openCache).not.toHaveBeenCalled();
  });
});

/** Une entrée de cache : une image d'un autre site gardée à l'affichage est
 *  opaque (taille illisible) ; une image préparée passe par le proxy. */
const entry = (type: string, bytes: number, header?: number) => {
  const e = {
    type,
    headers: new Headers(header === undefined ? {} : { [PREPARED_BYTES_HEADER]: String(header) }),
    blob: vi.fn(async () => ({ size: type === 'opaque' ? 0 : bytes })),
    clone: () => e,
  };
  return e;
};

function statsCache(entries: Record<string, ReturnType<typeof entry>>) {
  return {
    keys: async () => Object.keys(entries).map((url) => ({ url })),
    match: async (req: { url: string } | string) => entries[typeof req === 'string' ? req : req.url],
    put: vi.fn(async (url: string, res: ReturnType<typeof entry>) => { entries[url] = res; }),
    delete: vi.fn(async (req: { url: string } | string) => {
      const url = typeof req === 'string' ? req : req.url;
      const had = url in entries;
      delete entries[url];
      return had;
    }),
    entries,
  };
}
const empty = async () => statsCache({}) as never;

describe('cachedImageStats', () => {
  const ORIGIN = 'https://frirss.example.com';

  // Le navigateur compte chaque image opaque plusieurs mégaoctets : sans
  // séparer les deux familles, « Espace utilisé » annonçait 12 Go pour
  // quelques centaines de Mo réels.
  it('sépare les images préparées, de taille connue, des images gardées à la lecture', async () => {
    const cache = statsCache({
      'https://a.example/1.jpg': entry('default', 0, 1000),
      'https://b.example/2.jpg': entry('default', 0, 2500),
      'https://c.example/3.jpg': entry('opaque', 0),
      'https://d.example/4.jpg': entry('opaque', 0),
      'https://e.example/5.jpg': entry('opaque', 0),
    });
    expect(await cachedImageStats(empty, async () => cache as never, ORIGIN))
      .toEqual({ total: 5, prepared: 2, preparedBytes: 3500, browsing: 3 });
  });

  it('lit la taille dans le corps quand une entrée ancienne n’a pas l’en-tête', async () => {
    const old = entry('default', 4200);
    const cache = statsCache({ 'https://a.example/1.jpg': old });
    expect(await cachedImageStats(empty, async () => cache as never, ORIGIN))
      .toEqual({ total: 1, prepared: 1, preparedBytes: 4200, browsing: 0 });
    expect(old.blob).toHaveBeenCalled();
  });

  it('ne lit pas le corps quand l’en-tête donne la taille', async () => {
    const tagged = entry('default', 9999, 10);
    await cachedImageStats(empty, async () => statsCache({ 'https://a.example/1.jpg': tagged }) as never, ORIGIN);
    expect(tagged.blob).not.toHaveBeenCalled();
  });

  // Une image de la même origine (servie par FriRSS) se lit sans être
  // préparée : la compter comme préparée gonflerait le chiffre.
  it('ne compte pas comme préparée une image lisible de la même origine', async () => {
    const cache = statsCache({ [`${ORIGIN}/api/proxy/x.png`]: entry('basic', 300) });
    expect(await cachedImageStats(empty, async () => cache as never, ORIGIN))
      .toEqual({ total: 1, prepared: 0, preparedBytes: 0, browsing: 1 });
  });

  it('rend des zéros quand le cache est indisponible', async () => {
    expect(await cachedImageStats(async () => { throw new Error('none'); }, async () => { throw new Error('none'); }, ORIGIN))
      .toEqual({ total: 0, prepared: 0, preparedBytes: 0, browsing: 0 });
  });

  // Depuis la séparation, les images préparées ont leur propre cache : tout
  // ce qu'il contient est préparé, même sans l'en-tête de taille.
  it('compte tout le cache des images préparées comme préparé', async () => {
    const prepared = statsCache({
      'https://a.example/1.jpg': entry('default', 0, 700),
      'https://b.example/2.jpg': entry('default', 300),
    });
    const browsing = statsCache({ 'https://c.example/3.jpg': entry('opaque', 0) });
    expect(await cachedImageStats(async () => prepared as never, async () => browsing as never, ORIGIN))
      .toEqual({ total: 3, prepared: 2, preparedBytes: 1000, browsing: 1 });
  });
});

/*
 * Images préparées et images gardées à l'affichage vivaient dans un même
 * cache. Le service worker plafonne le second (images vues en ligne) ; une
 * image préparée qui s'y trouvait entrait dans ce plafond dès son premier
 * affichage, et le vidage pour manque d'espace (`purgeOnQuotaError`)
 * emportait tout. Les préparées ont désormais leur cache, que seuls le budget
 * et « Vider les images » gouvernent.
 */
describe('cacheImages — cache des images préparées', () => {
  const tagged = (bytes: number) => entry('default', 0, bytes);

  it('compte une image déjà préparée dans le budget sans la retélécharger', async () => {
    const prepared = statsCache({ 'https://a/1.jpg': tagged(800) });
    const fetchImage = vi.fn(image(100));
    const res = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchImage: fetchImage as never,
      openCache: async () => prepared as never,
      openBrowsingCache: empty,
    });
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ stored: 1, bytes: 100, reusedBytes: 800 });
    expect(res.kept.sort()).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });

  it('mesure une ancienne image sans en-tête avant de la déplacer', async () => {
    const prepared = statsCache({});
    const body = vi.fn(async () => ({ size: 640 }));
    const legacy = { type: 'default', headers: new Headers(), blob: body, clone: () => ({ ...legacy, blob: body }) };
    const browsing = statsCache({ 'https://a/1.jpg': legacy as never });
    const res = await cacheImages(['https://a/1.jpg'], {
      fetchImage: image(),
      openCache: async () => prepared as never,
      openBrowsingCache: async () => browsing as never,
    });
    expect(res.reusedBytes).toBe(640);
  });

  it('déplace une image préparée par une version précédente au lieu de la retélécharger', async () => {
    const prepared = statsCache({});
    const old = tagged(500);
    const browsing = statsCache({ 'https://a/1.jpg': old });
    const fetchImage = vi.fn(image());
    const res = await cacheImages(['https://a/1.jpg'], {
      fetchImage: fetchImage as never,
      openCache: async () => prepared as never,
      openBrowsingCache: async () => browsing as never,
    });
    expect(fetchImage).not.toHaveBeenCalled();
    expect(prepared.entries['https://a/1.jpg']).toBe(old);
    expect(browsing.entries['https://a/1.jpg']).toBeUndefined();
    expect(res).toMatchObject({ stored: 0, reusedBytes: 500, kept: ['https://a/1.jpg'] });
  });

  // Une image gardée à l'affichage est opaque : sa taille est illisible et le
  // plafond l'évincera. La préparer, c'est en prendre une copie lisible.
  it('ne se contente pas d’une image opaque gardée à l’affichage', async () => {
    const prepared = statsCache({});
    const browsing = statsCache({ 'https://a/1.jpg': entry('opaque', 0) });
    const fetchImage = vi.fn(image(250));
    const res = await cacheImages(['https://a/1.jpg'], {
      fetchImage: fetchImage as never,
      openCache: async () => prepared as never,
      openBrowsingCache: async () => browsing as never,
    });
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ stored: 1, bytes: 250, kept: ['https://a/1.jpg'] });
  });

  it('écrit la taille réelle dans l’en-tête de l’image préparée', async () => {
    const prepared = statsCache({});
    await cacheImages(['https://a/1.jpg'], {
      fetchImage: async () => ({ response: new Response('abcd'), bytes: 4 }),
      openCache: async () => prepared as never,
      openBrowsingCache: empty,
    });
    const stored = prepared.entries['https://a/1.jpg'] as unknown as Response;
    expect(stored.headers.get(PREPARED_BYTES_HEADER)).toBe('4');
  });
});

describe('pruneImages', () => {
  // Sans éviction automatique, le cache des préparées grossirait à chaque
  // préparation : ce qu'elle n'a pas gardé (article sorti des 30 jours,
  // au-delà du budget) est retiré.
  it('retire les images que la dernière préparation n’a pas gardées', async () => {
    const prepared = statsCache({
      'https://a/1.jpg': entry('default', 1),
      'https://a/2.jpg': entry('default', 1),
      'https://a/3.jpg': entry('default', 1),
    });
    const removed = await pruneImages(new Set(['https://a/2.jpg']), async () => prepared as never);
    expect(removed).toBe(2);
    expect(Object.keys(prepared.entries)).toEqual(['https://a/2.jpg']);
  });

  it('ne fait rien quand le cache est indisponible', async () => {
    expect(await pruneImages(new Set(), async () => { throw new Error('none'); })).toBe(0);
  });

  // Un navigateur, deux serveurs : préparer le serveur 2 retirait toutes les
  // images préparées du serveur 1, qu'il ne connaît pas.
  it('ne retire que les images de sa propre portée (et les anciennes, sans portée)', async () => {
    const tag = (scope: string) => { const e = entry('default', 1); e.headers.set(PREPARED_SCOPE_HEADER, scope); return e; };
    const prepared = statsCache({
      'https://a/s1.jpg': tag('u@1'),
      'https://a/s2-old.jpg': tag('u@2'),
      'https://a/legacy.jpg': entry('default', 1),
    });
    const removed = await pruneImages(new Set(), async () => prepared as never, 'u@2');
    expect(removed).toBe(2);
    expect(Object.keys(prepared.entries)).toEqual(['https://a/s1.jpg']);
  });

  it('étiquette chaque image préparée de sa portée', async () => {
    const cache = fakeCache();
    await cacheImages(['https://a/1.jpg'], { fetchImage: image(), openCache: async () => cache as never, scope: 'u@1' });
    const stored = cache.store.get('https://a/1.jpg') as Response;
    expect(stored.headers.get(PREPARED_SCOPE_HEADER)).toBe('u@1');
  });

  // Le cache rend ses clés normalisées (`Request.url`), la préparation garde
  // l'URL telle que l'article l'écrit : un accent, une espace, un hôte en
  // majuscules et l'image, stockée, était retirée à chaque fin de préparation.
  it('compare les URL sous leur forme normalisée', async () => {
    const prepared = statsCache({
      'https://cdn.example.com/caf%C3%A9%20noir.jpg': entry('default', 1),
      'https://cdn.example.com/old.jpg': entry('default', 1),
    });
    await pruneImages(new Set(['https://CDN.example.com:443/café noir.jpg']), async () => prepared as never);
    expect(Object.keys(prepared.entries)).toEqual(['https://cdn.example.com/caf%C3%A9%20noir.jpg']);
  });
});

/*
 * Une image peut être voulue par plusieurs portées (un logo, un avatar commun
 * à deux serveurs ; deux comptes sur le même FreshRSS). L'étiquette était
 * celle de la première, jamais mise à jour : son balayage effaçait une image
 * que l'autre gardait, et l'autre ne pouvait jamais l'enlever. Les images
 * sans étiquette (préparées avant 1.8.0) ne recevaient la leur que
 * retéléchargées : chaque serveur effaçait celles de l'autre.
 */
describe('portées d’une image préparée', () => {
  const tagged = (...scopes: string[]) => {
    const e = entry('default', 10, 10);
    if (scopes.length) e.headers.set(PREPARED_SCOPE_HEADER, scopes.join(','));
    return e;
  };
  const scopes = (c: ReturnType<typeof statsCache>, url: string) =>
    (c.entries[url]?.headers.get(PREPARED_SCOPE_HEADER) ?? '').split(',').filter(Boolean).map(decodeURIComponent);
  const URL1 = 'https://cdn.example/logo.png';

  it('une image déjà préparée par A, gardée par B, porte les deux portées', async () => {
    const c = statsCache({ [URL1]: tagged('1@1') });
    const res = await cacheImages([URL1], { fetchImage: image(), openCache: async () => c as never, openBrowsingCache: empty, scope: '2@2' });
    expect(res.kept).toEqual([URL1]);
    expect(scopes(c, URL1).sort()).toEqual(['1@1', '2@2']);
  });

  it('n’est effacée que quand plus aucune portée ne la garde', async () => {
    const c = statsCache({ [URL1]: tagged('1@1', encodeURIComponent('2@2')) });
    expect(await pruneImages(new Set(), async () => c as never, '1@1')).toBe(0);
    expect(scopes(c, URL1), 'B la garde encore').toEqual(['2@2']);
    expect(await pruneImages(new Set(), async () => c as never, '2@2')).toBe(1);
    expect(c.entries[URL1]).toBeUndefined();
  });

  it('une image sans étiquette, reprise par une préparation, reçoit la portée qui la reprend', async () => {
    const c = statsCache({ [URL1]: tagged() });
    await cacheImages([URL1], { fetchImage: image(), openCache: async () => c as never, openBrowsingCache: empty, scope: '7@1' });
    expect(scopes(c, URL1)).toEqual(['7@1']);
    // Le serveur 2 balaye ensuite : elle est au serveur 1, il n'y touche pas.
    await pruneImages(new Set(), async () => c as never, '7@2');
    expect(c.entries[URL1]).toBeDefined();
  });

  it('une image reprise du cache d’affichage est rangée avec sa portée', async () => {
    const c = statsCache({});
    const browsing = statsCache({ [URL1]: entry('default', 0, 10) });
    await cacheImages([URL1], { fetchImage: image(), openCache: async () => c as never, openBrowsingCache: async () => browsing as never, scope: '7@1' });
    expect(scopes(c, URL1)).toEqual(['7@1']);
    expect(c.entries[URL1]?.headers.get(PREPARED_BYTES_HEADER)).toBe('10');
  });

  it('garde le contenu de l’image quand il réécrit son étiquette', async () => {
    const real = new Response('octets', { headers: { [PREPARED_BYTES_HEADER]: '6', [PREPARED_SCOPE_HEADER]: '1@1' } });
    const store = new Map<string, Response>([[URL1, real]]);
    const c = {
      keys: async () => [...store.keys()].map((url) => ({ url })),
      match: async (r: string | { url: string }) => store.get(typeof r === 'string' ? r : r.url),
      put: async (u: string, res: Response) => { store.set(u, res); },
      delete: async (r: { url: string }) => store.delete(r.url),
    };
    await cacheImages([URL1], { fetchImage: image(), openCache: async () => c as never, openBrowsingCache: empty, scope: '2@2' });
    expect(await store.get(URL1)!.clone().text()).toBe('octets');
    await pruneImages(new Set(), async () => c as never, '2@2');
    expect(await store.get(URL1)!.text()).toBe('octets');
    expect(store.get(URL1)!.headers.get(PREPARED_SCOPE_HEADER)).toBe('1%401');
  });
});
