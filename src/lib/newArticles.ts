import type { Filter } from '../types';
import { inMainStream } from './mainStream';
import type { FeedPriority } from '../types';

/**
 * Pastille « N nouveaux articles » (discussion #14) : quels flux comptent pour
 * la vue affichée, et combien d'articles y sont arrivés.
 * Spec : docs/superpowers/specs/2026-09-17-new-articles-pill-design.md
 */
export interface ViewDescriptor {
  /** Id du flux, de la catégorie ou de l'étiquette sélectionnés ; `null` pour l'accueil. */
  feedId: string | null;
  filter: Filter;
  /** Une recherche est en cours. */
  searching: boolean;
}

const LABEL_PREFIX = 'user/-/label/';

/**
 * Flux dont les arrivées comptent pour la vue, ou `null` si la vue n'a pas de
 * pastille. Catégories et étiquettes partagent le préfixe `user/-/label/` : une
 * étiquette, qu'aucun abonnement ne porte comme catégorie, rend donc `null`.
 */
export function viewFeedIds(
  view: ViewDescriptor,
  subscriptions: ReadonlyArray<{ id: string; priority?: FeedPriority; categories?: ReadonlyArray<{ id: string }> }>,
): string[] | null {
  if (view.searching) return null;
  if (view.filter === 'starred' || view.filter === 'readlater') return null;
  // The home view shows the main stream only: a feed FreshRSS keeps in its
  // category must not count as an arrival "in view".
  if (view.feedId === null) return subscriptions.filter(inMainStream).map((s) => s.id);
  if (view.feedId.startsWith('feed/')) return [view.feedId];
  if (view.feedId.startsWith(LABEL_PREFIX)) {
    const ids = subscriptions
      .filter((s) => s.categories?.some((c) => c.id === view.feedId))
      .map((s) => s.id);
    return ids.length ? ids : null;
  }
  return null;
}

/** Somme des arrivées (`computeRefreshDelta().newByFeed`) des flux de la vue. */
export function countNewInView(newByFeed: Record<string, number>, feedIds: readonly string[]): number {
  let total = 0;
  for (const id of feedIds) total += newByFeed[id] ?? 0;
  return total;
}

/**
 * Décalage des séparateurs de date sous le bandeau « N nouveaux articles ».
 * Le bandeau et les séparateurs collent tous deux en haut du conteneur
 * défilant ; l'emplacement du bandeau garde sa hauteur nulle (il se pose
 * par-dessus la première ligne, voulu), c'est donc le séparateur qui descend
 * sous lui tant qu'il s'affiche. La hauteur vient de la même variable que
 * celle du bandeau (`--new-articles-banner-height`, 40 px, 44 px sous
 * `pointer: coarse`, `index.css`) : pas de second nombre à tenir à jour.
 * À poser sur le conteneur défilant ; `.date-separator` le lit.
 */
export function newArticlesOffsetStyle(bannerShown: boolean): Record<string, string> {
  return { '--new-articles-offset': bannerShown ? 'var(--new-articles-banner-height)' : '0px' };
}
