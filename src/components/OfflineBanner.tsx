import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

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

  if (online && !showBackOnline) return null;

  return (
    <div
      className="offline-banner"
      data-state={online ? 'online' : 'offline'}
      role="status"
      aria-live="polite"
    >
      <span className="offline-banner-dot" />
      {online ? t('connection.backOnline') : t('connection.offline')}
    </div>
  );
}
