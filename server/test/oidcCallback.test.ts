import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * `/api/auth/oidc/callback` est anonyme : sans limite, et avec un `state` qui
 * resservait pendant 5 minutes et un cookie fourni par l'appelant, 200 rappels
 * faisaient envoyer 200 `POST /token` au fournisseur, `client_secret` compris.
 * FriRSS servait de relais vers lui depuis sa propre adresse ; une protection
 * qui bannit l'émetteur des échecs coupait alors le SSO de toute l'instance.
 */
const oidcFetch = vi.fn(async (url: string) => (url.endsWith('/token')
  ? new Response('{"error":"invalid_grant"}', { status: 400 })
  : new Response('{}', { status: 200 })));
vi.mock('../oidc.js', async () => {
  const actual = await vi.importActual<typeof import('../oidc.js')>('../oidc.js');
  return {
    ...actual,
    getDiscovery: vi.fn(async () => ({
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      userinfo_endpoint: 'https://idp.example.com/userinfo',
    })),
    oidcFetch: (url: string) => oidcFetch(url),
  };
});

process.env.NODE_ENV = 'production';
const { default: app } = await import('../index.js');
const { setSetting, getJwtSecret } = await import('../db.js');
const { OIDC_CALLBACK_RATE_LIMIT } = await import('../routes/auth.js');

const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
const callback = (state: string, ip: string) => request(app)
  .get(`/api/auth/oidc/callback?code=c&state=${encodeURIComponent(state)}`)
  .set('X-Forwarded-For', ip)
  .set('Cookie', 'oidc_verifier=choisi-par-l-appelant');
const newState = async (ip: string) => stateOf((await request(app).get('/api/auth/oidc/login').set('X-Forwarded-For', ip)).headers.location);
const tokenCalls = () => oidcFetch.mock.calls.filter(([u]) => String(u).endsWith('/token')).length;

beforeAll(() => {
  setSetting('oidc_enabled', 'true');
  setSetting('oidc_issuer', 'https://idp.example.com/');
  setSetting('oidc_client_id', 'frirss');
  setSetting('oidc_client_secret', 'secret');
});
beforeEach(() => { oidcFetch.mockClear(); });
const silent = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('retour SSO — state à usage unique', () => {
  it('un state ne sert qu’une fois', async () => {
    const err = silent();
    const state = await newState('198.51.100.1');
    const first = await callback(state, '198.51.100.1');
    const second = await callback(state, '198.51.100.1');
    err.mockRestore();
    expect(first.headers.location).toBe('/#oidc_error=token_exchange');
    expect(second.headers.location).toBe('/#oidc_error=invalid_state');
    expect(tokenCalls()).toBe(1);
  });

  it('un rappel sans verifier ne consomme pas le state', async () => {
    const err = silent();
    const state = await newState('198.51.100.2');
    const bare = await request(app).get(`/api/auth/oidc/callback?code=c&state=${encodeURIComponent(state)}`).set('X-Forwarded-For', '198.51.100.2');
    expect(bare.headers.location).toBe('/#oidc_error=missing_verifier');
    expect((await callback(state, '198.51.100.2')).headers.location).toBe('/#oidc_error=token_exchange');
    err.mockRestore();
  });

  it('refuse un state signé sans identifiant', async () => {
    const state = jwt.sign({ t: 'oidc_state', redirectUri: 'https://example.com/cb' }, getJwtSecret(), { expiresIn: '5m' });
    expect((await callback(state, '198.51.100.3')).headers.location).toBe('/#oidc_error=invalid_state');
    expect(tokenCalls()).toBe(0);
  });
});

describe('retour SSO — cadence', () => {
  it('coupe une adresse qui insiste, et le fournisseur ne voit plus rien', { timeout: 30_000 }, async () => {
    const err = silent();
    const seen: string[] = [];
    for (let i = 0; i <= OIDC_CALLBACK_RATE_LIMIT; i++) {
      const state = await newState('2001:db8:1234:5600::1');
      // Une /64 voisine de la même /56 : même seau.
      seen.push(String((await callback(state, `2001:db8:1234:56${(i % 16).toString(16)}0::${i + 1}`)).headers.location));
    }
    err.mockRestore();
    expect(seen.slice(0, OIDC_CALLBACK_RATE_LIMIT).every((l) => l === '/#oidc_error=token_exchange')).toBe(true);
    expect(seen[OIDC_CALLBACK_RATE_LIMIT]).toBe('/#oidc_error=too_many');
    expect(tokenCalls()).toBe(OIDC_CALLBACK_RATE_LIMIT);
  });

  it('laisse une autre adresse revenir', async () => {
    const err = silent();
    const state = await newState('198.51.100.9');
    const res = await callback(state, '198.51.100.9');
    err.mockRestore();
    expect(res.headers.location).toBe('/#oidc_error=token_exchange');
  });
});
