import { useEffect, useState } from 'react';

/**
 * Track the browser's online/offline status.
 *
 * Seeds from `navigator.onLine` and updates on the window `online` / `offline`
 * events. SSR-safe (assumes online when `navigator` is unavailable).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
