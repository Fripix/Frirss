import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('Cloudflare Access 401 handling', () => {
  it('clears the persisted cooldown after successful API traffic', () => {
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
    expect(values.has('frirss:cloudflare-access-reload-at')).toBe(false);
  });

  it('reloads once for an Access fingerprint and not for ordinary backend 401s', async () => {
    const reload = vi.fn();
    const values = new Map<string, string>();
    const fakeWindow = {
      location: { reload },
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

    // An ordinary application/backend 401 must not trigger another reload.
    await reject(proxyError(401, { error: 'Unauthorized' }, {
      'www-authenticate': 'Bearer',
    }));
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
