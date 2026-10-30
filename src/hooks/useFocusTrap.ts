import { useEffect, type RefObject } from 'react';

/** Boîtes dont le piège est actif, dans l'ordre d'ouverture. */
const traps: RefObject<HTMLElement | null>[] = [];

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * Ce que Tab peut réellement atteindre. Un ANCÊTRE caché compte : les
 * Préférences gardent montées les sections visitées, `hidden` sur leur
 * enveloppe, et leurs boutons passaient pour le dernier élément. Le CSS
 * (`display: none` d'une classe) se lit par `checkVisibility()` là où le
 * navigateur la connaît.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert], [hidden], [aria-hidden="true"]')
      && (typeof el.checkVisibility !== 'function' || el.checkVisibility()),
  );
}

/**
 * Retient la tabulation dans une boîte modale : Tab et Maj+Tab bouclent sur
 * ses éléments, et un focus resté dehors y revient. `aria-modal` seul ne
 * retenait rien — Tab sortait des Préférences vers la liste d'articles restée
 * derrière.
 *
 * Seule la dernière boîte ouverte retient la touche : une confirmation ouverte
 * par-dessus les Préférences garde la main, puis les Préférences la reprennent
 * à sa fermeture. Écoute en capture sur le document, pour passer avant les
 * gestionnaires des éléments (et avant un focus resté hors de la boîte).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    traps.push(ref);
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      if (traps.at(-1) !== ref) return;
      const root = ref.current;
      if (!root) return;
      const items = focusables(root);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && root.contains(current);
      // Un menu ouvert par portail depuis la boîte (un ⋯ des Préférences) vit
      // sous <body>, hors d'elle : il garde son propre clavier. Pas une liste
      // qui fait partie de la boîte (celle de la palette).
      if (!inside && current?.closest('[role="menu"], [role="listbox"]')) return;
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = traps.lastIndexOf(ref);
      if (i >= 0) traps.splice(i, 1);
    };
  }, [ref, active]);
}
