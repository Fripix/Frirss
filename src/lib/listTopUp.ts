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

/**
 * Après le retrait d'une ligne, faut-il demander UNE page supplémentaire ?
 *
 * Appelée une seule fois par retrait confirmé, jamais depuis un effet.
 */
export function shouldTopUpAfterRemoval(opts: {
  /**
   * La liste a-t-elle encore quelque chose à faire défiler ?
   *
   * C'est le seul critère utile, et il remplace un comptage de lignes
   * (`remaining < TOP_UP_MIN_ROWS`, seuil à 8) qui ne voulait rien dire : huit
   * lignes sont plausibles sur un téléphone et absurdes sur un grand écran.
   * Une page d'articles non lus en rapporte une cinquantaine ; en retirer
   * vingt-cinq en laisse vingt-cinq — très au-dessus du seuil, donc aucun
   * rattrapage, mais trop peu pour remplir une grande fenêtre, donc plus aucun
   * `scroll` non plus. Les deux mécanismes se taisaient ensemble et la liste
   * restait bloquée sur le reste d'une seule page. Mesure publiée par
   * `ArticleList` via `src/lib/listOverflow.ts`.
   *
   * Elle peut être périmée d'un rendu (le retrait est optimiste, React n'a
   * pas forcément repeint quand la confirmation revient). C'est sans gravité
   * dans les deux sens : une mesure périmée coûte au plus une page inutile, ou
   * un rattrapage qui attend le ✓ suivant. Jamais une boucle — rien de ce que
   * `loadMore` fait ne réécrit cette mesure sans un nouveau geste.
   */
  listCanScroll: boolean;
  hasContinuation: boolean;
  loadingMore: boolean;
  /** Une recherche est-elle active ? */
  searching: boolean;
}): boolean {
  // Flux épuisé : il n'y a rien à demander.
  if (!opts.hasContinuation) return false;
  // Une requête est déjà en vol — elle apportera sa page toute seule.
  if (opts.loadingMore) return false;
  // Recherche active : `loadMore` appelle `fetchArticleStream(filter,
  // selectedFeed, …)` sans jamais passer `searchQuery`, donc la page qu'il
  // rapporte est celle du FLUX NU. L'appendre aux résultats donnerait des
  // articles sans rapport avec la requête, sous une boîte de recherche
  // toujours remplie. `shouldLeaveList` ne regarde que le filtre, resté
  // « unread » pendant la recherche : la ligne part bien, mais le rattrapage
  // se tait. Le décalage `loadMore`/recherche est antérieur — il demandait
  // jusqu'ici de descendre volontairement au bas des résultats ; le rattrapage
  // le déclenchait depuis un seul ✓ sur un résultat court, soit le cas
  // courant. Même précédent que `markReadOnScroll`, déjà éteint en recherche.
  if (opts.searching) return false;
  // La liste déborde encore : l'écouteur `scroll` fera le travail le moment
  // venu, il n'y a rien à rattraper.
  return !opts.listCanScroll;
}
