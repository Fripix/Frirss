import { useEffect, useRef } from 'react';

interface OpenSurface {
  seq: number;
  /** Le déclencheur relevé à l'ouverture (instantané, pas la ref). */
  opener: HTMLElement | null;
  /** Les surfaces ouvertes avant elle, la plus proche d'abord. */
  chain: OpenSurface[];
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
 * Une surface ouverte depuis une autre (⌘K → « Raccourcis » → « Configurer »,
 * une feuille qui en ouvre une autre) a pour déclencheur un élément qui
 * disparaît avec la précédente : elle garde la chaîne des surfaces ouvertes
 * avant elle, et se replie sur le déclencheur de la plus proche qui est déjà
 * FERMÉE. Jamais sur celui d'une surface encore ouverte : le focus partirait
 * derrière elle (une feuille des Préférences renvoyait au bouton engrenage).
 */
export function useReturnFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  const chain = useRef<OpenSurface[]>([]);
  const entry = useRef<OpenSurface | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const prev = openSurfaces.at(-1);
    chain.current = prev ? [prev, ...prev.chain] : [];
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const e: OpenSurface = { seq: ++nextSeq, opener: opener.current, chain: chain.current };
    entry.current = e;
    openSurfaces.push(e);
    return () => {
      const i = openSurfaces.indexOf(e);
      if (i >= 0) openSurfaces.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    restore(entry);
  }, [open]);
  useEffect(() => () => restore(entry), []);
}

/**
 * Au tour suivant, et seulement si le focus est retombé sur <body> : une
 * commande de la palette peut ouvrir les Préférences, qui prennent le focus
 * pour elles — le leur rendre au bouton de la palette le leur volerait. Et
 * pas tant qu'une surface ouverte APRÈS celle-ci est là : c'est elle qui
 * rendra le focus en se fermant.
 */
function restore(entry: { current: OpenSurface | null }): void {
  const e = entry.current;
  entry.current = null;
  if (!e) return;
  setTimeout(() => {
    if (openSurfaces.some((s) => s.seq > e.seq)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const usable = (el: HTMLElement | null) => !!el && el.isConnected && !el.hasAttribute('disabled');
    if (usable(e.opener)) { e.opener!.focus({ preventScroll: true }); return; }
    for (const prev of e.chain) {
      if (openSurfaces.includes(prev)) return; // encore ouverte : rien derrière elle
      if (usable(prev.opener)) { prev.opener!.focus({ preventScroll: true }); return; }
    }
  }, 0);
}
