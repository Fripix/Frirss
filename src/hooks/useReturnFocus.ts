import { useEffect, useRef } from 'react';

/**
 * Rend le focus, à la fermeture d'une surface, à l'élément qui l'avait quand
 * elle s'est ouverte (le bouton qui l'a ouverte, le plus souvent). Sans cela,
 * le focus tombait sur <body> et la tabulation repartait du haut de la page.
 *
 * Relevé au rendu qui ouvre, avant que la surface ne prenne le focus pour
 * elle (un `autoFocus` passe avant tout effet). Rendu à la fermeture, ou au
 * démontage pour une surface montée seulement ouverte (les Préférences).
 */
export function useReturnFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (open) return;
    restore(opener);
  }, [open]);
  useEffect(() => () => restore(opener), []);
}

/**
 * Au tour suivant, et seulement si le focus est retombé sur <body> : une
 * commande de la palette peut ouvrir les Préférences, qui prennent le focus
 * pour elles — le leur rendre au bouton de la palette le leur volerait.
 */
function restore(opener: { current: HTMLElement | null }): void {
  const el = opener.current;
  opener.current = null;
  if (!el) return;
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (el.isConnected && !el.hasAttribute('disabled')) el.focus({ preventScroll: true });
  }, 0);
}
