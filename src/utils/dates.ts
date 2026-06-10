import i18n from '../i18n';
import type { Article } from '../types';

export interface DateGroup {
  label: string | null;
  articles: Article[];
}

export function groupByDate(articles: Article[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let currentLabel: string | null = null;
  let currentItems: Article[] = [];

  for (const article of articles) {
    const label = getDateLabel(article.published);
    if (label !== currentLabel) {
      if (currentItems.length > 0) {
        groups.push({ label: currentLabel, articles: currentItems });
      }
      currentLabel = label;
      currentItems = [article];
    } else {
      currentItems.push(article);
    }
  }

  if (currentItems.length > 0) {
    groups.push({ label: currentLabel, articles: currentItems });
  }

  return groups;
}

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const articleDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (articleDate.getTime() === today.getTime()) return i18n.t('dates.today').toUpperCase();
  if (articleDate.getTime() === yesterday.getTime()) return i18n.t('dates.yesterday').toUpperCase();

  const diffDays = Math.floor((today.getTime() - articleDate.getTime()) / 86400000);
  if (diffDays < 7) return formatDay(date);

  const lng = i18n.language || 'fr';
  const locale = lng === 'fr' ? 'fr-FR' : 'en-US';
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDay(date: Date): string {
  const key = dayKeys[date.getDay()];
  return i18n.t(`dates.${key}`).toUpperCase();
}
