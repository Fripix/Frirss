import type { Filter } from '../types';

export type MarkAllAction = 'mark' | 'ask';

/** Taille d'une page de relevé (`stream/items/ids`). */
export const UNDO_PAGE = 1000;

/**
 * Combien de pages le relevé accepte d'enchaîner avant d'abandonner.
 *
 * `mark-all-as-read` ne dit pas ce qu'il a touché : les non-lus sont relevés
 * AVANT l'appel, page par page. Ce n'est pas une limite de confort mais une
 * borne de sûreté — vingt-cinq requêtes d'identifiants, c'est déjà beaucoup,
 * et au-delà le relevé serait partiel. On ne promet alors rien plutôt que de
 * rendre une liste tronquée en la présentant comme complète.
 */
export const UNDO_PAGES = 25;

/** Le nombre d'articles au-delà duquel plus rien n'est promis. */
export const UNDO_CAP = UNDO_PAGE * UNDO_PAGES;

// Decide what a "Mark all as read" click should do:
//  - confirmation disabled           → mark immediately
//  - confirmation enabled, first tap  → ask (show the "Confirm?" state)
//  - confirmation enabled, confirming → mark
export function markAllReadAction(confirmEnabled: boolean, isConfirming: boolean): MarkAllAction {
  if (!confirmEnabled) return 'mark';
  return isConfirming ? 'mark' : 'ask';
}

/**
 * « Marquer tout comme lu » a-t-il un sens dans cette vue ?
 *
 * `feedStore.markAllAsRead()` s'adresse au flux sélectionné, ou à la liste de
 * lecture entière quand il n'y en a pas. Il n'a aucune notion de filtre — et il
 * ne peut pas en avoir : « favoris » et « à lire plus tard » ne sont pas des
 * flux qu'on vide, ce sont des sélections transversales.
 *
 * Le bouton était pourtant rendu partout. Depuis la vue Favoris, un contrôle
 * qui se lit « marquer ces articles comme lus » marquait TOUTE la liste de
 * lecture et remettait tous les compteurs à zéro — une action que rien ne
 * défait sur des centaines d'articles.
 */
export function canMarkAllRead(filter: Filter): boolean {
  return filter !== 'starred' && filter !== 'readlater';
}
