import { describe, it, expect } from 'vitest';
import { parseCookieHeader } from './cookies.js';

describe('parseCookieHeader', () => {
  it('returns an empty map without a header', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('splits name=value pairs and trims whitespace', () => {
    expect(parseCookieHeader('a=1; b=two ;c=3')).toEqual({ a: '1', b: 'two', c: '3' });
  });

  it('percent-decodes well-formed values', () => {
    expect(parseCookieHeader('oidc_nonce=a%20b%3D')).toEqual({ oidc_nonce: 'a b=' });
  });

  it('keeps the value of the first = as the separator', () => {
    expect(parseCookieHeader('t=abc=def')).toEqual({ t: 'abc=def' });
  });

  // Issue #23: a third-party cookie on the same host (Authelia behind SWAG)
  // carried an invalid percent sequence; decodeURIComponent threw and the
  // whole OIDC callback failed with "URIError: URI malformed".
  it('keeps a malformed value raw instead of throwing (issue #23)', () => {
    expect(() => parseCookieHeader('authelia_session=abc%E0%A4%A; oidc_verifier=ok')).not.toThrow();
    expect(parseCookieHeader('authelia_session=abc%E0%A4%A; oidc_verifier=ok')).toEqual({
      authelia_session: 'abc%E0%A4%A',
      oidc_verifier: 'ok',
    });
  });

  it('ignores parts without a name or without =', () => {
    expect(parseCookieHeader('=x; novalue; k=v')).toEqual({ k: 'v' });
  });
});
