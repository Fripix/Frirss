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

const okFetch = vi.fn(async () => ({ type: 'opaque', status: 0 }));

describe('cacheImages', () => {
  it('stores every image in the cache, not just fetches it', async () => {
    const cache = fakeCache();
    const fetchFn = vi.fn(async () => ({ type: 'opaque' }));
    const stored = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchFn: fetchFn as never,
      openCache: async () => cache as never,
    });
    expect(stored).toBe(2);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect([...cache.store.keys()]).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });

  it('fetches with no-cors so cross-origin images can be stored', async () => {
    const cache = fakeCache();
    const fetchFn = vi.fn(async () => ({ type: 'opaque' }));
    await cacheImages(['https://a/1.jpg'], { fetchFn: fetchFn as never, openCache: async () => cache as never });
    expect(fetchFn).toHaveBeenCalledWith('https://a/1.jpg', expect.objectContaining({ mode: 'no-cors' }));
  });

  it('skips images already in the cache', async () => {
    const cache = fakeCache(['https://a/1.jpg']);
    const fetchFn = vi.fn(async () => ({ type: 'opaque' }));
    const stored = await cacheImages(['https://a/1.jpg', 'https://a/2.jpg'], {
      fetchFn: fetchFn as never,
      openCache: async () => cache as never,
    });
    expect(stored).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://a/2.jpg', expect.anything());
  });

  it('keeps going when one image fails', async () => {
    const cache = fakeCache();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('bad')) throw new Error('network');
      return { type: 'opaque' };
    });
    const stored = await cacheImages(['https://a/bad.jpg', 'https://a/good.jpg'], {
      fetchFn: fetchFn as never,
      openCache: async () => cache as never,
    });
    expect(stored).toBe(1);
    expect([...cache.store.keys()]).toEqual(['https://a/good.jpg']);
  });

  it('returns 0 when the cache cannot be opened', async () => {
    const stored = await cacheImages(['https://a/1.jpg'], {
      fetchFn: okFetch as never,
      openCache: async () => { throw new Error('no CacheStorage'); },
    });
    expect(stored).toBe(0);
  });

  it('does nothing for an empty list', async () => {
    const openCache = vi.fn();
    expect(await cacheImages([], { fetchFn: okFetch as never, openCache: openCache as never })).toBe(0);
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
