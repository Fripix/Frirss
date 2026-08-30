import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
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
 */
export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
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

  return createPortal(
    <div className="bottom-sheet-root" onClick={onClose} role="presentation">
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
