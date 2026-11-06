/**
 * Le geste horizontal né en `target` appartient-il à un bloc qui défile de
 * côté (tableau large, `<pre>`), entre `target` et `boundary` exclu ?
 *
 * Le balayage du volet (article précédent / suivant) prenait tout geste
 * horizontal et l'annulait (`preventDefault`) : au doigt, un bloc défilant ne
 * défilait pas (M-11). Il lui laisse désormais le geste — mais seulement
 * **dans le sens où il peut encore défiler** : arrivé au bout, le geste qui va
 * plus loin revient au volet, comme une page qui défile dans une autre.
 *
 * `dx` : déplacement du doigt (négatif vers la gauche, qui fait défiler vers
 * la fin en écriture de gauche à droite ; l'inverse de droite à gauche, où
 * `scrollLeft` va de 0 au début à une valeur négative au bout).
 */
export function scrollsHorizontallyWithin(target: Element | null, boundary: Element, dx: number): boolean {
  if (dx === 0) return false;
  for (let n: Element | null = target; n && n !== boundary; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    const max = n.scrollWidth - n.clientWidth;
    if (max <= 1) continue;
    const style = getComputedStyle(n);
    if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
    const rtl = style.direction === 'rtl';
    const pos = rtl ? -n.scrollLeft : n.scrollLeft;
    const towardEnd = rtl ? dx > 0 : dx < 0;
    if (towardEnd ? pos < max - 1 : pos > 1) return true;
  }
  return false;
}
