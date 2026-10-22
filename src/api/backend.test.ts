import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The interceptor reads auth state but these tests exercise it directly,
// without making real network requests.
const logoutBackend = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ backendToken: null, logoutBackend }),
  },
}));

import backend from './backend';

const handlers = (backend.interceptors.response as unknown as {
  handlers: {
    fulfilled: (response: unknown) => unknown;
    rejected: (error: unknown) => Promise<unknown>;
  }[];
}).handlers[0];
const rejected = handlers.rejected;

const error401 = (headers: Record<string, string> = {}) => ({
  response: { status: 401, headers },
});

const reject = async (err: unknown): Promise<unknown> => {
  await expect(rejected(err)).rejects.toBe(err);
  return err;
};

beforeEach(() => {
  logoutBackend.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backend request interceptor', () => {
  it('marks requests as XHR so Cloudflare Access answers 401, not 302', () => {
    const requestHandler = (backend.interceptors.request as unknown as {
      handlers: { fulfilled: (config: Record<string, unknown>) => Record<string, unknown> }[];
    }).handlers[0].fulfilled;
    const config = { headers: {} as Record<string, unknown> };
    requestHandler(config);
    expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });
});

describe('backend response interceptor: Access vs FriRSS auth', () => {
  const stubWindow = () => {
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
    return { reload, assign };
  };

  it('recovers from an Access 401 without ending the FriRSS session', async () => {
    const { reload, assign } = stubWindow();
    vi.resetModules();
    const freshBackend = (await import('./backend')).default;
    const freshRejected = (freshBackend.interceptors.response as unknown as {
      handlers: { rejected: (error: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;

    // The exact fingerprint of an expired Cloudflare Access session on an
    // XHR (previously a 302 to the login page, which surfaced as a CORS
    // network error on /api/preferences and never triggered recovery).
    await expect(freshRejected(error401({
      'www-authenticate': 'Cloudflare-Access resource_metadata="https://rss.example.test/.well-known/cloudflare-access-protected-resource/api/preferences"',
    }))).rejects.toThrow('Cloudflare Access authentication required');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(logoutBackend).not.toHaveBeenCalled();
  });

  it('still ends the FriRSS session on a genuine backend 401', async () => {
    stubWindow();
    await reject(error401({ 'www-authenticate': 'Bearer' }));
    await reject({ response: { status: 401, headers: {} } });
    expect(logoutBackend).toHaveBeenCalledTimes(2);
  });

  it('ignores other statuses and network errors', async () => {
    const { reload } = stubWindow();
    for (const status of [400, 403, 429, 500, 502]) {
      await reject({ response: { status, headers: {} } });
    }
    await reject(new Error('Network Error'));
    expect(logoutBackend).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
