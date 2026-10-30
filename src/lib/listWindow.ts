// Combien de lignes de la liste d'articles sont montées.
//
// Le store garde toute la liste : le raccourci « article suivant », « Tout lu »
// et la recherche hors ligne travaillent dessus. Seul le DOM est tranché. Depuis
// que la préparation sert jusqu'à 400 lignes, elles partaient entières à
// l'ouverture du flux (10 000 nœuds pour 400 lignes en vue Aperçu), et chaque
// ouverture d'article les re-rendait toutes. Avant, c'était la pagination réseau
// qui faisait cette tranche, et une liste en mémoire n'en avait plus.

/** Comme une page du serveur : ce que l'œil connaît déjà de la liste. */
export const ROW_SLICE = 50;

export function mountedRows(opts: {
  /** Ce qui a déjà été monté dans cette vue. */
  limit: number;
  total: number;
  /** Rang de l'article ouvert, -1 sinon : on peut l'atteindre au clavier. */
  selectedIndex: number;
  /** La recherche pagine `articles` elle-même (`searchVisible`). */
  searching: boolean;
}): number {
  if (opts.searching) return opts.total;
  return Math.min(opts.total, Math.max(opts.limit, opts.selectedIndex + 1));
}

export const nextRowLimit = (mounted: number): number => mounted + ROW_SLICE;
