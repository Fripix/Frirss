// Les pages dont l'extraction a échoué, le temps de la session (L-03).
//
// Sans elle, une page non extractible était redemandée à chaque ouverture et
// par chaque file — réchauffage de la vue, préchargement N+1…N+10, ouverture
// elle-même : sur une chaîne YouTube, 27 `/api/extract` en 422 en 25 s, chacun
// suivi d'un repli `/api/proxy`, soit ~10 Mo pour une seule ouverture.
//
// Seuls les échecs qui tiennent à la PAGE y entrent (pas une page, trop
// grosse, refusée par le site, rien de lisible) : une cadence dépassée, un
// délai ou une panne réseau ne disent rien d'elle, et le prochain passage peut
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
