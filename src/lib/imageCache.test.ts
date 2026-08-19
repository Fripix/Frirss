// @vitest-environment jsdom
// jsdom is needed because this module now reaches the API client (for the
// backend proxy), which pulls in a store that reads localStorage at load.
import { describe, it, expect, vi } from 'vitest';
import { cacheImages, countCachedImages } from './imageCache';

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
    expect(res).toEqual({ stored: 0, bytes: 0 });
    expect(openCache).not.toHaveBeenCalled();
  });
});

describe('countCachedImages', () => {
  it('reports how many images are stored', async () => {
    const cache = fakeCache(['https://a/1.jpg', 'https://a/2.jpg']);
    const withKeys = { ...cache, keys: async () => [...cache.store.keys()] };
    expect(await countCachedImages(async () => withKeys as never)).toBe(2);
  });

  it('reports 0 when the cache is unavailable', async () => {
    expect(await countCachedImages(async () => { throw new Error('none'); })).toBe(0);
  });
});
