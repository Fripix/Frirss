import type { Filter } from '../types';

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
  subscriptions: ReadonlyArray<{ id: string; categories?: ReadonlyArray<{ id: string }> }>,
): string[] | null {
  if (view.searching) return null;
  if (view.filter === 'starred' || view.filter === 'readlater') return null;
  if (view.feedId === null) return subscriptions.map((s) => s.id);
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
