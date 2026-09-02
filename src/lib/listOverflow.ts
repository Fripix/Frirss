// La liste a-t-elle encore quelque chose à faire défiler ?
//
// Fait d'écran, pas de comptage. Le rattrapage de pagination
// (`shouldTopUpAfterRemoval`, `listTopUp.ts`) se décidait sur un nombre de
// lignes restantes, ce qui ne veut rien dire : huit lignes sont plausibles sur
// un téléphone et absurdes sur un grand écran. Un utilisateur a vu la liste se
// bloquer à ~25 lignes alors que le flux en promettait ~80 — bien au-dessus du
// seuil, mais trop court pour remplir SA fenêtre : plus rien ne défilait, donc
// plus aucun événement `scroll`, donc plus aucune page.
//
// Seule la liste connaît ce fait ; le store n'a pas de DOM. Elle le PUBLIE
// donc ici, dans un canal hors React : ni état, ni rendu, ni effet qui
// observerait quoi que ce soit — la mesure ne déclenche jamais rien par
// elle-même, elle est seulement LUE au moment d'un retrait.

/**
 * Marge sous laquelle un dépassement ne compte pas.
 *
 * Les hauteurs rendues sont fractionnaires (zoom du navigateur, bordures en
 * pixels logiques) : `scrollHeight` dépasse `clientHeight` d'un cheveu sur une
 * liste qui ne défile pas réellement.
 */
export const OVERFLOW_SLACK_PX = 4;

/** Le contenu déborde-t-il de son conteneur défilant ? */
export function listOverflows(m: { scrollHeight: number; clientHeight: number }): boolean {
  return m.scrollHeight > m.clientHeight + OVERFLOW_SLACK_PX;
}

// Défaut PRUDENT : tant que rien n'a été mesuré, on suppose que la liste
// défile encore. Une mesure absente ou périmée coûte alors au pire une page de
// rattrapage manquée — jamais une page demandée à l'aveugle, et jamais une
// boucle : la valeur n'est écrite que par la liste, jamais par le rattrapage.
let canScroll = true;

/** Publié par `ArticleList` à chaque rendu, défilement et redimensionnement. */
export function publishListCanScroll(value: boolean): void {
  canScroll = value;
}

/** Dernière mesure connue. Peut être périmée d'un rendu — voir ci-dessus. */
export function listCanScroll(): boolean {
  return canScroll;
}

/**
 * Retour au défaut prudent, quand plus aucune liste n'est à l'écran.
 *
 * Sans cela, une liste démontée (onglet mobile, volet de lecture plein écran)
 * laisserait sa dernière mesure figée : marquer lu depuis le volet de lecture
 * demanderait une page par geste, sans que personne ne voie le résultat.
 */
export function resetListCanScroll(): void {
  canScroll = true;
}
