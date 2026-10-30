import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Let the overlay be visible for a beat before the reload, so the update isn't
// a silent, jarring refresh — the user sees "Updating…" then lands on the new
// version. Kept short so it never feels like a wait.
const REVEAL_MS = 700;

/**
 * Filet : le rechargement attend que le nouveau service worker prenne la main.
 * Une page rechargée pendant `REVEAL_MS` peut trouver ce service worker déjà
 * actif : l'événement attendu ne vient plus, et le rideau restait affiché pour
 * toujours. Passé ce délai, la page se recharge d'elle-même ; le nouveau
 * service worker la sert alors.
 */
export const UPDATE_RELOAD_FALLBACK_MS = 5000;

/**
 * Service-worker update handler. With `registerType: 'prompt'`, a freshly
 * installed version surfaces via `needRefresh`; instead of prompting, we keep
 * FriRSS auto-updating but show a brief "Updating…" curtain and then reload
 * into the new version. First installs (offline-ready) show nothing.
 */
export default function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const id = setTimeout(() => {
      // skipWaiting → activate the new SW → reload to the new version.
      void updateServiceWorker(true);
      fallback = setTimeout(() => window.location.reload(), UPDATE_RELOAD_FALLBACK_MS);
    }, REVEAL_MS);
    return () => { clearTimeout(id); if (fallback) clearTimeout(fallback); };
  }, [needRefresh, updateServiceWorker]);

  // La région annoncée reste montée, vide au repos : montée avec son texte,
  // elle n'était souvent pas lue (liveRegions.test).
  const region = <div className="sr-only" role="status" aria-live="polite">{needRefresh ? t('update.updating') : ''}</div>;
  if (!needRefresh) return region;

  return (
    <>
      {region}
      <div className="update-overlay" aria-hidden="true">
        <span className="update-overlay-label">{t('update.updating')}</span>
        <span className="update-overlay-bar" />
      </div>
    </>
  );
}
