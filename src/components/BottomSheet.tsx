import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Fenêtre de grâce du fond, en ms — à peu près la durée de l'animation
 * d'entrée de la feuille (`sheetSlideUp`). Sur iOS, lever le doigt après
 * l'appui long qui ouvre la feuille émet un clic de compatibilité aux
 * coordonnées du doigt : il tombe sur le fond de la feuille qui vient de
 * s'ouvrir sous lui, et la refermait aussitôt. Personne ne peut viser
 * volontairement le fond avant que la feuille soit arrivée — tout clic sur le
 * fond dans cette fenêtre est un écho du geste qui l'a ouverte, pas une
 * demande de fermeture. Échap et les boutons de la feuille ne sont pas
 * concernés : seul le clic sur le fond est retardé.
 */
const BACKDROP_GRACE_MS = 300;

/**
 * Nombre de contacts tactiles actuellement posés sur l'écran. Tenu à jour au
 * niveau du module — un seul jeu d'écouteurs, jamais réinstallé à chaque
 * ouverture de feuille — pour que n'importe quelle instance puisse savoir,
 * dès son ouverture, si un doigt est déjà sur l'écran.
 */
let activeTouchCount = 0;
function trackActiveTouches(e: Event) {
  const touches = (e as TouchEvent).touches;
  if (touches) activeTouchCount = touches.length;
}
if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', trackActiveTouches, { capture: true, passive: true });
  document.addEventListener('touchend', trackActiveTouches, { capture: true, passive: true });
  document.addEventListener('touchcancel', trackActiveTouches, { capture: true, passive: true });
}

/**
 * Feuille glissant depuis le bas, pour les menus du format mobile.
 *
 * Le motif existait déjà — le menu d'étiquettes du volet de lecture le posait
 * à la main, avec les animations `sheetSlideUp` / `backdropFadeIn` — mais les
 * menus d'options s'ouvraient, eux, en liste ancrée sous leur icône : donc en
 * HAUT de l'écran, hors de portée du pouce, avec des rangées de 13 px. Une
 * seule implémentation ici, utilisée par les trois.
 *
 * Échap ferme, le fond aussi ; le contenu ne propage pas le clic.
 *
 * Armement du fond : pourquoi attendre le lever du doigt qui a ouvert la
 * feuille. L'appui long qui déclenche l'ouverture tient le doigt posé
 * pendant que la feuille glisse à l'écran ; iOS n'émet son clic de
 * compatibilité (celui que la grâce doit absorber) qu'au moment où ce doigt
 * se lève — pas à l'ouverture. Compter la grâce depuis l'ouverture suppose
 * donc que le lever suit de près, ce qui n'est vrai que si l'appui est bref :
 * dès que l'utilisateur garde le doigt posé une seconde de plus, le clic
 * d'écho arrive largement après la fenêtre et referme la feuille aussitôt
 * ouverte — le bug observé « la plupart du temps ». La seule garantie fiable
 * est différente : si un doigt est déjà sur l'écran à l'ouverture, c'est
 * forcément lui qui vient de l'ouvrir, donc on n'arme le fond qu'après SON
 * lever (`touchend`/`touchcancel`), et on ne compte la grâce qu'à partir de
 * là. Sans contact actif à l'ouverture (tape, clavier), rien ne change : la
 * grâce est comptée depuis l'ouverture, comme avant.
 */
export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const armed = useRef(false);

  useEffect(() => {
    armed.current = false;
    if (!open) return;

    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    function arm() {
      graceTimer = setTimeout(() => {
        armed.current = true;
      }, BACKDROP_GRACE_MS);
    }

    if (activeTouchCount === 0) {
      arm();
    } else {
      // Un doigt est encore posé : c'est l'appui long qui vient d'ouvrir la
      // feuille. On attend son lever avant de compter la grâce.
      document.addEventListener('touchend', arm, { once: true, capture: true });
      document.addEventListener('touchcancel', arm, { once: true, capture: true });
    }

    return () => {
      if (graceTimer) clearTimeout(graceTimer);
      document.removeEventListener('touchend', arm, true);
      document.removeEventListener('touchcancel', arm, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function onBackdropClick() {
    // Pas encore armé : écho du geste d'ouverture, ignoré (voir plus haut).
    if (!armed.current) return;
    onClose();
  }

  return createPortal(
    <div className="bottom-sheet-root" onClick={onBackdropClick} role="presentation">
      <div className="bottom-sheet__backdrop" />
      <div
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Poignée : purement visuelle, elle dit d'où vient la feuille. */}
        <div className="bottom-sheet__grip" aria-hidden="true" />
        {title && <h3 className="bottom-sheet__title">{title}</h3>}
        {children}
        {/* Zone de l'indicateur d'accueil. */}
        <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
      </div>
    </div>,
    document.body
  );
}
