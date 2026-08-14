import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Let the overlay be visible for a beat before the reload, so the update isn't
// a silent, jarring refresh — the user sees "Updating…" then lands on the new
// version. Kept short so it never feels like a wait.
const REVEAL_MS = 700;

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
    const id = setTimeout(() => {
      // skipWaiting → activate the new SW → reload to the new version.
      updateServiceWorker(true);
    }, REVEAL_MS);
    return () => clearTimeout(id);
  }, [needRefresh, updateServiceWorker]);

  if (!needRefresh) return null;

  return (
    <div className="update-overlay" role="status" aria-live="polite">
      <span className="update-overlay-label">{t('update.updating')}</span>
      <span className="update-overlay-bar" />
    </div>
  );
}
