import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useLongPress, type PressPoint } from './useLongPress';
import { menuAnchor } from '../lib/articleMenu';

/** Un geste parti d'un élément interactif de la ligne lui appartient. */
function fromInteractive(e: { target: EventTarget | null }): boolean {
  return e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [contenteditable]') !== null;
}

/**
 * Le geste est-il vraiment dirigé à la ligne elle-même ?
 *
 * `SavedCategoryPicker` est un enfant React du bouton Favori / À lire plus
 * tard mais se rend dans un portail : son DOM vit hors de la ligne, alors que
 * les événements synthétiques React remontent le long de l'ARBRE React
 * jusqu'aux gestionnaires de la ligne. Il faut donc une containment DOM, pas
 * React : `currentTarget` (la ligne) doit englober `target` dans le document.
 */
function targetsElement<T extends HTMLElement>(e: { target: EventTarget | null; currentTarget: T }): boolean {
  return e.target instanceof Node && e.currentTarget.contains(e.target);
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
 * parti d'un élément interactif (bouton, lien, champ, `contenteditable`) lui
 * appartient.
 *
 * ⚠️ Chaque gestionnaire vérifie d'abord `targetsElement()` : `SavedCategoryPicker`
 * est un enfant React du bouton mais se rend dans un portail, donc son DOM vit
 * hors de la ligne — sans cette containment DOM, un appui long dans son champ
 * de texte, ou un clic droit / molette sur son fond de fermeture, seraient
 * captés par la ligne bien qu'ils visent le portail.
 */
export function useArticleMenuGestures(
  onOpenMenu: ((point: PressPoint) => void) | undefined,
  onOpenSource: (e: ReactMouseEvent) => void,
) {
  const longPress = useLongPress((point) => onOpenMenu?.(point));

  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e) || !onOpenMenu || e.defaultPrevented) return;
      e.preventDefault();
      // Chrome Android émet aussi `contextmenu` sur l'appui long qui vient
      // d'ouvrir le menu : on l'absorbe sans rouvrir.
      if (longPress.firedRecently()) return;
      onOpenMenu(menuAnchor(e, e.currentTarget.getBoundingClientRect()));
    },
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      // Efface la consigne « clic avalé » d'un appui abouti précédent pour
      // CHAQUE contact qui démarre dans la ligne — y compris ceux qu'un
      // bouton ou un champ va s'approprier ci-dessous — sans quoi le clic
      // suivant sur ce bouton resterait avalé par la ligne (`onClickCapture`).
      longPress.reset();
      if (!onOpenMenu || fromInteractive(e)) return;
      longPress.onTouchStart(e);
    },
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onTouchMove();
    },
    onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onTouchEnd(e);
    },
    onTouchCancel: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onTouchCancel();
    },
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onClickCapture(e);
    },
    // Clic molette : empêcher le défilement automatique (Windows, Linux)…
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      if (targetsElement(e) && e.button === 1 && !fromInteractive(e)) e.preventDefault();
    },
    // …puis ouvrir à la source, exactement comme l'icône.
    onAuxClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e) || e.button !== 1 || fromInteractive(e)) return;
      e.preventDefault();
      onOpenSource(e);
    },
  };
}
