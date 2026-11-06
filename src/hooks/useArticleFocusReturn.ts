import { useEffect, useRef } from 'react';
import { revealScrollTop } from '../lib/listScroll';

/** Images que la liste a pour rendre la carte après la fermeture. */
const MAX_FRAMES = 10;

/**
 * Amène la carte dans la liste, au plus juste (M-05). La liste, démontée
 * pendant la lecture, revient à la position de l'ouverture : un article
 * atteint au clavier depuis est plus bas, et son anneau de focus restait hors
 * de l'écran. Le défilement est posé sur la liste seule (`data-article-scroll`),
 * comme celui de la sélection : `scrollIntoView` ferait défiler aussi la page
 * (L-15).
 */
function reveal(card: HTMLElement): void {
  const list = card.closest<HTMLElement>('[data-article-scroll]');
  if (!list) return;
  const view = list.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const next = revealScrollTop({
    scrollTop: list.scrollTop,
    viewTop: view.top,
    viewBottom: view.top + list.clientHeight,
    rowTop: box.top,
    rowBottom: box.bottom,
    // Une bande de date colle en haut et recouvrirait la carte.
    topInset: list.querySelector<HTMLElement>('.date-separator')?.offsetHeight ?? 0,
  });
  if (next !== null) list.scrollTop = next;
}

/**
 * Fermer l'article (Échap en grille, bouton Retour, commande « Retour ») rend
 * le focus à la carte ou à la ligne de l'article fermé (`[data-article-id]`).
 *
 * Sur ordinateur en grille ou à deux panneaux, et sur tablette, le volet est
 * démonté sous le focus, qui retombait sur `<body>` : la tabulation repartait
 * du haut de la page (A-4). Le téléphone a la même règle dans `MobileStack`
 * (`focusKey`), d'où `enabled` pour ne pas la doubler.
 *
 * Seulement si le focus est perdu (`<body>`, ou un élément qui n'est plus dans
 * la page) : un focus posé ailleurs entre-temps n'est pas à nous. La carte
 * est amenée à l'écran avant d'être focalisée (`reveal`, M-05). La carte
 * peut n'apparaître qu'au rendu suivant (liste remontée) : quelques images
 * d'attente, bornées, puis on renonce.
 */
export function useArticleFocusReturn(selectedId: string | null, enabled = true): void {
  const last = useRef<string | null>(selectedId);

  useEffect(() => {
    const closed = last.current;
    last.current = selectedId;
    if (!enabled || !closed || selectedId) return;

    let frame = 0;
    let raf = 0;
    const attempt = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const selector = `[data-article-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(closed) : closed}"]`;
      const card = document.querySelector<HTMLElement>(selector);
      if (card) {
        reveal(card);
        card.focus({ preventScroll: true });
        return;
      }
      if (++frame < MAX_FRAMES) raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, [selectedId, enabled]);
}
