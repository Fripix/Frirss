// Reconnaissance d'un refus dû au JETON D'ÉCRITURE (CSRF) de FreshRSS.
//
// Le jeton est obtenu une fois puis gardé en mémoire pour toute la session
// (`src/api/feeds.ts`). Rien ne l'invalidait en cours de route : une fois
// périmé — session FreshRSS renouvelée, redémarrage du serveur, jeton expiré —
// CHAQUE écriture échouait jusqu'au rechargement de la page. Le ✓ retirant la
// ligne de façon optimiste, l'utilisateur voyait ses articles disparaître sans
// que rien ne soit écrit : compteur immobile, tout revenu au rechargement.
//
// D'où cette classification, qui décide s'il vaut la peine de redemander un
// jeton et de rejouer l'écriture UNE fois :
//
//  - **401** : la réponse canonique de l'API Google Reader pour un jeton
//    refusé (FreshRSS émet alors l'en-tête `Google-Bad-Token`).
//  - **403** : la variante rencontrée selon la version de FreshRSS et le
//    reverse-proxy placé devant — frontière floue, donc maintenue.
//  - **400** : RETIRÉ (2026-10-18), sur preuve. Chez FreshRSS ce n'est pas un
//    jeton mais un refus SÉMANTIQUE (`GReaderAPI::badRequest`, corps
//    « Bad Request! ») — p. ex. s'abonner à une URL déjà présente. Le jeton
//    n'y changeait rien : le rejeu transformait UN refus en paire
//    POST→jeton→POST toujours 400 (incident du 2026-10-16), et la vraie cause
//    se perdait sous « Error adding feed ». Reproduction contrôlée du
//    2026-10-18 : doublon → 400 sans rejeu, URL neuve → 200.
//  - **Aucune réponse** : c'est le hors-ligne. Un nouveau jeton n'y changerait
//    rien, et une seconde tentative ne ferait que retarder la mise en file
//    d'attente. `isNetworkFailure` (`src/lib/actionQueue.ts`) garde ce cas.
//  - **5xx** : le serveur a un mauvais moment ; la file d'attente le rejoue
//    déjà, avec son propre plafond de tentatives.
//  - **Les autres 4xx** (404, 429…) : le jeton n'y est pour rien.
//
// Élargir cet ensemble coûte, au pire, un aller-retour supplémentaire sur une
// écriture de toute façon perdue ; le rétrécir au-delà du 401/403 remettrait
// en cause le jeton périmé lui-même — d'où le 403 conservé, malgré le flou.

const TOKEN_REJECTED_STATUSES = [401, 403];

export function isStaleWriteTokenFailure(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status !== 'number') return false;
  return TOKEN_REJECTED_STATUSES.includes(status);
}
