import { describe, it, expect } from 'vitest';
import { jwtUserId } from './jwtUserId';

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (payload: unknown) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;

describe('jwtUserId', () => {
  it('lit userId dans la charge utile', () => {
    expect(jwtUserId(token({ userId: 42, jti: 'x' }))).toBe(42);
  });
  it('décode le base64url (caractères - et _)', () => {
    // Une charge dont l'encodage contient `-` ou `_` : atob seul lèverait.
    expect(jwtUserId(token({ userId: 7, pad: '>>>???' }))).toBe(7);
  });
  it.each([
    ['nul', null],
    ['vide', ''],
    ['sans point', 'abc'],
    ['charge illisible', 'a.%%%.c'],
    ['sans userId', token({ sub: 'x' })],
    ['userId non numérique', token({ userId: '42' })],
  ])('rend null pour un jeton %s', (_l, t) => {
    expect(jwtUserId(t as string | null)).toBeNull();
  });
});
