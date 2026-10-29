import { useEffect, useRef, useState } from 'react';
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
 *
 * La région reste montée, vide, quand il n'y a rien : montée en même temps que
 * son premier message, elle n'était souvent pas annoncée (liveRegions.test).
 */
export default function Toaster() {
  const toasts = useUiStore((s) => s.toasts);

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
  // Visé (survol ou focus dedans) : il attend. Il partait au bout de 6,5 s
  // même sous le focus — l'« Annuler » d'un « Tout lu » se perdait au clavier
  // et au lecteur d'écran (WCAG 2.2.1). Relâché, il repart pour sa durée.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const rowRef = useRef<HTMLDivElement>(null);

  // Un élément retiré sous le focus n'émet pas de blur : l'« Annuler » d'un
  // « Tout lu », retiré quand l'annulation affiche son résultat, laissait le
  // bandeau tenu pour toujours. Le focus n'est plus dedans : il est relâché.
  useEffect(() => {
    if (focused && !rowRef.current?.contains(document.activeElement)) setFocused(false);
  });

  useEffect(() => {
    if (working || held) return;
    const timer = setTimeout(
      () => dismissToast(toast.id),
      toast.action ? WITH_ACTION_MS : PLAIN_MS
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.action, working, held, dismissToast]);

  const part = toast.progress && toast.progress.total > 0
    ? Math.min(100, Math.round((toast.progress.done / toast.progress.total) * 100))
    : 0;

  return (
    <div
      ref={rowRef}
      className="toast"
      data-tone={toast.tone}
      data-working={working ? '' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
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
