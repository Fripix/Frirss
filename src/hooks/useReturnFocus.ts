import { useEffect, useRef } from 'react';

interface OpenSurface {
  seq: number;
  opener: { current: HTMLElement | null };
}

/** Surfaces ouvertes, dans l'ordre d'ouverture. */
const openSurfaces: OpenSurface[] = [];
let nextSeq = 0;

/**
 * Rend le focus, à la fermeture d'une surface, à l'élément qui l'avait quand
 * elle s'est ouverte (le bouton qui l'a ouverte, le plus souvent). Sans cela,
 * le focus tombait sur <body> et la tabulation repartait du haut de la page.
 *
 * Relevé au rendu qui ouvre, avant que la surface ne prenne le focus pour
 * elle (un `autoFocus` passe avant tout effet). Rendu à la fermeture, ou au
 * démontage pour une surface montée seulement ouverte (les Préférences).
 *
 * Une surface ouverte depuis une autre (la palette ouvre les Préférences, une
 * feuille en ouvre une autre) a pour déclencheur un élément qui disparaît avec
 * la première : elle garde aussi, en repli, celui qui avait ouvert la première.
 */
export function useReturnFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const fallback = useRef<HTMLElement | null>(null);
  const seq = useRef(0);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    fallback.current = openSurfaces.at(-1)?.opener.current ?? null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const entry = { seq: ++nextSeq, opener };
    seq.current = entry.seq;
    openSurfaces.push(entry);
    return () => {
      const i = openSurfaces.indexOf(entry);
      if (i >= 0) openSurfaces.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    restore(opener, fallback, seq.current);
  }, [open]);
  useEffect(() => () => restore(opener, fallback, seq.current), []);
}

/**
 * Au tour suivant, et seulement si le focus est retombé sur <body> : une
 * commande de la palette peut ouvrir les Préférences, qui prennent le focus
 * pour elles — le leur rendre au bouton de la palette le leur volerait. Et
 * pas tant qu'une surface ouverte APRÈS celle-ci est là : c'est elle qui
 * rendra le focus en se fermant.
 */
function restore(
  opener: { current: HTMLElement | null },
  fallback: { current: HTMLElement | null },
  seq: number,
): void {
  const candidates = [opener.current, fallback.current];
  opener.current = null;
  fallback.current = null;
  if (!candidates.some(Boolean)) return;
  setTimeout(() => {
    if (openSurfaces.some((s) => s.seq > seq)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const el = candidates.find((c) => c && c.isConnected && !c.hasAttribute('disabled'));
    el?.focus({ preventScroll: true });
  }, 0);
}
