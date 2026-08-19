import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFeedStore } from '../stores/feedStore';

/**
 * Thin banner pinned to the top of the screen.
 *  • Offline → persistent "reading from cache" notice.
 *  • Back online → brief confirmation, then it slides away.
 * Purely informational; it never blocks interaction with the UI beneath it.
 */
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const { t } = useTranslation();
  const [showBackOnline, setShowBackOnline] = useState(false);
  // Pending / given-up actions made offline, so the user knows nothing is lost.
  const pending = useFeedStore((s) => s.pendingActions);
  const failed = useFeedStore((s) => s.failedActions);
  const wasOffline = useRef(!online);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setShowBackOnline(false);
      return;
    }
    // Back online — only celebrate if we were actually offline before.
    if (wasOffline.current) {
      wasOffline.current = false;
      setShowBackOnline(true);
      const id = setTimeout(() => setShowBackOnline(false), 2500);
      return () => clearTimeout(id);
    }
  }, [online]);

  if (online && !showBackOnline && !failed) return null;

  return (
    <div
      className="offline-banner"
      data-state={online ? 'online' : 'offline'}
      role="status"
      aria-live="polite"
    >
      <span className="offline-banner-dot" />
      {online
        ? (failed
            ? t('connection.syncFailed', { count: failed })
            : t('connection.backOnline'))
        : (pending
            ? `${t('connection.offline')} — ${t('connection.pending', { count: pending })}`
            : t('connection.offline'))}
    </div>
  );
}
