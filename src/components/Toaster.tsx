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

  // Un bandeau qui porte un avancement appartient au travail en cours : il ne
  // s'efface pas tout seul, sans quoi l'annulation d'un « tout marquer comme
  // lu » disparaîtrait de l'écran en pleine besogne.
  const working = !!toast.progress;

  useEffect(() => {
    if (working) return;
    const timer = setTimeout(
      () => dismissToast(toast.id),
      toast.action ? WITH_ACTION_MS : PLAIN_MS
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.action, working, dismissToast]);

  const part = toast.progress && toast.progress.total > 0
    ? Math.min(100, Math.round((toast.progress.done / toast.progress.total) * 100))
    : 0;

  return (
    <div className="toast" data-tone={toast.tone} data-working={working ? '' : undefined}>
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            // Une action qui rend une promesse a du travail devant elle : le
            // bandeau reste, et c'est elle qui décidera de sa suite (elle y
            // affiche son avancement, puis son résultat).
            const running = toast.action?.run();
            if (!(running instanceof Promise)) dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.progress && (
        <div
          className="toast__progress"
          style={{ width: `${part}%` }}
          role="progressbar"
          aria-valuenow={toast.progress.done}
          aria-valuemin={0}
          aria-valuemax={toast.progress.total}
        />
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
