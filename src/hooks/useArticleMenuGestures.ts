import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useLongPress, type PressPoint } from './useLongPress';
import { menuAnchor } from '../lib/articleMenu';

/** Un geste parti d'un bouton de la ligne appartient à ce bouton. */
function fromButton(e: { target: EventTarget | null }): boolean {
  return e.target instanceof Element && e.target.closest('button') !== null;
}

/**
 * Gestes d'une ligne ou d'une carte d'article : clic droit, touche Menu et appui
 * long ouvrent le menu ; le clic molette ouvre l'article à sa source.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 *
 * ⚠️ Le clic droit des boutons Favori et À lire plus tard reste prioritaire :
 * leur rangement par catégorie (`useFileGesture`) appelle déjà
 * `preventDefault()`, et on sort sur `defaultPrevented` — les boutons ne sont
 * pas modifiés. Même règle pour l'appui long et le clic molette : un geste
 * parti d'un bouton lui appartient.
 */
export function useArticleMenuGestures(
  onOpenMenu: ((point: PressPoint) => void) | undefined,
  onOpenSource: (e: ReactMouseEvent) => void,
) {
  const longPress = useLongPress((point) => onOpenMenu?.(point));

  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!onOpenMenu || e.defaultPrevented) return;
      e.preventDefault();
      // Chrome Android émet aussi `contextmenu` sur l'appui long qui vient
      // d'ouvrir le menu : on l'absorbe sans rouvrir.
      if (longPress.firedRecently()) return;
      onOpenMenu(menuAnchor(e, e.currentTarget.getBoundingClientRect()));
    },
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      if (!onOpenMenu || fromButton(e)) return;
      longPress.onTouchStart(e);
    },
    onTouchMove: longPress.onTouchMove,
    onTouchEnd: longPress.onTouchEnd,
    onClickCapture: longPress.onClickCapture,
    // Clic molette : empêcher le défilement automatique (Windows, Linux)…
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button === 1 && !fromButton(e)) e.preventDefault();
    },
    // …puis ouvrir à la source, exactement comme l'icône.
    onAuxClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button !== 1 || fromButton(e)) return;
      e.preventDefault();
      onOpenSource(e);
    },
  };
}
