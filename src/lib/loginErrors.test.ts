import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loginErrorKey } from './loginErrors';

const httpError = (status: number) => ({ response: { status } });

describe('loginErrorKey', () => {
  it('n’accuse les identifiants que sur un 401', () => {
    expect(loginErrorKey(httpError(401))).toBe('login.errorLogin');
  });

  it('traite un compte désactivé (403) comme un refus d’identifiants', () => {
    expect(loginErrorKey(httpError(403))).toBe('login.errorLogin');
  });

  it('distingue la limitation de cadence', () => {
    expect(loginErrorKey(httpError(429))).toBe('login.errorTooMany');
  });

  it('n’accuse pas les identifiants sur une erreur serveur', () => {
    expect(loginErrorKey(httpError(500))).toBe('login.errorUnavailable');
    expect(loginErrorKey(httpError(502))).toBe('login.errorUnavailable');
  });

  it('n’accuse pas les identifiants quand le serveur n’a pas répondu', () => {
    expect(loginErrorKey(new Error('Network Error'))).toBe('login.errorUnavailable');
    expect(loginErrorKey(null)).toBe('login.errorUnavailable');
  });

  it('rend des clés qui existent réellement dans les traductions', () => {
    const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
    const resolves = (key: string) => key.split('.').reduce<unknown>((d, p) => (d as Record<string, unknown>)?.[p], fr);
    for (const k of ['login.errorLogin', 'login.errorTooMany', 'login.errorUnavailable']) {
      expect(typeof resolves(k), k).toBe('string');
    }
  });
});
