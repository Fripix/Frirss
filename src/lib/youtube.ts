export interface YouTubeRef {
  id: string;
  /** Start offset in seconds, when the URL carries one. */
  start?: number;
}

const ID = '[A-Za-z0-9_-]{11}';
const PATTERNS = [
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/(?:embed|shorts|v)/(${ID})`, 'i'),
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/watch\\?(?:[^"']*&)?v=(${ID})`, 'i'),
  new RegExp(`youtu\\.be/(${ID})`, 'i'),
];

/** "90", "1m30s", "1h2m3s" → seconds. */
function parseStart(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const [h, min, s] = m.slice(1).map((v) => Number(v || 0));
  return h * 3600 + min * 60 + s;
}

/** Video id (and start time) for any YouTube URL form, or null. */
export function extractYouTubeId(url: string): YouTubeRef | null {
  if (!url) return null;
  let id: string | null = null;
  for (const re of PATTERNS) {
    const m = url.match(re);
    if (m) { id = m[1]; break; }
  }
  if (!id) return null;
  const t = url.match(/[?&](?:t|start)=([^&"'\s]+)/i);
  const start = parseStart(t ? t[1] : null);
  return start === undefined ? { id } : { id, start };
}

/** Fallback thumbnail, used when the article provides none. */
export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Canonical watch URL, keeping the start time when there is one. */
export function youtubeWatchUrl(ref: YouTubeRef): string {
  const t = ref.start ? `&t=${ref.start}s` : '';
  return `https://www.youtube.com/watch?v=${ref.id}${t}`;
}

/** Labels the facade needs, so the markup is never hard-coded in English. */
export interface FacadeLabels {
  play: string;
  open: string;
}

const escapeAttr = (s: string): string => s.replace(/"/g, '&quot;');

/**
 * Click-to-load placeholder. Built only from tags DOMPurify keeps, so it
 * survives sanitisation — unlike the <iframe> it replaces, which is deleted
 * silently (that is why embedded videos are invisible without this).
 *
 * The play button is deliberately empty: the `html` profile also strips <svg>,
 * and widening the sanitizer for untrusted feed content would be a bad trade
 * for an icon. The button is drawn entirely in CSS; `aria-label` carries the
 * meaning for assistive technology.
 */
export function facadeMarkup(ref: YouTubeRef, thumbnail: string, labels: FacadeLabels): string {
  const start = ref.start ? ` data-yt-start="${ref.start}"` : '';
  return (
    '<div class="yt-facade-wrap">' +
      `<div class="yt-facade" data-yt-id="${escapeAttr(ref.id)}"${start}>` +
        `<img class="yt-facade__thumb" src="${escapeAttr(thumbnail)}" alt="" loading="lazy">` +
        `<button type="button" class="yt-facade__play" aria-label="${escapeAttr(labels.play)}"></button>` +
      '</div>' +
      // Always-present way out: some owners disable embedding entirely, and the
      // failure happens inside a cross-origin frame we cannot inspect.
      `<a class="yt-facade__link" href="${escapeAttr(youtubeWatchUrl(ref))}" target="_blank">` +
        `${escapeAttr(labels.open)}` +
      '</a>' +
    '</div>'
  );
}

const IFRAME_RE = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/iframe>|<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi;
const LINK_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>.*?<\/a>/gi;

/**
 * Turn YouTube iframes and links in article HTML into facades, in place.
 * Must run BEFORE sanitizeHtml — afterwards the iframes no longer exist.
 * Returns the ids found so the caller can avoid showing the same video twice.
 */
export function injectVideoFacades(html: string, labels: FacadeLabels): { html: string; ids: string[] } {
  if (!html) return { html: '', ids: [] };
  const ids: string[] = [];

  const toFacade = (whole: string, url: string): string => {
    const ref = extractYouTubeId(url);
    if (!ref) return whole;
    if (!ids.includes(ref.id)) ids.push(ref.id);
    return facadeMarkup(ref, youtubeThumbnail(ref.id), labels);
  };

  let out = html.replace(IFRAME_RE, (whole, a, b) => toFacade(whole, a || b || ''));
  out = out.replace(LINK_RE, (whole, href) => toFacade(whole, href || ''));
  return { html: out, ids };
}
