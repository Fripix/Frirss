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
 * L'appelant ne doit invoquer cette fonction qu'APRÈS confirmation du serveur :
 * le rollback de `toggleRead` ne fait qu'un `.map()` et serait incapable de
 * remettre une ligne déjà retirée.
 */
export function shouldLeaveList(opts: {
  becameRead: boolean;
  filter: Filter;
  implicit: boolean;
}): boolean {
  if (!opts.becameRead) return false;
  if (opts.implicit) return false;
  return opts.filter === 'unread';
}
