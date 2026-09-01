// Remise à niveau de la liste après le retrait d'une ligne.
//
// Le ✓ retire une ligne sous le filtre « Non lus » (issue #10). Ce qui reste
// peut alors être plus court que la fenêtre : plus rien ne défile, l'écouteur
// `scroll` ne sera plus jamais appelé, et la pagination s'arrête alors que
// `continuation` promet d'autres articles. L'utilisateur croit être au bout.
//
// ⚠️ Cette décision a d'abord été portée par un effet React qui surveillait
// l'état de la liste (`useAutoLoadMore`, retiré le 2026-09-01, le jour même).
// Deux emballements l'ont condamné, et ils expliquent la forme d'ici :
//
//  1. **Tempête d'échecs.** Le `catch` de `loadMore` remet `loadingMore` à
//     `false` en laissant `continuation` intacte. `loadingMore` étant dans les
//     dépendances de l'effet, le passage `true → false` le relançait, qui
//     rappelait `loadMore`, sans fin — 51 appels consécutifs mesurés contre un
//     `loadMore` en échec.
//  2. **Vidage complet du flux.** `fetchArticleStream` filtre les favoris d'un
//     flux CÔTÉ CLIENT : une page de 50 éléments serveur peut ne donner AUCUNE
//     ligne visible — `articles: []` avec une `continuation` non nulle.
//     L'effet voyait une liste trop courte et repaginait, encore et encore,
//     jusqu'à épuiser le flux. Un seul appui sur le ★ de la barre d'outils
//     d'un gros flux suffisait, alors que les favoris n'ont rien à voir avec
//     le ✓.
//
// D'où la règle : la décision n'est PAS prise en observant un état, mais au
// moment du RETRAIT lui-même, une seule fois. Un geste de l'utilisateur ⇒ au
// plus une page supplémentaire. Ni le résultat de cette page, ni le retour de
// `loadingMore` à `false`, ni une page qui ne rend aucune ligne ne peuvent la
// redéclencher : l'échec s'arrête, tout simplement.

// Seuil volontairement bas : on comble une liste devenue plus courte que sa
// fenêtre, on ne prépare pas le hors-ligne. Un seuil proche de la taille de
// page ferait paginer à chaque ✓.
export const TOP_UP_MIN_ROWS = 8;

/**
 * Après le retrait d'une ligne, faut-il demander UNE page supplémentaire ?
 *
 * Appelée une seule fois par retrait confirmé, jamais depuis un effet.
 */
export function shouldTopUpAfterRemoval(opts: {
  remaining: number;
  hasContinuation: boolean;
  loadingMore: boolean;
}): boolean {
  // Flux épuisé : il n'y a rien à demander.
  if (!opts.hasContinuation) return false;
  // Une requête est déjà en vol — elle apportera sa page toute seule.
  if (opts.loadingMore) return false;
  return opts.remaining < TOP_UP_MIN_ROWS;
}
