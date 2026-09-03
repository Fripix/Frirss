import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loginErrorKey, serverConnectErrorKey, isBackendAuthFailure, BLOCKED_TARGET_MARKER, BACKEND_AUTH_MARKERS } from './loginErrors';

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

describe('serverConnectErrorKey — identifiants refusés par FreshRSS', () => {
  it('nomme le refus quand FreshRSS a répondu 401', () => {
    // greader.php répond 401 « Unauthorized! » en text/plain, aussi bien pour
    // un mot de passe d'API faux que pour un mot de passe d'API jamais défini.
    expect(serverConnectErrorKey(proxyError(401, 'Unauthorized!')))
      .toBe('login.errorServerCredentials');
  });

  it('n’accuse pas les identifiants quand c’est NOTRE session qui a expiré', () => {
    // /api/proxy répond 401 avant même de joindre FreshRSS si le JWT FriRSS
    // ne vaut plus rien. Envoyer l'utilisateur retaper son mot de passe API
    // serait exactement la faute que ce module existe pour éviter.
    for (const marker of BACKEND_AUTH_MARKERS) {
      expect(serverConnectErrorKey(proxyError(401, { error: marker })), marker)
        .toBe('login.errorServer');
    }
  });

  it('garde le générique pour un nom d’utilisateur inconnu (400)', () => {
    // FreshRSS répond 400 « Bad Request! » — mais notre proxy répond aussi 400
    // pour une cible absente. Deux causes, un statut : on n'en nomme aucune.
    expect(serverConnectErrorKey(proxyError(400, 'Bad Request!'))).toBe('login.errorServer');
  });

  it('rend une clé qui existe réellement dans les traductions', () => {
    const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
    const resolves = (key: string) => key.split('.').reduce<unknown>((d, p) => (d as Record<string, unknown>)?.[p], fr);
    expect(typeof resolves('login.errorServerCredentials')).toBe('string');
  });
});

describe('BACKEND_AUTH_MARKERS', () => {
  it('couvre encore TOUS les 401 du middleware d’authentification', () => {
    // Le tri se fait par exclusion : un 401 qui n'est pas l'un des nôtres est
    // attribué à FreshRSS. Un quatrième message ajouté dans le middleware sans
    // être listé ici ferait donc accuser les identifiants de l'utilisateur à
    // tort. Ce test est la seule chose qui l'empêche.
    const src = fs.readFileSync(path.join(process.cwd(), 'server/middleware/auth.ts'), 'utf8');
    const found = [...src.matchAll(/status\(401\)\.json\(\{ error: '([^']+)' \}\)/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set(BACKEND_AUTH_MARKERS));
  });
});

describe('isBackendAuthFailure', () => {
  // Deux couches d'authentification sans rapport : le compte FriRSS (JWT sur
  // `/api/*`) et le serveur FreshRSS rattaché. Le proxy relaie le statut amont
  // TEL QUEL, donc un 401 de FreshRSS — session expirée là-bas, mot de passe
  // d'API changé — arrive avec le même statut que l'expiration de NOTRE JWT.
  // Réagir aux deux de la même façon déconnectait de FriRSS pour une panne qui
  // ne le concernait pas.
  it('reconnaît chacun des 401 de notre middleware', () => {
    for (const marker of BACKEND_AUTH_MARKERS) {
      expect(isBackendAuthFailure(proxyError(401, { error: marker })), marker).toBe(true);
      // Selon le `responseType`, axios rend l'objet JSON ou la chaîne brute.
      expect(isBackendAuthFailure(proxyError(401, `{"error":"${marker}"}`)), marker).toBe(true);
    }
  });

  it('n’attribue pas à FriRSS le 401 de FreshRSS', () => {
    expect(isBackendAuthFailure(proxyError(401, 'Unauthorized!'))).toBe(false);
    expect(isBackendAuthFailure(proxyError(401, '<html>401</html>'))).toBe(false);
  });

  it('reste muet sur un corps illisible plutôt que de deviner', () => {
    // `responseType: 'blob'`/`'arraybuffer'` (images, favicons) : le corps
    // n'est pas du texte. Ne rien affirmer ne coûte qu'une requête en erreur ;
    // se tromper coûte la session de l'utilisateur.
    expect(isBackendAuthFailure(proxyError(401, new ArrayBuffer(8)))).toBe(false);
    expect(isBackendAuthFailure(proxyError(401, undefined))).toBe(false);
  });

  it('ignore tout ce qui n’est pas un 401', () => {
    expect(isBackendAuthFailure(proxyError(403, { error: 'Account disabled' }))).toBe(false);
    expect(isBackendAuthFailure(proxyError(500, { error: 'Token required' }))).toBe(false);
    expect(isBackendAuthFailure(new Error('Network Error'))).toBe(false);
    expect(isBackendAuthFailure(null)).toBe(false);
  });
});
