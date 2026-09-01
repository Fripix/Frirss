// Décisions du scroll infini de la liste d'articles.
//
// Elles vivent ici parce qu'elles sont devenues fausses le jour où la liste a
// pu RÉTRÉCIR sous l'utilisateur (le ✓ retire la ligne sous le filtre « Non
// lus », issue #10) : le chargement de la page suivante ne se déclenchait que
// sur un événement `scroll`, et « liste vide » se lisait « tout est lu ».

// Marge de déclenchement : on charge la suite avant d'atteindre le bas, pour
// que la page suivante soit là quand l'utilisateur y arrive.
export const LOAD_MORE_THRESHOLD_PX = 300;

/**
 * Faut-il charger la page suivante, vu l'état du conteneur défilant ?
 *
 * La distance au bas de la liste est comptée telle quelle : quand le contenu
 * restant ne remplit plus la fenêtre, elle est négative et la condition est
 * donc vraie.
 *
 * ⚠️ Cette fonction ne répond qu'à un événement `scroll`. Une liste plus courte
 * que sa fenêtre ne peut plus être défilée du tout : aucun `scroll` ne sera
 * jamais émis, et elle ne sera donc jamais rappelée. Ce cas-là — celui que le
 * ✓ crée en dépilant par le haut — est traité ailleurs, au moment du retrait :
 * `shouldTopUpAfterRemoval` dans `src/lib/listTopUp.ts`.
 */
export function shouldLoadMore(opts: {
  hasContinuation: boolean;
  loading: boolean;
  loadingMore: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  if (!opts.hasContinuation) return false;
  // `loading` = la vue entière se recharge : sa liste va être remplacée, il
  // n'y a rien à paginer d'après un conteneur encore vide.
  if (opts.loading || opts.loadingMore) return false;
  return opts.scrollHeight - opts.scrollTop - opts.clientHeight < LOAD_MORE_THRESHOLD_PX;
}

/**
 * Une liste vide veut-elle dire qu'il n'y a plus rien — donc qu'on peut
 * afficher l'état vide, et sous le filtre « Non lus » l'annoncer comme une
 * réussite (« tout est lu ») ?
 *
 * Non tant que `continuation` promet une page suivante : vider les premières
 * lignes avec le ✓ affichait « tout est lu », en vert et en grand, alors que
 * des non-lus attendaient encore sur le serveur. C'est précisément le flux de
 * travail que le ✓ du mode Compact devait rendre possible.
 */
export function emptyListIsFinal(opts: { articleCount: number; hasContinuation: boolean }): boolean {
  return opts.articleCount === 0 && !opts.hasContinuation;
}
