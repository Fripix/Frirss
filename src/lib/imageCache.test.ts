// @vitest-environment jsdom
// jsdom is needed because this module now reaches the API client (for the
// backend proxy), which pulls in a store that reads localStorage at load.
import { describe, it, expect, vi } from 'vitest';
import { cacheImages, cachedImageStats, PREPARED_BYTES_HEADER } from './imageCache';

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
    expect(res).toEqual({ stored: 0, bytes: 0, failed: 0 });
    expect(openCache).not.toHaveBeenCalled();
  });
});

/** Une entrée de cache : une image d'un autre site gardée à l'affichage est
 *  opaque (taille illisible) ; une image préparée passe par le proxy. */
const entry = (type: string, bytes: number, header?: number) => ({
  type,
  headers: new Headers(header === undefined ? {} : { [PREPARED_BYTES_HEADER]: String(header) }),
  blob: vi.fn(async () => ({ size: type === 'opaque' ? 0 : bytes })),
});

function statsCache(entries: Record<string, ReturnType<typeof entry>>) {
  return {
    keys: async () => Object.keys(entries).map((url) => ({ url })),
    match: async (req: { url: string }) => entries[req.url],
  };
}

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
    expect(await cachedImageStats(async () => cache as never, ORIGIN))
      .toEqual({ total: 5, prepared: 2, preparedBytes: 3500, browsing: 3 });
  });

  it('lit la taille dans le corps quand une entrée ancienne n’a pas l’en-tête', async () => {
    const old = entry('default', 4200);
    const cache = statsCache({ 'https://a.example/1.jpg': old });
    expect(await cachedImageStats(async () => cache as never, ORIGIN))
      .toEqual({ total: 1, prepared: 1, preparedBytes: 4200, browsing: 0 });
    expect(old.blob).toHaveBeenCalled();
  });

  it('ne lit pas le corps quand l’en-tête donne la taille', async () => {
    const tagged = entry('default', 9999, 10);
    await cachedImageStats(async () => statsCache({ 'https://a.example/1.jpg': tagged }) as never, ORIGIN);
    expect(tagged.blob).not.toHaveBeenCalled();
  });

  // Une image de la même origine (servie par FriRSS) se lit sans être
  // préparée : la compter comme préparée gonflerait le chiffre.
  it('ne compte pas comme préparée une image lisible de la même origine', async () => {
    const cache = statsCache({ [`${ORIGIN}/api/proxy/x.png`]: entry('basic', 300) });
    expect(await cachedImageStats(async () => cache as never, ORIGIN))
      .toEqual({ total: 1, prepared: 0, preparedBytes: 0, browsing: 1 });
  });

  it('rend des zéros quand le cache est indisponible', async () => {
    expect(await cachedImageStats(async () => { throw new Error('none'); }, ORIGIN))
      .toEqual({ total: 0, prepared: 0, preparedBytes: 0, browsing: 0 });
  });
});
