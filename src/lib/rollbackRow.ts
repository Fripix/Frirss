// Réinsertion d'une ligne retirée de façon optimiste, quand le serveur refuse.
//
// Le ✓ retire la ligne AVANT la réponse de FreshRSS (issue #10) : attendre la
// confirmation faisait payer l'aller-retour à chaque clic. Le prix en est ce
// rollback — et il ne peut pas se contenter de remettre la ligne « là où elle
// était ». Entre le retrait et le refus, la liste a pu changer trois fois :
//
//  1. **La vue n'est plus la même.** Le ✓ part depuis le flux A, l'utilisateur
//     ouvre le flux B pendant que l'écriture est en vol (`selectFeed` remplace
//     `articles` en bloc). Réinsérer posait un article du flux A au milieu de
//     la liste du flux B — et `persistCurrentView` l'écrivait aussitôt dans le
//     cache de B, où il survivait au rechargement et au retour hors ligne.
//  2. **La ligne est déjà revenue.** Un tiré-pour-rafraîchir ou un
//     `silentRefresh` remplace la liste par une page serveur qui contient
//     toujours l'article — le marquage ayant échoué, il y est encore non lu.
//     Réinsérer en faisait une SECONDE copie : deux enfants React sous la même
//     clé, et le doublon persisté.
//  3. **L'index retenu a vieilli.** ✓ sur a3 puis ✓ sur a0, ce dernier
//     confirmé : l'index 3 retenu pour a3 désigne maintenant la fin de la
//     liste. Un index est un instantané ; il ne survit pas à la concurrence.
//
// D'où la règle : la place se CALCULE au moment du rollback, sur la liste
// telle qu'elle est. La date de publication l'ordonne — c'est l'ordre de la
// liste elle-même. Le voisin du dessus ne sert qu'à trancher À L'INTÉRIEUR
// d'un bloc de même horodatage, où la date ne dit plus rien (flux datés au
// jour, imports en masse), et il est vérifié présent, jamais supposé.
//
// ⚠️ Ce chemin n'a rien d'exotique : le jeton d'écriture CSRF est mis en cache
// pour toute la session (`src/api/feeds.ts`), donc un jeton périmé envoie
// CHAQUE ✓ dans le refus.

/** Le strict minimum dont la décision a besoin — pas un `Article` entier. */
export interface RestorableRow {
  id: string;
  /** Timestamp de publication, en millisecondes. */
  published?: number;
}

export type RestorePlan =
  | { insert: true; index: number }
  | { insert: false; reason: 'view-changed' | 'already-present' };

const publishedAt = (row: RestorableRow): number => row.published ?? 0;

/**
 * Peut-on réinsérer la ligne retirée, et à quelle place ?
 *
 * @param row Ligne retirée, telle qu'elle était avant le retrait.
 * @param articles Liste TELLE QU'ELLE EST au moment du rollback.
 * @param viewAtRemoval Identité de la vue au moment du retrait.
 * @param viewNow Identité de la vue au moment du rollback.
 * @param previousId Id de la ligne qui précédait la ligne retirée, `null` si
 *   elle était en tête. Ne sert qu'à départager un bloc de même date.
 */
export function planRowRestore(opts: {
  row: RestorableRow;
  articles: readonly RestorableRow[];
  viewAtRemoval: string;
  viewNow: string;
  previousId: string | null;
}): RestorePlan {
  const { row, articles, previousId } = opts;
  if (opts.viewAtRemoval !== opts.viewNow) return { insert: false, reason: 'view-changed' };
  if (articles.some((a) => a.id === row.id)) return { insert: false, reason: 'already-present' };

  // Bloc [start, end) des lignes publiées à la même seconde que la nôtre : ce
  // que la date ne sait pas ordonner.
  const target = publishedAt(row);
  let start = 0;
  while (start < articles.length && publishedAt(articles[start]) > target) start++;
  let end = start;
  while (end < articles.length && publishedAt(articles[end]) === target) end++;

  // Sans voisin retenu, la ligne était en tête de son bloc — elle y retourne.
  if (previousId == null) return { insert: true, index: start };
  const previous = articles.findIndex((a) => a.id === previousId);
  // Le voisin ne tranche que s'il borde le bloc ou s'y trouve. Retrouvé
  // ailleurs — liste rechargée, ordre différent — il ne doit pas sortir la
  // ligne de sa date.
  if (previous >= 0 && previous >= start - 1 && previous < end) {
    return { insert: true, index: previous + 1 };
  }
  return { insert: true, index: end };
}
