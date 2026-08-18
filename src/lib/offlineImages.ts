import type { Article } from '../types';

const MB = 1024 * 1024;
const CUSTOM_MIN_MB = 50;
const CUSTOM_MAX_MB = 5000;

/** How much offline image data to keep, and how many images per article. */
export type OfflineImagePreset = 'none' | 'light' | 'standard' | 'max' | 'custom';

export interface ImageBudget {
  /** Approximate byte budget — enforced against navigator.storage estimates. */
  bytes: number;
  /** Images downloaded per article (1 = thumbnail only). */
  perArticle: number;
}

export function imageBudget(preset: OfflineImagePreset, customMb: number): ImageBudget {
  switch (preset) {
    case 'none':
      return { bytes: 0, perArticle: 0 };
    case 'light':
      return { bytes: 200 * MB, perArticle: 1 };
    case 'max':
      return { bytes: 1000 * MB, perArticle: 10 };
    case 'custom': {
      const mb = Math.min(CUSTOM_MAX_MB, Math.max(CUSTOM_MIN_MB, Math.round(customMb) || 0));
      return { bytes: mb * MB, perArticle: 6 };
    }
    case 'standard':
    default:
      return { bytes: 500 * MB, perArticle: 6 };
  }
}

/**
 * Absolute image URLs found in a fragment of article HTML, de-duplicated and
 * capped. Relative and data: sources are skipped — only what a browser would
 * fetch over the network is worth pre-caching.
 */
export function collectImageUrls(html: string, limit: number): string[] {
  if (!html || limit <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (!/^https?:\/\//i.test(src) || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Fill order when the budget runs out: things the user deliberately kept
 * (read-later, starred), then unread newest-first, then everything else.
 */
export function prioritizeForOffline(articles: Article[], readLaterLabel: string): Article[] {
  const rank = (a: Article): number => {
    if (a.starred || a.labels?.includes(readLaterLabel)) return 0;
    if (!a.read) return 1;
    return 2;
  };
  return [...articles].sort((a, b) => rank(a) - rank(b) || b.published - a.published);
}
