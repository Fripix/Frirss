import type { Filter } from '../types';
import { canMarkAllRead } from './markAllRead';

/**
 * Faut-il proposer « Tout marquer lu » au pied de la liste ?
 *
 * « Marquer lu au défilement » marque un article quand il sort par le HAUT.
 * Les derniers articles d'une liste n'en sortent jamais : on ne peut plus
 * défiler. Ils restaient donc non lus sans autre recours que la barre d'outils
 * (issue #19, point 5). Le pied n'apparaît qu'une fois la liste complète : à
 * ce moment, les articles chargés SONT la vue, et « il reste des non-lus » se
 * lit dedans sans compteur serveur.
 *
 * Il obéit à `canMarkAllRead` (Favoris et À lire plus tard n'ont pas de
 * « tout lu » qui ait un sens) et se tait pendant une recherche : l'écriture
 * viderait toute la vue, pas seulement les résultats affichés.
 */
export function showEndOfListMarkAll(opts: {
  hasContinuation: boolean;
  loading: boolean;
  loadingMore: boolean;
  searchQuery: string;
  filter: Filter;
  articles: ReadonlyArray<{ read: boolean }>;
}): boolean {
  if (opts.hasContinuation || opts.loading || opts.loadingMore) return false;
  if (opts.searchQuery) return false;
  if (!canMarkAllRead(opts.filter)) return false;
  return opts.articles.some((a) => !a.read);
}
