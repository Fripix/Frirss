import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loginErrorKey, serverConnectErrorKey, BLOCKED_TARGET_MARKER } from './loginErrors';

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

const proxyError = (status: number, data: unknown) => ({ response: { status, data } });

describe('serverConnectErrorKey', () => {
  it('nomme la garde anti-SSRF quand elle a bloqué la cible', () => {
    // Le cas de l’issue #8 : FreshRSS sur une IP privée, PROXY_INTERNAL_HOSTS
    // non défini. Le backend sait pourquoi ; l’écran doit le dire.
    expect(serverConnectErrorKey(proxyError(403, { error: 'Target host not allowed' })))
      .toBe('login.errorServerBlocked');
  });

  it('reconnaît le refus même quand le corps est resté du texte', () => {
    // Selon le responseType, axios rend l’objet JSON ou la chaîne brute.
    expect(serverConnectErrorKey(proxyError(403, '{"error":"Target host not allowed"}')))
      .toBe('login.errorServerBlocked');
  });

  it('n’accuse pas la garde pour un 403 venu de FreshRSS lui-même', () => {
    // Le proxy relaie le statut amont tel quel : un 403 de FreshRSS n’est pas
    // un blocage de la garde, et lui envoyer l’utilisateur régler
    // PROXY_INTERNAL_HOSTS serait la même faute qu’avant, déplacée.
    expect(serverConnectErrorKey(proxyError(403, '<html>Forbidden</html>')))
      .toBe('login.errorServer');
  });

  it('laisse le message générique aux causes qu’il n’a pas vérifiées', () => {
    expect(serverConnectErrorKey(proxyError(401, 'Unauthorized'))).toBe('login.errorServer');
    expect(serverConnectErrorKey(proxyError(502, { error: 'Upstream request failed' }))).toBe('login.errorServer');
    expect(serverConnectErrorKey(new Error('Network Error'))).toBe('login.errorServer');
    expect(serverConnectErrorKey(null)).toBe('login.errorServer');
  });

  it('rend une clé qui existe réellement dans les traductions', () => {
    const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
    const resolves = (key: string) => key.split('.').reduce<unknown>((d, p) => (d as Record<string, unknown>)?.[p], fr);
    for (const k of ['login.errorServer', 'login.errorServerBlocked']) {
      expect(typeof resolves(k), k).toBe('string');
    }
  });
});

describe('BLOCKED_TARGET_MARKER', () => {
  it('correspond encore au corps que le backend renvoie', () => {
    // Le front reconnaît le refus de la garde à cette phrase. Elle est écrite
    // des deux côtés d'une frontière que le typage ne traverse pas : si le
    // backend la reformule, l'écran repasse silencieusement au message
    // générique, sans qu'aucun test de comportement ne rougisse.
    const proxy = fs.readFileSync(path.join(process.cwd(), 'server/routes/proxy.ts'), 'utf8');
    expect(proxy).toContain(`{ error: '${BLOCKED_TARGET_MARKER}' }`);
  });
});
