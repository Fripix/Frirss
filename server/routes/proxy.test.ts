import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateIp, isInternalHostLiteral, targetAllowedLiteral, fetchUpstream, redactUrl, targetBelongsToServer, proxyRateLimit } from './proxy.js';

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

    // Returned as the raw 3xx response instead of being followed — the caller
    // sees resp.ok === false and can correctly treat this as a failure,
    // instead of the redirect target silently answering 200 to a request that
    // lost its credentials on the way. This is exactly how the FreshRSS CSRF
    // rejection (302 to the login page) surfaces honestly.
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

// The FreshRSS feed-refresh call must be a GET with the master token in the
// query string (FreshRSS rejects the POST form — see actualizeRequest.ts), so
// any log statement that prints a URL is now a credential-leak vector.
describe('redactUrl', () => {
  it('replaces the value of a token query parameter', () => {
    const out = redactUrl('https://example.com/i/?c=feed&a=actualize&user=alice&token=s3cr3t-token');
    expect(out).not.toContain('s3cr3t-token');
    expect(out).toContain('token=REDACTED');
    // Everything else stays readable — the log must still be useful.
    expect(out).toContain('c=feed');
    expect(out).toContain('a=actualize');
  });

  it('redacts regardless of parameter case or position', () => {
    for (const u of ['https://example.com/i/?token=s3cr3t',
                     'https://example.com/i/?TOKEN=s3cr3t&a=x',
                     'https://example.com/i/?a=x&Token=s3cr3t&b=y']) {
      expect(redactUrl(u), u).not.toContain('s3cr3t');
    }
  });

  it('leaves URLs without a token untouched, and never throws on junk', () => {
    expect(redactUrl('https://example.com/x?a=1')).toBe('https://example.com/x?a=1');
    expect(redactUrl('not a url at all')).toBe('not a url at all');
  });
});

describe('fetchUpstream logging', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.PROXY_REWRITES;
  });

  it('never writes a token into the rewrite-fallback warning', async () => {
    vi.resetModules();
    process.env.PROXY_REWRITES = 'https://rss.example.com=http://freshrss:80';
    const { fetchUpstream: fetchU } = await import('./proxy.js');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'),
        { cause: { code: 'ECONNREFUSED' } }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchU(
      'https://rss.example.com/i/?c=feed&a=actualize&user=alice&token=s3cr3t-token'
    );

    expect(resp.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].join(' ');
    expect(logged).not.toContain('s3cr3t-token');
    expect(logged).toContain('token=REDACTED');
  });
});

describe('targetBelongsToServer', () => {
  const SERVER = 'https://rss.example.com';

  it('accepts the server\'s own URLs', () => {
    for (const t of [SERVER, `${SERVER}/`, `${SERVER}/api/greader.php/reader/api/0/token`]) {
      expect(targetBelongsToServer(SERVER, t), t).toBe(true);
    }
  });

  it('rejects foreign hosts that merely start with the server URL', () => {
    for (const t of [`${SERVER}.attacker.tld/x`, `${SERVER}@attacker.tld/x`,
                     'https://rss.example.commercial.tld/x', 'http://rss.example.com/x']) {
      expect(targetBelongsToServer(SERVER, t), t).toBe(false);
    }
  });

  it('treats a subpath as a boundary', () => {
    const sub = 'https://rss.example.com/freshrss';
    expect(targetBelongsToServer(sub, `${sub}/api/greader.php`)).toBe(true);
    expect(targetBelongsToServer(sub, sub)).toBe(true);
    expect(targetBelongsToServer(sub, 'https://rss.example.com/freshrss-public/x')).toBe(false);
  });

  it('rejects unparseable input rather than guessing', () => {
    expect(targetBelongsToServer(SERVER, 'not-a-url')).toBe(false);
    expect(targetBelongsToServer('not-a-url', `${SERVER}/x`)).toBe(false);
  });
});

describe('proxyRateLimit', () => {
  it('defaults to a ceiling the offline prefetch never approaches', () => {
    expect(proxyRateLimit({} as NodeJS.ProcessEnv)).toBe(600);
    expect(proxyRateLimit({ FRIRSS_PROXY_RATE_LIMIT: '' } as NodeJS.ProcessEnv)).toBe(600);
  });

  it('honours an operator override', () => {
    expect(proxyRateLimit({ FRIRSS_PROXY_RATE_LIMIT: '50' } as NodeJS.ProcessEnv)).toBe(50);
  });

  it('treats 0 as disabled', () => {
    expect(proxyRateLimit({ FRIRSS_PROXY_RATE_LIMIT: '0' } as NodeJS.ProcessEnv)).toBe(0);
  });

  it('falls back to the default on junk rather than locking the proxy shut', () => {
    for (const raw of ['abc', '-5', '1.5']) {
      expect(proxyRateLimit({ FRIRSS_PROXY_RATE_LIMIT: raw } as NodeJS.ProcessEnv), raw).toBe(600);
    }
  });
});
