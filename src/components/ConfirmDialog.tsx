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
  /** Peut rendre une promesse : la boîte montre alors que ça travaille jusqu'à ce qu'elle se règle. */
  onConfirm: () => void | Promise<void>;
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
  const [busy, setBusy] = useState(false);
  // Lue par l'écouteur d'Échap, qui n'est posé qu'à l'ouverture.
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) { setArmed(false); setBusy(false); return; }
    cancelRef.current?.focus();
    const timer = setTimeout(() => setArmed(true), CONFIRM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); onCancel(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  async function handleConfirm() {
    if (!armed || busy) return;
    const done = onConfirm();
    if (!(done instanceof Promise)) return;
    // Le travail a commencé : la boîte reste, elle montre qu'il tourne, et
    // elle n'accepte plus rien. Ce qui s'affiche est le travail — pas son
    // objet : annoncer ici ce qu'on pourra défaire parlerait d'un filet avant
    // même que l'action soit faite.
    setBusy(true);
    try { await done; } finally { setBusy(false); }
  }

  return createPortal(
    <div className="confirm-dialog-root" onClick={busy ? undefined : onCancel} role="presentation">
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
          <button type="button" ref={cancelRef} className="confirm-dialog__cancel" onClick={onCancel} disabled={busy}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="confirm-dialog__confirm"
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
