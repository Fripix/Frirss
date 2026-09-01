import type { Filter } from '../types';

/**
 * Une ligne doit-elle quitter la liste après avoir été marquée lue ?
 *
 * La règle porte sur le GESTE, pas sur l'état. Ouvrir un article le marque lu
 * (`selectArticle`), mais sa ligne doit rester : elle disparaîtrait pendant
 * qu'on le lit. Seule une mise à l'écart explicite — le ✓ d'une ligne, le
 * balayage vers la gauche — retire.
 *
 * `implicit` distingue le marquage au défilement, seul écrivain que
 * l'utilisateur ne commande pas.
 *
 * `filter === 'unread'` est exigé parce que les vues Favoris et « À lire plus
 * tard » montrent délibérément des articles lus : une ligne qui s'y volatilise
 * n'aurait aucun sens, l'article y a toujours sa place une fois lu.
 *
 * `selected` protège l'article OUVERT : deux bascules depuis le volet de
 * lecture atteignent une vraie transition non-lu → lu sur lui, et retirer sa
 * ligne le laisserait à l'écran sans place dans la liste — `selectNextArticle`
 * ne le retrouve plus et saute en tête. C'est l'invariant que `silentRefresh`
 * entretient déjà en réinsérant l'article en cours de lecture.
 *
 * L'appelant ne doit invoquer cette fonction qu'APRÈS confirmation du serveur :
 * le rollback de `toggleRead` ne fait qu'un `.map()` et serait incapable de
 * remettre une ligne déjà retirée.
 */
export function shouldLeaveList(opts: {
  becameRead: boolean;
  filter: Filter;
  implicit: boolean;
  selected: boolean;
}): boolean {
  if (!opts.becameRead) return false;
  if (opts.implicit) return false;
  if (opts.selected) return false;
  return opts.filter === 'unread';
}
