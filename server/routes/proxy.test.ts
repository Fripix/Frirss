import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateIp, isInternalHostLiteral, targetAllowedLiteral, fetchUpstream } from './proxy.js';

// fetchUpstream resolves its target host before allowing the request (SSRF
// guard) — stub DNS so example.com-style test targets resolve to a public
// address without depending on real network/DNS.
vi.mock('dns', () => {
  const promises = { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) };
  return { default: { promises }, promises };
});

describe('isPrivateIp', () => {
  it('flags IPv4 loopback / private / link-local / CGNAT', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255',
                      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4 (incl. ranges adjacent to private)', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34',
                      '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('flags IPv6 loopback / ULA / link-local and IPv4-mapped private', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
                      '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6 and IPv4-mapped public', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isInternalHostLiteral', () => {
  it('flags localhost, bare names and private IP literals', () => {
    for (const h of ['localhost', 'app.localhost', 'freshrss', 'redis',
                     '10.0.0.5', '127.0.0.1', '[::1]']) {
      expect(isInternalHostLiteral(h), h).toBe(true);
    }
  });

  it('does not flag public hostnames (resolve-check catches DNS tricks later)', () => {
    for (const h of ['example.com', 'rss.example.com', '10.0.0.5.nip.io', '8.8.8.8']) {
      expect(isInternalHostLiteral(h), h).toBe(false);
    }
  });
});

describe('targetAllowedLiteral', () => {
  it('blocks obvious internal targets at the door', () => {
    for (const u of ['http://localhost/', 'http://10.0.0.5:6379/',
                     'http://freshrss/', 'http://[::1]/']) {
      expect(targetAllowedLiteral(u), u).toBe(false);
    }
  });

  it('lets public targets through the literal gate (resolve-check runs at fetch)', () => {
    for (const u of ['https://example.com/a', 'https://10.0.0.5.nip.io/']) {
      expect(targetAllowedLiteral(u), u).toBe(true);
    }
  });

  it('rejects malformed targets', () => {
    expect(targetAllowedLiteral('not a url')).toBe(false);
  });
});

describe('fetchUpstream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('combines a caller AbortSignal into the outgoing request', async () => {
    let capturedInit: RequestInit | undefined;
    let resolveFetch: ((r: unknown) => void) | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Promise((resolve) => { resolveFetch = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);

    const callerController = new AbortController();
    const promise = fetchUpstream('https://example.com/x', { signal: callerController.signal });

    // Let the (mocked) async DNS lookup resolve so fetch() gets called.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((capturedInit!.signal as AbortSignal).aborted).toBe(false);

    callerController.abort();
    // The per-hop controller's signal — the one actually handed to fetch() —
    // must reflect the caller's abort. A regression that stopped forwarding
    // the caller signal would leave this false.
    expect((capturedInit!.signal as AbortSignal).aborted).toBe(true);

    resolveFetch!({ ok: true, status: 200, headers: new Headers() });
    await promise;
  });

  it('does not chase a redirect when followRedirects is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'https://example.com/other' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchUpstream('https://example.com/x', {
      method: 'POST',
      body: 'a=1',
      followRedirects: false,
    });

    // Returned as the raw 3xx response instead of being followed as a
    // bodyless GET — the caller (which put credentials in the body) sees
    // resp.ok === false and can correctly treat this as a failure, instead
    // of the redirect target silently answering 200 to an unauthenticated GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resp.status).toBe(302);
    expect(resp.ok).toBe(false);
  });

  it('still chases a redirect by default (existing behaviour preserved)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: 'https://example.com/final' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchUpstream('https://example.com/start');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resp.status).toBe(200);
  });
});
