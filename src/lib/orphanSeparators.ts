/**
 * Traits verticaux orphelins d'une barre qui passe à la ligne (L-11, 1.9.0).
 *
 * La barre de la liste se replie sur plusieurs lignes au dernier palier de
 * `useToolbarFold` (`flex-wrap`). Un trait qui séparait deux groupes reste
 * alors seul au bout d'une ligne — le groupe suivant est passé dessous — ou
 * en tête de la suivante. Le CSS seul ne sait pas « où finit la ligne » : on
 * mesure.
 *
 * Un trait est orphelin quand il n'a pas, sur SA ligne, un voisin rendu de
 * chaque côté. Il reçoit `data-orphan`, que le CSS rend invisible
 * (`visibility: hidden`, pas `display: none` : retirer sa largeur changerait
 * le passage à la ligne qu'on vient de mesurer, et la marque oscillerait).
 */
export interface LineBox { top: number; bottom: number }

/** Même ligne : les hauteurs se recoupent (un trait de 16 px est centré dans une ligne de 28). */
function sameLine(a: LineBox, b: LineBox): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

export function isOrphanSeparator(sep: LineBox, prev: LineBox | null, next: LineBox | null): boolean {
  return !prev || !next || !sameLine(sep, prev) || !sameLine(sep, next);
}

/** La boîte d'un élément rendu, ou `null` (`display: none`, vide). */
function boxOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? r : null;
}

function neighbour(el: Element, dir: 'previousElementSibling' | 'nextElementSibling'): DOMRect | null {
  for (let n = el[dir]; n; n = n[dir]) {
    const box = boxOf(n);
    if (box) return box;
  }
  return null;
}

/** Marque (ou démarque) chaque `[data-toolbar-sep]` de `root` selon sa ligne. */
export function markOrphanSeparators(root: Element): void {
  root.querySelectorAll('[data-toolbar-sep]').forEach((sep) => {
    const own = boxOf(sep);
    const orphan = !!own && isOrphanSeparator(own, neighbour(sep, 'previousElementSibling'), neighbour(sep, 'nextElementSibling'));
    sep.toggleAttribute('data-orphan', orphan);
  });
}
