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
  // FreshRSS (pas FriRSS) a refusé le rejeu : la file attend, entière. Sans
  // ce mot, rien ne disait pourquoi elle ne partait pas. La phrase dit ce qui
  // se passe, ce qu'il advient des actions, et où ressaisir le mot de passe
  // API (« Changer le mot de passe API », dans la ligne du serveur), sans
  // affirmer que c'est la cause.
  const refused = useFeedStore((s) => s.replayRefusedByServer);
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

  const text = online
    ? (refused
        ? t('connection.refusedByServer')
        : failed
          ? t('connection.syncFailed', { count: failed })
          : showBackOnline ? t('connection.backOnline') : '')
    : (pending
        ? `${t('connection.offline')} — ${t('connection.pending', { count: pending })}`
        : t('connection.offline'));

  // La région annoncée reste montée, vide au repos : montée avec son texte,
  // elle n'était souvent pas lue. Le bandeau visible ne fait que la doubler.
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{text}</div>
      {text && (
        <div
          className="offline-banner"
          data-state={online ? 'online' : 'offline'}
          aria-hidden="true"
        >
          <span className="offline-banner-dot" />
          {text}
        </div>
      )}
    </>
  );
}
