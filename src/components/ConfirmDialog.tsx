import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * Le temps pendant lequel la validation refuse de répondre après l'ouverture.
 *
 * Même raison que la grâce du fond de `BottomSheet` : le geste qui OUVRE ne
 * doit pas pouvoir valider. C'est exactement ce qui s'est produit dans l'issue
 * #17 — un double-clic sur « Tout lu », dont le second clic tombait sur le
 * « Confirmer ? » posé à la place du bouton.
 */
export const CONFIRM_GRACE_MS = 350;

interface Props {
  open: boolean;
  title: string;
  /** Le périmètre, ou ce que l'action va toucher. */
  message?: string;
  confirmLabel: string;
  /** Prévient que l'action ne pourra pas être défaite. */
  warning?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Une question à laquelle il faut répondre, rendue PAR l'application.
 *
 * Pas `window.confirm()` : le natif ne se thème pas, ne se traduit pas, ne se
 * teste pas, et sur iOS en plein écran il affiche le domaine du site. Ici tout
 * est sous contrôle — l'apparence, les libellés, le focus de départ, et les
 * deux gardes contre le double-clic.
 *
 * Le focus part sur ANNULER : dans une question dont une réponse est
 * irréversible, la touche Entrée réflexe doit tomber du côté qui ne casse rien.
 */
export default function ConfirmDialog({ open, title, message, confirmLabel, warning, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!open) { setArmed(false); return; }
    cancelRef.current?.focus();
    const timer = setTimeout(() => setArmed(true), CONFIRM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="confirm-dialog-root" onClick={onCancel} role="presentation">
      <div className="confirm-dialog__backdrop" />
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="confirm-dialog__title">{title}</h2>
        {message && <p className="confirm-dialog__message">{message}</p>}
        {warning && <p className="confirm-dialog__warning">{warning}</p>}
        <div className="confirm-dialog__actions">
          <button type="button" ref={cancelRef} className="confirm-dialog__cancel" onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="confirm-dialog__confirm"
            onClick={() => { if (armed) onConfirm(); }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
