import type { Article } from '../types';

const MB = 1024 * 1024;

/** Sizeable presets, in display order. 'none' is the off switch, not a size. */
export const OFFLINE_IMAGE_PRESETS = ['light', 'standard', 'max'] as const;

export type OfflineImageSized = (typeof OFFLINE_IMAGE_PRESETS)[number];
export type OfflineImagePreset = 'none' | OfflineImageSized;

/** User edits, in Mo, keyed by preset. Absent = follow the device-derived default. */
export type OfflineImageSizes = Partial<Record<OfflineImageSized, number>>;

export interface ImageBudget {
  /** Approximate byte budget — enforced against navigator.storage estimates. */
  bytes: number;
  /** Images downloaded per article (1 = thumbnail only). */
  perArticle: number;
}

/** An edited value is still kept within something the browser can hold. */
const EDIT_MIN_MB = 50;
const EDIT_MAX_MB = 20480;

// Share of the device quota each preset targets, with floor/ceiling so a tiny
// or enormous quota still yields a sensible number.
const SHAPE: Record<OfflineImageSized, { share: number; minMb: number; maxMb: number; fallbackMb: number; perArticle: number }> = {
  light:    { share: 0.10, minMb: 100, maxMb: 2048,  fallbackMb: 200,  perArticle: 1 },
  standard: { share: 0.25, minMb: 250, maxMb: 5120,  fallbackMb: 500,  perArticle: 6 },
  max:      { share: 0.50, minMb: 500, maxMb: 10240, fallbackMb: 1024, perArticle: 10 },
};

const roundTo50 = (mb: number): number => Math.round(mb / 50) * 50;

/**
 * Guard against sizes persisted by an older version (localStorage outlives the
 * code — 'custom' existed once and would otherwise crash the whole tab).
 */
function shapeOf(preset: OfflineImageSized) {
  return SHAPE[preset] ?? SHAPE.standard;
}

/**
 * Suggested size for a preset on this device, in Mo. Derived from the quota the
 * browser reports so the presets mean something on a phone as well as on a
 * desktop; falls back to fixed values when the quota is unknown.
 */
export function defaultPresetMb(preset: OfflineImageSized, quotaBytes: number): number {
  const s = shapeOf(preset);
  if (!quotaBytes || quotaBytes <= 0) return s.fallbackMb;
  const raw = (quotaBytes * s.share) / MB;
  return Math.min(s.maxMb, Math.max(s.minMb, roundTo50(raw)));
}

/**
 * Budget in effect: the user's edited size for this preset when there is one,
 * otherwise the device-derived suggestion.
 */
export function imageBudget(
  preset: OfflineImagePreset,
  sizes: OfflineImageSizes,
  quotaBytes: number,
): ImageBudget {
  if (preset === 'none') return { bytes: 0, perArticle: 0 };
  const s = shapeOf(preset);
  const edited = sizes[preset];
  const mb = edited
    ? Math.min(EDIT_MAX_MB, Math.max(EDIT_MIN_MB, Math.round(edited)))
    : defaultPresetMb(preset, quotaBytes);
  return { bytes: mb * MB, perArticle: s.perArticle };
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
 * Image URLs worth caching for one article: the RSS thumbnail first (it is what
 * the list and the grid render), then body images from the extracted content.
 *
 * Used by the manual offline sweep (`feedStore.prepareOffline`), its only
 * caller today. It lives here rather than inside the store so the choice of
 * images is testable on its own, and so a second consumer cannot grow a
 * duplicate that drifts.
 */
export function articleImageUrls(
  rssHtml: string,
  extractedHtml: string | null,
  perArticle: number,
): string[] {
  if (perArticle <= 0) return [];
  const thumb = collectImageUrls(rssHtml, 1);
  if (perArticle === 1) return thumb;
  const body = collectImageUrls(extractedHtml || rssHtml, perArticle);
  return Array.from(new Set([...thumb, ...body])).slice(0, perArticle);
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
