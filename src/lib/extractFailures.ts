// Les pages dont l'extraction a échoué, le temps de la session (L-03).
//
// Sans elle, une page non extractible était redemandée à chaque ouverture et
// par chaque file — réchauffage de la vue, préchargement N+1…N+10, ouverture
// elle-même : sur une chaîne YouTube, 27 `/api/extract` en 422 en 25 s, chacun
// suivi d'un repli `/api/proxy`, soit ~10 Mo pour une seule ouverture.
//
// Seuls les échecs qui tiennent à la PAGE y entrent (pas une page, trop
// grosse, trop complexe — refusée par le serveur, M-01 —, refusée par le site
// d'un 4xx, rien de lisible) : une cadence
// dépassée, un délai, un 5xx ou une panne réseau ne disent rien d'elle, ni un
// refus de FriRSS lui-même (`isPageRefusal`), et le prochain passage peut
// réussir. En mémoire seulement : un rechargement redonne sa chance à tout, et
// le bouton « Article complet » réessaie toujours (`retry`).

import { extractYouTubeId } from './youtube';

/** Au-delà, la plus ancienne sort : la mémoire d'une longue session reste bornée. */
export const EXTRACT_FAILURES_MAX = 500;

const failed = new Set<string>();

export function rememberExtractFailure(url: string): void {
  if (!url) return;
  failed.delete(url);
  failed.add(url);
  if (failed.size > EXTRACT_FAILURES_MAX) {
    const oldest = failed.values().next().value;
    if (oldest !== undefined) failed.delete(oldest);
  }
}

export function extractFailedBefore(url: string): boolean {
  return failed.has(url);
}

/** Un succès (demandé par le lecteur) efface l'échec retenu. */
export function forgetExtractFailure(url: string): void {
  failed.delete(url);
}

/** Toute la mémoire — pour les tests, et rien d'autre. */
export function forgetExtractFailures(): void {
  failed.clear();
}

/**
 * Un refus HTTP tient-il à la PAGE, au point de ne plus la redemander de la
 * session ? Seuls les 4xx, hors délai (408) et cadence (429) : un 5xx, une
 * surcharge ou une coupure du site sont passagers, et le prochain passage
 * peut réussir. `from` dit qui a répondu : `site` pour le statut que le
 * serveur a reçu du site (`upstreamStatus`), `proxy` pour la réponse de
 * `/api/proxy`, où un 401 ou un 403 peut être celui de FriRSS lui-même
 * (session expirée, cible refusée par la garde) — jamais retenu, puisque ce
 * n'est pas la page qui est en cause.
 */
export function isPageRefusal(status: number, from: 'site' | 'proxy'): boolean {
  if (status < 400 || status >= 500 || status === 408 || status === 429) return false;
  if (from === 'proxy' && (status === 401 || status === 403)) return false;
  return true;
}

/**
 * Une page qu'il est inutile d'envoyer à l'extraction : une vidéo YouTube n'a
 * pas d'article, et son contenu de flux (la vidéo, sa description) est déjà
 * ce qu'il y a à lire. `extractYouTubeId` sait la reconnaître sous toutes ses
 * formes.
 */
export function isExtractableUrl(url: string | null | undefined): boolean {
  return !!url && !extractYouTubeId(url);
}

/** L'extraction automatique a-t-elle une chance ici ? Ni YouTube, ni échec retenu. */
export function worthAutoExtracting(url: string | null | undefined): boolean {
  return isExtractableUrl(url) && !extractFailedBefore(url!);
}
