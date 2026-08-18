import type { TFunction } from 'i18next';

/** Relative "x minutes/hours/days ago" label for a published timestamp. */
export function timeAgo(timestamp: number, t: TFunction): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  const days = Math.floor(hours / 24);
  return t('time.days', { count: days });
}
