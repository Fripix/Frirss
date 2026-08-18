import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';

const SHOW_MS = 5000;

/**
 * Transient banner shown after a manual refresh: "X new articles" (or "Up to
 * date"). Auto-clears the store's refreshResult after a few seconds, which also
 * ends the per-feed pulse in the sidebar. Purely informational.
 */
export default function RefreshBanner() {
  const { t } = useTranslation();
  const refreshResult = useFeedStore((s) => s.refreshResult);
  const clearRefreshResult = useFeedStore((s) => s.clearRefreshResult);

  useEffect(() => {
    if (!refreshResult) return;
    const id = setTimeout(clearRefreshResult, SHOW_MS);
    return () => clearTimeout(id);
  }, [refreshResult, clearRefreshResult]);

  if (!refreshResult) return null;

  const hasNew = refreshResult.totalNew > 0;

  return (
    <div className="refresh-banner" role="status" aria-live="polite">
      <svg
        className="refresh-banner__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {hasNew ? (
          // "sparkle / new" mark
          <path d="M12 3v18M3 12h18" />
        ) : (
          // check mark
          <path d="M5 13l4 4L19 7" />
        )}
      </svg>
      <span>
        {hasNew
          ? t('refresh.newArticles', { count: refreshResult.totalNew })
          : t('refresh.upToDate')}
      </span>
    </div>
  );
}
