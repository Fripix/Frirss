import { describe, it, expect } from 'vitest';
import { isStaleWriteTokenFailure } from './writeTokenRetry';

const withStatus = (status: number) => ({ response: { status } });

describe('isStaleWriteTokenFailure', () => {
  it('reconnaît les refus que FreshRSS oppose à un jeton périmé', () => {
    // 401 est la réponse canonique de greader (`Google-Bad-Token`) ; 403
    // couvre la variante rencontrée selon la version et le proxy devant.
    expect(isStaleWriteTokenFailure(withStatus(401))).toBe(true);
    expect(isStaleWriteTokenFailure(withStatus(403))).toBe(true);
  });

  it('ne traite PAS le 400 comme un jeton refusé', () => {
    // Preuve de terrain (reproduction contrôlée 2026-10-18) : FreshRSS répond
    // 400 « Bad Request! » pour un refus SÉMANTIQUE — s'abonner à une URL déjà
    // présente. Rejouer avec un jeton frais ne changeait rien : second POST 400
    // (paire POST→jeton→POST de l'incident 2026-10-16), et le refus réel se
    // perdait sous « Error adding feed ». Le 400 remonte tel quel à l'appelant.
    expect(isStaleWriteTokenFailure(withStatus(400))).toBe(false);
  });

  it('laisse passer une absence de réponse — c’est le hors-ligne, pas un jeton', () => {
    // Ce cas DOIT continuer d'aller à la file d'attente : un nouveau jeton n'y
    // changerait rien, et une seconde tentative retarderait la mise en file.
    expect(isStaleWriteTokenFailure(new Error('Network Error'))).toBe(false);
    expect(isStaleWriteTokenFailure(null)).toBe(false);
    expect(isStaleWriteTokenFailure(undefined)).toBe(false);
    expect(isStaleWriteTokenFailure({ response: {} })).toBe(false);
  });

  it('ne rejoue ni les autres 4xx ni les pannes serveur', () => {
    // 404 / 429 : le jeton n'y est pour rien. 5xx : `isNetworkFailure` s'en
    // charge déjà en mettant l'action en file.
    expect(isStaleWriteTokenFailure(withStatus(404))).toBe(false);
    expect(isStaleWriteTokenFailure(withStatus(429))).toBe(false);
    expect(isStaleWriteTokenFailure(withStatus(500))).toBe(false);
    expect(isStaleWriteTokenFailure(withStatus(502))).toBe(false);
  });
});
