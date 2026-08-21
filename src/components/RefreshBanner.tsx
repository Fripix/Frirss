import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';
import { useThemeStore } from '../stores/themeStore';
import { useUiStore } from '../stores/uiStore';

const SHOW_MS = 5000;

/**
 * Transient banner shown after a refresh. While a real (server-side) refresh is
 * running it stays up and counts articles as they land; once the job resolves it
 * behaves like before and auto-clears.
 */
export default function RefreshBanner() {
  const { t } = useTranslation();
  const refreshResult = useFeedStore((s) => s.refreshResult);
  const refreshPhase = useFeedStore((s) => s.refreshPhase);
  const hasRefreshToken = useFeedStore((s) => s.hasRefreshToken);
  const clearRefreshResult = useFeedStore((s) => s.clearRefreshResult);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const refreshHintDismissed = useUiStore((s) => s.refreshHintDismissed);
  const dismissRefreshHint = useUiStore((s) => s.dismissRefreshHint);

  const running = refreshPhase === 'running';
  // Offered once: no token, nothing in flight, and not already waved away.
  const showHint = !hasRefreshToken && !running && !refreshHintDismissed;

  useEffect(() => {
    if (!refreshResult || running) return;   // don't dismiss a refresh in progress
    const id = setTimeout(clearRefreshResult, SHOW_MS);
    return () => clearTimeout(id);
  }, [refreshResult, running, clearRefreshResult]);

  if (!refreshResult) return null;

  const hasNew = refreshResult.totalNew > 0;
  const count = t('refresh.newArticles', { count: refreshResult.totalNew });

  let label: string;
  if (running) label = hasNew ? `${t('refresh.inProgress')} ${count}` : t('refresh.inProgress');
  else if (refreshPhase === 'failed') label = t('refresh.failed');
  else if (refreshPhase === 'timeout') label = hasNew ? count : t('refresh.incomplete');
  else label = hasNew ? count : t('refresh.upToDate');

  return (
    <div
      className={`refresh-banner${running ? ' refresh-banner--running' : ''}`}
      role="status"
      aria-live="polite"
    >
      <svg
        className={`refresh-banner__icon${running ? ' refresh-banner__icon--spin' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {running ? (
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        ) : hasNew ? (
          <path d="M12 3v18M3 12h18" />
        ) : (
          <path d="M5 13l4 4L19 7" />
        )}
      </svg>
      <span>{label}</span>
      {showHint && (
        <>
          <button
            type="button"
            className="refresh-banner__action"
            onClick={() => openPreferences('feeds')}
          >
            {t('refresh.enable')}
          </button>
          <button
            type="button"
            className="refresh-banner__action"
            aria-label={t('app.close')}
            onClick={dismissRefreshHint}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
