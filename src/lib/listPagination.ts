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
 *
 * Ce prédicat dit seulement si le flux est épuisé. Ce que la liste affiche
 * alors est décidé par `listBodyState` ci-dessous — et surtout PAS par un
 * squelette de chargement, qui n'aurait rien pour se terminer.
 */
export function emptyListIsFinal(opts: { articleCount: number; hasContinuation: boolean }): boolean {
  return opts.articleCount === 0 && !opts.hasContinuation;
}

/** Ce que le corps de la liste doit afficher. */
export type ListBodyState =
  /** Chargement de la vue : squelette. */
  | 'skeleton'
  /** Des lignes à afficher. */
  | 'rows'
  /** Liste vide et rien de plus à charger : l'état vide, définitif. */
  | 'empty'
  /** Liste vide, mais une page reste promise : état vide neutre + « charger la suite ». */
  | 'empty-more';

/**
 * Que montrer dans le corps de la liste ?
 *
 * Le rôle de cette fonction est de garantir un invariant : **le squelette
 * n'apparaît que pendant un vrai chargement**. Une première version rendait le
 * squelette dès qu'une liste vide gardait une `continuation`, pour ne pas
 * annoncer « tout est lu » à tort. Rien ne le relançait jamais : le sondage
 * d'`App.tsx` ne touche qu'aux compteurs, `silentRefresh` attend un retour
 * d'onglet, et un squelette plus court que la fenêtre n'émet aucun `scroll`
 * donc `shouldLoadMore` n'est jamais consulté. L'utilisateur était enfermé
 * jusqu'à ce qu'il change de vue — et `persistCurrentView` écrivait cet état
 * dans le cache hors ligne. Un ★ sur un flux dont les 50 premiers articles ne
 * sont pas favoris suffisait à l'y mettre (`fetchArticleStream` filtre les
 * favoris CÔTÉ CLIENT : `articles: []` avec une continuation non nulle est un
 * résultat parfaitement normal).
 *
 * L'honnêteté est conservée, mais dite autrement : `empty-more` est un état
 * vide **final et neutre**, qui n'annonce pas « tout est lu » et propose de
 * charger la page suivante. On ne reste jamais coincé.
 *
 * `searching` fait retomber sur l'état vide ordinaire : `loadMore` ne sait pas
 * paginer une recherche — il redemande le flux nu — donc lui offrir un bouton
 * injecterait des articles étrangers à la requête. L'état vide de recherche a
 * déjà sa propre sortie (« chercher dans tous les flux »).
 */
export function listBodyState(opts: {
  loading: boolean;
  articleCount: number;
  hasContinuation: boolean;
  searching: boolean;
}): ListBodyState {
  if (opts.loading) return 'skeleton';
  if (opts.articleCount > 0) return 'rows';
  if (emptyListIsFinal({ articleCount: opts.articleCount, hasContinuation: opts.hasContinuation })) {
    return 'empty';
  }
  return opts.searching ? 'empty' : 'empty-more';
}
