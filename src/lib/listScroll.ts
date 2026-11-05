// Défilement de la liste d'articles vers un article, mesures du DOM en entrée.
//
// Les positions viennent de `getBoundingClientRect` (repère de la fenêtre du
// navigateur) : `viewTop`/`viewBottom` sont les bords du conteneur qui défile,
// `rowTop`/`rowBottom` ceux de la ligne ou de la carte. Le résultat est un
// `scrollTop` à poser sur CE conteneur, et sur lui seul : `scrollIntoView`
// ferait aussi défiler ses ancêtres (la pile mobile, la page).

/**
 * Où défiler pour que la ligne choisie soit visible, ou `null` si elle l'est
 * déjà. Le moins possible (comme `block: 'nearest'`) : ↓ fait avancer la liste
 * d'une ligne, pas d'un écran. Plus haute que la fenêtre, la ligne garde son
 * début visible.
 *
 * Sans lui, ↓/↑ changeaient l'article ouvert sans faire défiler la liste : la
 * ligne surlignée sortait de l'écran (L-15, 1.9.0).
 */
export function revealScrollTop(o: {
  scrollTop: number;
  viewTop: number;
  viewBottom: number;
  rowTop: number;
  rowBottom: number;
  /** Hauteur de ce qui colle en haut de la liste (bande de date). */
  topInset?: number;
}): number | null {
  const top = o.viewTop + (o.topInset ?? 0);
  if (o.rowTop < top) return o.scrollTop - (top - o.rowTop);
  if (o.rowBottom > o.viewBottom) {
    return o.scrollTop + Math.min(o.rowBottom - o.viewBottom, o.rowTop - top);
  }
  return null;
}

/** L'article qui ouvre la fenêtre, et de combien il dépasse au-dessus. */
export interface ListAnchor { id: string; offset: number }

/**
 * Le premier article encore visible en haut de la fenêtre. Les lignes sont
 * dans l'ordre du DOM, donc de haut en bas.
 */
export function listAnchor(rows: readonly { id: string; top: number; bottom: number }[], viewTop: number): ListAnchor | null {
  for (const row of rows) {
    if (row.bottom > viewTop) return { id: row.id, offset: row.top - viewTop };
  }
  return null;
}

/**
 * Le `scrollTop` qui remet l'article d'ancrage à son décalage d'avant. Passer
 * de la liste à la grille gardait le décalage en pixels : une grille est bien
 * plus courte qu'une liste, et l'article 47 devenait le 80 (Idée, 1.9.0).
 */
export function anchoredScrollTop(o: { scrollTop: number; viewTop: number; rowTop: number; offset: number }): number {
  return o.scrollTop + (o.rowTop - o.viewTop) - o.offset;
}
