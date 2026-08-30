import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, type Toast } from '../stores/uiStore';

/** Durée d'affichage. Plus long quand une action est proposée : il faut le
 *  temps de lire, de décider, puis d'atteindre le bouton. */
const PLAIN_MS = 3800;
const WITH_ACTION_MS = 6500;

/**
 * Messages transitoires, en bas de l'écran.
 *
 * L'application n'avait aucun retour de ce type : deux bandeaux fixes (hors
 * ligne, relève) et rien d'autre. Une action réussie ne se disait jamais.
 *
 * `aria-live="polite"` et non `assertive` : ce sont des confirmations, elles
 * ne doivent pas couper la lecture en cours d'un lecteur d'écran.
 */
export default function Toaster() {
  const toasts = useUiStore((s) => s.toasts);

  if (!toasts.length) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastRow({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(
      () => dismissToast(toast.id),
      toast.action ? WITH_ACTION_MS : PLAIN_MS
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.action, dismissToast]);

  return (
    <div className="toast" data-tone={toast.tone}>
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action?.run();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast__close"
        onClick={() => dismissToast(toast.id)}
        aria-label={t('toast.dismiss')}
        title={t('toast.dismiss')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
