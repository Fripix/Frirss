import { useFeedStore } from '../stores/feedStore';

/**
 * Thin indeterminate progress bar pinned to the very top of the viewport,
 * shown while the initial subscriptions/counts load is revalidating. Most
 * visible on a cold start right after a service-worker update, when every
 * in-memory cache is empty and the sidebar is being repopulated. Purely
 * informational — it never blocks the UI beneath it.
 */
export default function TopProgressBar() {
  const syncing = useFeedStore((s) => s.syncing);
  if (!syncing) return null;
  return <div className="top-progress" role="progressbar" aria-label="Loading" aria-busy="true" />;
}
