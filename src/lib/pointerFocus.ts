import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Empêche une bascule à icône de PRENDRE le focus au clic souris.
 *
 * Le problème observé : on clique une bascule d'affichage, elle garde le focus
 * DOM ; dès la frappe suivante — et dans FriRSS il y en a tout le temps (j/k,
 * flèches, `?`, ⌘K) — le navigateur bascule en « dernière interaction =
 * clavier » et l'anneau `:focus-visible` s'allume sur un bouton qu'on ne
 * regarde plus. Un encadré apparaît alors sans qu'on ait rien demandé.
 *
 * Empêcher le défaut du `mousedown` retire le focus au clic **sans** rendre le
 * bouton inatteignable au clavier : il reste dans l'ordre de tabulation, et
 * l'anneau s'affiche alors à bon escient. À réserver aux commandes à icône
 * dont on ne veut pas garder le focus — pas aux champs ni aux boutons d'action.
 */
export const noFocusOnPointer = {
  onMouseDown: (e: ReactMouseEvent) => e.preventDefault(),
};
