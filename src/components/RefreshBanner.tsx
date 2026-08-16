import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';

const SHOW_MS = 4000;

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

  return (
    <div className="refresh-banner" role="status" aria-live="polite">
      {refreshResult.totalNew > 0
        ? t('refresh.newArticles', { count: refreshResult.totalNew })
        : t('refresh.upToDate')}
    </div>
  );
}
