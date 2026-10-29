import { describe, it, expect, vi, afterEach } from 'vitest';

/*
 * Redirections suivies par `fetchUpstream` :
 * - le jeton FreshRSS (`Authorization`) ne suivait une redirection que sur le
 *   même HÔTE, pas la même ORIGINE : un saut https → http sur cet hôte
 *   l'envoyait en clair ;
 * - le corps de chaque réponse de redirection restait ouvert : sous undici, la
 *   socket est retenue jusqu'au ramassage tant que le flux n'est ni lu ni
 *   annulé (le piège que `routes/extract.ts` documente déjà).
 */
vi.mock('dns', () => {
  const lookup = vi.fn((_h: string, _o: unknown, cb?: (e: null, a: string, f: number) => void) => { if (typeof cb === 'function') cb(null, '93.184.216.34', 4); });
  const promises = { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) };
  return { default: { lookup, promises }, lookup, promises };
});

const { fetchUpstream } = await import('../routes/proxy.js');

afterEach(() => { vi.unstubAllGlobals(); });

function redirectTo(location: string, onCancel: () => void) {
  const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(10)); }, cancel() { onCancel(); } });
  return new Response(body, { status: 302, headers: { Location: location } });
}

describe('fetchUpstream — redirections', () => {
  it('retire le jeton sur un saut https → http, même hôte', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push({ ...init.headers });
      return seen.length === 1 ? redirectTo('http://rss.example.org/b', () => {}) : new Response('ok');
    }));
    await fetchUpstream('https://rss.example.org/a', { headers: { Authorization: 'GoogleLogin auth=secret' } });
    expect(seen[0].Authorization).toBe('GoogleLogin auth=secret');
    expect(seen[1].Authorization).toBeUndefined();
  });

  // Un serveur enregistré en http:// derrière un proxy qui redirige vers
  // https (Caddy le fait toujours, en 308) : le jeton suit la montée en
  // https sur le même hôte, comme en 1.7.0.
  it('garde le jeton sur un saut http → https, même hôte', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push({ ...init.headers });
      return seen.length === 1 ? redirectTo('https://rss.example.org/a', () => {}) : new Response('ok');
    }));
    await fetchUpstream('http://rss.example.org/a', { headers: { Authorization: 'GoogleLogin auth=secret' } });
    expect(seen[1].Authorization).toBe('GoogleLogin auth=secret');
  });

  it('retire le jeton vers un autre hôte, même en https', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push({ ...init.headers });
      return seen.length === 1 ? redirectTo('https://ailleurs.example.org/a', () => {}) : new Response('ok');
    }));
    await fetchUpstream('http://rss.example.org/a', { headers: { Authorization: 'GoogleLogin auth=secret' } });
    expect(seen[1].Authorization).toBeUndefined();
  });

  it('garde le jeton sur la même origine', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { headers: Record<string, string> }) => {
      seen.push({ ...init.headers });
      return seen.length === 1 ? redirectTo('/b', () => {}) : new Response('ok');
    }));
    await fetchUpstream('https://rss.example.org/a', { headers: { Authorization: 'GoogleLogin auth=secret' } });
    expect(seen[1].Authorization).toBe('GoogleLogin auth=secret');
  });

  it('libère le corps de chaque redirection suivie', async () => {
    let cancelled = 0;
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n < 3 ? redirectTo(`/r${n}`, () => { cancelled++; }) : new Response('ok'))));
    const res = await fetchUpstream('https://news.example.org/a');
    expect(await res.text()).toBe('ok');
    expect(cancelled).toBe(2);
  });
});
