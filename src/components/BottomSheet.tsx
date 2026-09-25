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
 * Feuille glissant depuis le bas, pour les menus du format mobile.
 *
 * Le motif existait déjà — le menu d'étiquettes du volet de lecture le posait
 * à la main, avec les animations `sheetSlideUp` / `backdropFadeIn` — mais les
 * menus d'options s'ouvraient, eux, en liste ancrée sous leur icône : donc en
 * HAUT de l'écran, hors de portée du pouce, avec des rangées de 13 px. Une
 * seule implémentation ici, utilisée par les trois.
 *
 * Échap ferme, le fond aussi ; le contenu ne propage pas le clic.
 */
export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    openedAt.current = open ? Date.now() : null;
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
    // Écho du geste d'ouverture : ignoré, pas fermé (voir BACKDROP_GRACE_MS).
    if (openedAt.current !== null && Date.now() - openedAt.current < BACKDROP_GRACE_MS) return;
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
