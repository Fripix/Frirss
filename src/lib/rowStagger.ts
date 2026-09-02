// Apparition échelonnée des lignes de la liste d'articles.
//
// L'animation d'entrée (`rowSettle`, `opacity: 0 → 1`, `fill: both`) doit se
// jouer à la PREMIÈRE APPARITION d'un article dans la vue courante, jamais
// parce que sa position a changé.
//
// ⚠️ La décision se prenait sur la seule position dans la liste : les dix
// premières lignes portaient `data-stagger`. Depuis que le ✓ retire une ligne
// (issue #10), tout ce qui la suit remonte d'un cran — la onzième ligne
// devient la dixième, franchit le seuil pour la première fois et rejoue
// l'animation d'entrée alors qu'elle n'a jamais quitté l'écran. Elle
// s'effaçait puis réapparaissait : un article clignotait à chaque clic.
//
// D'où la règle : la position ne sert qu'à ATTRIBUER un retard, une seule
// fois, à une ligne jamais rendue. Ce qui a déjà été attribué ne bouge plus,
// et ce qui a été rendu sans retard n'en reçoit jamais.

// Seules les premières lignes s'échelonnent : au-delà, l'attente serait
// infligée à chaque page du scroll infini. C'est aussi ce qui garde ce dernier
// muet — une page ajoutée en bas arrive au-delà du seuil.
export const STAGGER_ROWS = 10;

/**
 * Mémoire de la vue courante : identifiant → retard attribué, `null` pour une
 * ligne rendue sans animation. La distinction compte — `null` n'est pas
 * « inconnu », c'est « déjà vue, et elle ne s'animera pas ».
 *
 * L'appelant repart d'une mémoire VIDE à chaque changement de vue, pour
 * qu'entrer dans un flux ou changer de filtre anime bien ses lignes.
 */
export type StaggerMemo = ReadonlyMap<string, number | null>;

/**
 * Retard d'apparition à appliquer, par identifiant d'article.
 *
 * Une entrée = une ligne à animer, sa valeur donnant son rang de décalage. Les
 * identifiants absents ne s'animent pas : ils sont déjà à l'écran, ou trop bas
 * pour mériter l'échelonnement.
 *
 * Le résultat est STABLE tant que la vue ne change pas : un rendu de plus
 * (revalidation, compteurs) ne doit pas retirer `data-stagger` d'une ligne en
 * pleine animation, ce qui la ferait sauter à son état final.
 *
 * @param ids Identifiants des articles rendus, dans l'ordre de la liste.
 * @param memo Ce que la vue courante a déjà rendu (voir `StaggerMemo`).
 */
export function staggerIndexes(ids: string[], memo: StaggerMemo): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (memo.has(id)) {
      const previous = memo.get(id);
      if (previous != null) map.set(id, previous);
      continue;
    }
    if (i < STAGGER_ROWS) map.set(id, i);
  }
  return map;
}

/**
 * Mémoire mise à jour après un rendu : chaque ligne rendue y est inscrite,
 * avec le retard qu'elle a reçu ou `null` si elle n'en a pas reçu.
 */
export function rememberStagger(
  memo: Map<string, number | null>,
  ids: string[],
  assigned: ReadonlyMap<string, number>,
): void {
  for (const id of ids) {
    if (!memo.has(id)) memo.set(id, assigned.get(id) ?? null);
  }
}
