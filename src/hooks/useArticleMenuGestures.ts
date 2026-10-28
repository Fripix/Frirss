import { useRef, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { useLongPress, type PressPoint } from './useLongPress';
import { useRegisterRowPress, type RowPressRegistry } from './rowPress';
import { menuAnchor } from '../lib/articleMenu';

const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable]';

/**
 * Un geste parti d'un élément interactif de la ligne lui appartient.
 *
 * Exception, `rowLinkIsRow` : le titre-lien (`TitleLink.tsx`, marqué
 * `data-row-link`) est un `<a>`, mais seuls le clic molette et le
 * ⌘/Ctrl-clic lui reviennent. L'appui long tactile qui en part reste celui de
 * la ligne : le titre occupe une bonne part de la ligne, le menu ne doit pas
 * cesser de s'ouvrir là où le doigt se pose le plus souvent.
 */
function fromInteractive(e: { target: EventTarget | null }, { rowLinkIsRow = false } = {}): boolean {
  if (!(e.target instanceof Element)) return false;
  const hit = e.target.closest(INTERACTIVE);
  return hit !== null && !(rowLinkIsRow && hit.matches('[data-row-link]'));
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
 * long ouvrent le menu ; le clic molette ouvre l'article à sa source — sauf
 * sur le titre, un vrai lien que le navigateur ouvre en arrière-plan
 * (`TitleLink.tsx`).
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 *
 * ⚠️ Le clic droit des boutons Favori et À lire plus tard reste prioritaire :
 * leur rangement par catégorie (`useCategoryPicker`, `ArticleActions.tsx`) appelle déjà
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
 *
 * `presses` : le registre des appuis longs de la ligne (`rowPress.ts`), où
 * celui-ci s'inscrit à côté de ceux de ses boutons. Le balayage qui enveloppe
 * la ligne sur mobile les annule et les interroge tous ; le drag natif de la
 * ligne (`onDragStart`, voir plus bas) aussi.
 */
export function useArticleMenuGestures(
  onOpenMenu: ((point: PressPoint) => void) | undefined,
  onOpenSource: (e: ReactMouseEvent) => void,
  opts: { presses?: RowPressRegistry | null; onDragStart?: (e: ReactDragEvent<HTMLElement>) => void } = {},
) {
  const { presses = null, onDragStart } = opts;
  const longPress = useLongPress((point) => onOpenMenu?.(point));
  useRegisterRowPress(longPress.control, presses);
  /**
   * Un doigt est posé dans la ligne — quel que soit l'élément touché (ligne,
   * titre, bouton), et même si l'appui a été annulé par un mouvement. Tout
   * drag natif qui démarre pendant ce contact est annulé (`onDragStart`).
   */
  const touchContact = useRef(false);

  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e) || !onOpenMenu || e.defaultPrevented) return;
      e.preventDefault();
      // Chrome Android émet `contextmenu` pendant l'appui long — mesuré AVANT
      // le minuteur : l'appui aboutit alors tout de suite, au point du doigt ;
      // après, il est absorbé. Le menu s'ouvre une fois, au même endroit.
      if (longPress.claimContextMenu(e)) return;
      onOpenMenu(menuAnchor(e, e.currentTarget.getBoundingClientRect()));
    },
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      touchContact.current = true;
      // Efface la consigne « clic avalé » d'un appui abouti précédent pour
      // CHAQUE contact qui démarre dans la ligne — y compris ceux qu'un
      // bouton ou un champ va s'approprier ci-dessous — sans quoi le clic
      // suivant sur ce bouton resterait avalé par la ligne (`onClickCapture`).
      longPress.reset();
      // Un second doigt annule l'appui en cours, même posé sur un bouton.
      if (e.touches.length > 1) { longPress.onTouchStart(e); return; }
      if (!onOpenMenu || fromInteractive(e, { rowLinkIsRow: true })) return;
      longPress.onTouchStart(e);
    },
    onTouchMove: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onTouchMove(e);
    },
    onTouchEnd: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      if (!e.touches || e.touches.length === 0) touchContact.current = false;
      longPress.onTouchEnd(e);
    },
    onTouchCancel: (e: ReactTouchEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      touchContact.current = false;
      longPress.onTouchCancel();
    },
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      longPress.onClickCapture(e);
    },
    // Drag natif : à la souris, celui de l'appelant (classer un article en le
    // déposant sur la barre latérale). Au doigt, l'appui long gagne, et sans
    // exception : TOUT drag natif qui démarre pendant un contact tactile dans
    // la ligne est annulé — y compris quand l'appui a été annulé par un
    // mouvement de plus de 8 px ou que le doigt est sur un bouton sans appui
    // long. Le glisser-déposer d'un article vers la barre latérale est donc
    // réservé à la souris (retrait assumé, `FEATURES.md`). Chrome Android
    // démarre ce drag sur un appui long (~495 ms, puis `touchcancel`) : un
    // appui armé — de la ligne ou d'un de ses boutons — aboutit alors tout de
    // suite. Sans quoi le menu ne s'ouvrait qu'une fois sur deux, quand le
    // minuteur gagnait la course.
    // À la souris, un drag parti de l'étoile ou de « À lire plus tard » laisse
    // son appui souris armé (le navigateur n'émet plus ni `mousemove` ni
    // `mouseup` pendant un drag) : il est annulé, sans quoi le sélecteur de
    // catégorie s'ouvrait à 500 ms en plein drag.
    onDragStart: (e: ReactDragEvent<HTMLElement>) => {
      if (targetsElement(e)) {
        const claimed = longPress.claimTouchDrag() || !!presses?.claimTouchDrag();
        if (claimed || touchContact.current) {
          e.preventDefault();
          return;
        }
        presses?.cancelAll();
        longPress.cancel();
      }
      onDragStart?.(e);
    },
    // Clic molette : empêcher le défilement automatique (Windows, Linux)…
    // Parti d'un lien — l'icône « ouvrir à la source » ou le titre
    // (`TitleLink.tsx`) —, il appartient au navigateur, qui ouvre le lien en
    // arrière-plan : ni `preventDefault`, ni `window.open` (qui, lui, ouvre
    // toujours au premier plan).
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e)) return;
      // Un vrai bouton de souris : un contact tactile dont la fin n'a pas
      // atteint la ligne (cible retirée du DOM) ne doit pas bloquer le drag
      // souris pour toujours. Les événements de compatibilité d'un toucher
      // arrivent après `touchend` et se signalent par `firesTouchEvents`.
      const caps = (e.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities;
      if (!caps?.firesTouchEvents) touchContact.current = false;
      if (e.button === 1 && !fromInteractive(e)) e.preventDefault();
    },
    // …puis, ailleurs sur la ligne, ouvrir à la source, exactement comme l'icône.
    onAuxClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (!targetsElement(e) || e.button !== 1 || fromInteractive(e)) return;
      e.preventDefault();
      onOpenSource(e);
    },
  };
}
