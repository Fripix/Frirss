import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ getSetting: vi.fn() }));
vi.mock('./routes/proxy.js', () => ({
  fetchUpstream: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ issuer: 'x' }) }),
}));

import { getSetting } from './db.js';
import { fetchUpstream } from './routes/proxy.js';
import { issuerHost, oidcFetch, getDiscovery, clearDiscoveryCache } from './oidc.js';

describe('issuerHost', () => {
  it('extracts the lower-cased host of the configured issuer', () => {
    expect(issuerHost('https://Auth.Example.com/application/o/frirss/')).toBe('auth.example.com');
  });
  it('is null for an empty or malformed issuer', () => {
    expect(issuerHost('')).toBeNull();
    expect(issuerHost('not a url')).toBeNull();
  });
});

describe('oidcFetch', () => {
  beforeEach(() => {
    vi.mocked(fetchUpstream).mockClear();
    vi.mocked(getSetting).mockImplementation((k: string) => k === 'oidc_issuer' ? 'https://auth.example.com/application/o/frirss/' : null);
    clearDiscoveryCache();
  });

  it('trusts the issuer host set by the admin, and nothing else', async () => {
    await oidcFetch('https://auth.example.com/application/o/token/', { method: 'POST', body: 'a=1' });
    expect(fetchUpstream).toHaveBeenCalledWith('https://auth.example.com/application/o/token/',
      expect.objectContaining({ method: 'POST', body: 'a=1', trustedHosts: ['auth.example.com'] }));
  });

  it('getDiscovery goes through the same trust', async () => {
    await getDiscovery();
    expect(fetchUpstream).toHaveBeenCalledWith('https://auth.example.com/application/o/frirss/.well-known/openid-configuration',
      expect.objectContaining({ trustedHosts: ['auth.example.com'] }));
  });

  it('trusts nothing when no issuer is configured', async () => {
    vi.mocked(getSetting).mockReturnValue(null);
    await oidcFetch('https://auth.example.com/x');
    expect(fetchUpstream).toHaveBeenCalledWith('https://auth.example.com/x', expect.objectContaining({ trustedHosts: [] }));
  });
});
