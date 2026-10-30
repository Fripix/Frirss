import { describe, it, expect, vi, afterEach } from 'vitest';

/*
 * `PROXY_REWRITES` : quand le chemin interne échoue (conteneur FreshRSS qui
 * redémarre), `fetchUpstream` retente l'URL publique. Pour la relève, l'URL
 * porte le jeton maître : il finissait dans le journal du reverse proxy
 * public, ce que la réécriture existait justement pour éviter. Un appel qui
 * met un secret dans l'URL refuse ce repli (`publicFallback: false`).
 */
process.env.PROXY_REWRITES = 'https://rss.example.org=http://freshrss.internal:80';
vi.mock('dns', () => {
  const lookup = vi.fn((_h: string, _o: unknown, cb?: (e: null, a: string, f: number) => void) => { if (typeof cb === 'function') cb(null, '93.184.216.34', 4); });
  const promises = { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) };
  return { default: { lookup, promises }, lookup, promises };
});

const { fetchUpstream } = await import('../routes/proxy.js');
afterEach(() => { vi.unstubAllGlobals(); });

const refusedInternally = () => vi.fn(async (u: string) => {
  if (String(u).startsWith('http://freshrss.internal')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  return new Response('ok');
});

describe('fetchUpstream — repli vers l’URL publique', () => {
  it('se replie par défaut', async () => {
    const f = refusedInternally();
    vi.stubGlobal('fetch', f);
    expect(await (await fetchUpstream('https://rss.example.org/api/greader.php')).text()).toBe('ok');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('ne se replie pas quand l’appel le refuse (secret dans l’URL)', async () => {
    const f = refusedInternally();
    vi.stubGlobal('fetch', f);
    await expect(fetchUpstream('https://rss.example.org/i/?c=feed&a=actualize&token=secret', { publicFallback: false })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toMatch(/^http:\/\/freshrss\.internal/);
  });

  // L'opérateur ne voyait qu'un « fetch failed ». Une ligne le dit, sans le jeton.
  it('le journalise, sans le secret de l’URL', async () => {
    vi.stubGlobal('fetch', refusedInternally());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(fetchUpstream('https://rss.example.org/i/?c=feed&a=actualize&token=secret', { publicFallback: false })).rejects.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls[0])).toContain('no public fallback');
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain('secret');
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain('?');
    } finally { warn.mockRestore(); }
  });
});
