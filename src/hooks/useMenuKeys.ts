import { useEffect, useState, type RefObject } from 'react';

const ITEMS = 'button:not(:disabled), a[href], [role^="menuitem"]:not([aria-disabled="true"])';

/** Élément suivant pour une touche de menu, `null` si la touche ne déplace rien. */
export function nextMenuIndex(current: number, length: number, key: string): number | null {
  if (length === 0) return null;
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % length;
    case 'ArrowUp': return current < 0 ? length - 1 : (current - 1 + length) % length;
    case 'Home': return 0;
    case 'End': return length - 1;
    default: return null;
  }
}

/**
 * Clavier d'un menu flottant : le focus part sur le premier élément, les
 * flèches haut/bas (plus Début/Fin) parcourent les éléments actifs, et à la
 * fermeture le focus revient à ce qui l'avait avant l'ouverture.
 *
 * Sans lui, un menu ne se parcourait qu'à la tabulation, et sa fermeture
 * laissait le focus sur `<body>` : au clavier, on repartait du haut de la
 * page. Le retour n'a lieu que si le focus est resté dans le menu (ou s'est
 * perdu avec lui) : on ne reprend pas un focus posé ailleurs entre-temps.
 *
 * Les flèches ne sont pas prises dans un champ (le curseur s'y déplace), et un
 * menu qui s'ouvre avec le focus déjà dedans (un champ en `autoFocus`) le
 * garde. Échap et le clic extérieur restent l'affaire de chaque menu.
 *
 * Le déclencheur est ce qui a le focus à l'activation, sauf si un menu l'a
 * déjà posé chez lui dans un effet de mise en page (`Popover`) : on retient
 * alors ce qui l'avait au premier rendu. `active` sert aux menus qui restent
 * montés et n'ouvrent que leur liste. Une touche déjà traitée
 * (`defaultPrevented`) est laissée à qui l'a traitée.
 */
export function useMenuKeys(ref: RefObject<HTMLElement | null>, active = true) {
  const [atMount] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null));
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const now0 = document.activeElement as HTMLElement | null;
    const before = now0 && el.contains(now0) ? atMount : now0;
    const opener = before && before !== document.body && !el.contains(before) ? before : null;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(ITEMS));

    if (!el.contains(document.activeElement)) items()[0]?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      const list = items();
      const next = nextMenuIndex(list.indexOf(target), list.length, e.key);
      if (next === null) return;
      e.preventDefault();
      list[next].focus();
    }
    el.addEventListener('keydown', onKey);

    return () => {
      el.removeEventListener('keydown', onKey);
      const now = document.activeElement;
      const lost = !now || now === document.body || el.contains(now);
      if (opener?.isConnected && lost) opener.focus({ preventScroll: true });
    };
  }, [ref, active, atMount]);
}
