import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// The interceptor reads auth state but these tests exercise the client
// interceptors directly, without making real network requests.
const logout = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ serverUrl: '', activeServerId: null, backendToken: null, logout }),
  },
}));

import { BACKEND_AUTH_MARKERS } from '../lib/loginErrors';
import client from './client';

const handlers = (client.interceptors.response as unknown as {
  handlers: {
    fulfilled: (response: unknown) => unknown;
    rejected: (error: unknown) => Promise<unknown>;
  }[];
}).handlers[0];
const rejected = handlers.rejected;
const fulfilled = handlers.fulfilled;

const proxyError = (status: number, data: unknown, headers: Record<string, string> = {}) => ({
  response: { status, data, headers },
});

const reject = async (err: unknown): Promise<unknown> => {
  await expect(rejected(err)).rejects.toBe(err);
  return err;
};

beforeEach(() => {
  logout.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client response interceptor: independent authentication layers', () => {
  it('logs out only for our own backend 401 markers', async () => {
    for (const marker of BACKEND_AUTH_MARKERS) {
      logout.mockClear();
      await reject(proxyError(401, { error: marker }));
      expect(logout, marker).toHaveBeenCalledTimes(1);
    }
  });

  it('does not log out for FreshRSS 401s or unreadable response bodies', async () => {
    await reject(proxyError(401, 'Unauthorized!'));
    await reject(proxyError(401, new ArrayBuffer(8)));
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not log out for other statuses or network errors', async () => {
    for (const status of [400, 403, 429, 500, 502]) {
      await reject(proxyError(status, { error: 'Token required' }));
    }
    await reject(new Error('Network Error'));
    expect(logout).not.toHaveBeenCalled();
  });
});

describe('no hand-built Access login URLs', () => {
  // A /cdn-cgi/access/login/ URL works only with Cloudflare's signed
  // kid+meta parameters; FriRSS cannot mint them, and both the team-domain
  // and the app-origin endpoints answer 404 "Unable to find your Access
  // application!" for wildcard applications without them (verified live for
  // *.lindau.li). The hosted URL is a detection fingerprint only, so any
  // template-literal construction of a login path — whatever the origin —
  // is a regression.
  it('never constructs a login URL in client code', () => {
    const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const file of ['./client.ts', './backend.ts']) {
      expect(source(file), file).not.toMatch(/cdn-cgi\/access\/login\/\$\{/);
    }
  });
});

describe('Cloudflare Access 401 handling', () => {
  it('does not clear the Access recovery cooldown on unrelated successful API traffic', () => {
    const values = new Map<string, string>([['frirss:cloudflare-access-reload-at', '123']]);
    vi.stubGlobal('window', {
      location: { reload: vi.fn() },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    fulfilled({ status: 200, data: {} });
    expect(values.get('frirss:cloudflare-access-reload-at')).toBe('123');
  });

  it('reloads once for an Access fingerprint and stops without navigating', async () => {
    const reload = vi.fn();
    const assign = vi.fn();
    const values = new Map<string, string>();
    const fakeWindow = {
      location: { reload, assign, origin: 'https://rss.example.test', host: 'rss.example.test', pathname: '/?view=all', search: '', hash: '' },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    };
    vi.stubGlobal('window', fakeWindow);

    await expect(rejected(proxyError(401, 'Unauthorized', {
      'www-authenticate': 'Cloudflare-Access',
    }))).rejects.toThrow('Cloudflare Access authentication required');
    await expect(rejected(proxyError(401, 'Unauthorized', {
      'www-authenticate': 'Cloudflare-Access realm="example"',
    }))).rejects.toThrow('Cloudflare Access authentication required');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();

    // A reload did not restore Access: FriRSS must stop, never navigate. Any
    // hand-built login URL would 404 without Cloudflare's signed kid+meta.
    const loginValues = new Map<string, string>([['frirss:cloudflare-access-reload-at', String(Date.now())]]);
    const secondReload = vi.fn();
    const secondAssign = vi.fn();
    vi.stubGlobal('window', {
      location: {
        reload: secondReload,
        assign: secondAssign,
        origin: 'https://rss.example.test',
        host: 'rss.example.test',
        pathname: '/',
        search: '?view=all',
        hash: '#article-123',
      },
      sessionStorage: {
        getItem: (key: string) => loginValues.get(key) ?? null,
        setItem: (key: string, value: string) => { loginValues.set(key, value); },
        removeItem: (key: string) => { loginValues.delete(key); },
      },
    });
    vi.resetModules();
    const freshClient = (await import('./client')).default;
    const freshRejected = (freshClient.interceptors.response as unknown as {
      handlers: { rejected: (error: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;
    const repeatedAccess401 = proxyError(401, 'Unauthorized', {
      'www-authenticate': 'Cloudflare-Access resource_metadata="https://rss.example.test/.well-known/cloudflare-access-protected-resource/api/proxy"',
    });
    await expect(freshRejected(repeatedAccess401)).rejects.toBe(repeatedAccess401);
    expect(secondReload).not.toHaveBeenCalled();
    expect(secondAssign).not.toHaveBeenCalled();

    // An ordinary application/backend 401 must not start recovery at all.
    await reject(proxyError(401, { error: 'Unauthorized' }, {
      'www-authenticate': 'Bearer',
    }));
    expect(secondReload).not.toHaveBeenCalled();
    expect(secondAssign).not.toHaveBeenCalled();
  });

  it('treats a bounce to the hosted login page as an Access failure', async () => {
    const reload = vi.fn();
    const assign = vi.fn();
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { reload, assign, origin: 'https://rss.example.test', host: 'rss.example.test', pathname: '/', search: '', hash: '' },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    vi.resetModules();
    const freshClient = (await import('./client')).default;
    const freshRejected = (freshClient.interceptors.response as unknown as {
      handlers: { rejected: (error: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;

    // A cross-origin redirect to the hosted login page surfaces as an
    // opaque network error; responseURL is the fingerprint. It is detected,
    // never navigated to — without kid+meta it 404s.
    const bounce = Object.assign(new Error('Network Error'), {
      request: {
        responseURL:
          'https://wasserburg.cloudflareaccess.com/cdn-cgi/access/login/rss.lindau.li?kid=abc&meta=def&redirect_url=%2Fapi%2Fproxy',
      },
    });
    await expect(freshRejected(bounce)).rejects.toThrow('Cloudflare Access authentication required');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();

    // An unrelated network error is not an Access failure.
    await expect(freshRejected(Object.assign(new Error('Network Error'), {
      request: { responseURL: 'https://rss.example.test/api/proxy' },
    }))).rejects.toThrow('Network Error');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('request interceptor', () => {
  it('adds the XMLHttpRequest header to API requests', async () => {
    const requestHandler = (client.interceptors.request as unknown as {
      handlers: { fulfilled: (config: Record<string, unknown>) => Record<string, unknown> }[];
    }).handlers[0].fulfilled;
    const config = {
      url: '/api/settings',
      headers: {} as Record<string, unknown>,
      params: undefined,
      baseURL: undefined,
    };
    requestHandler(config);
    expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });
});
