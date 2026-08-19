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

const escapeAttr = (s: string): string => s.replace(/"/g, '&quot;');

/**
 * Click-to-load placeholder. Built only from tags DOMPurify keeps, so it
 * survives sanitisation — unlike the <iframe> it replaces, which is deleted
 * silently (that is why embedded videos are invisible without this).
 */
export function facadeMarkup(ref: YouTubeRef, thumbnail: string, playLabel: string): string {
  const start = ref.start ? ` data-yt-start="${ref.start}"` : '';
  return (
    `<div class="yt-facade" data-yt-id="${escapeAttr(ref.id)}"${start}>` +
      `<img class="yt-facade__thumb" src="${escapeAttr(thumbnail)}" alt="" loading="lazy">` +
      `<button type="button" class="yt-facade__play" aria-label="${escapeAttr(playLabel)}">` +
        '<svg viewBox="0 0 68 48" aria-hidden="true" focusable="false">' +
          '<path class="yt-facade__bg" d="M66.5 7.7a8 8 0 0 0-5.6-5.7C56 .7 34 .7 34 .7s-22 0-26.9 1.3a8 8 0 0 0-5.6 5.7A83 83 0 0 0 .5 24a83 83 0 0 0 1 16.3 8 8 0 0 0 5.6 5.7C12 47.3 34 47.3 34 47.3s22 0 26.9-1.3a8 8 0 0 0 5.6-5.7A83 83 0 0 0 67.5 24a83 83 0 0 0-1-16.3z"/>' +
          '<path class="yt-facade__arrow" d="M45 24 27 14v20z"/>' +
        '</svg>' +
      '</button>' +
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
export function injectVideoFacades(html: string): { html: string; ids: string[] } {
  if (!html) return { html: '', ids: [] };
  const ids: string[] = [];

  const toFacade = (whole: string, url: string): string => {
    const ref = extractYouTubeId(url);
    if (!ref) return whole;
    if (!ids.includes(ref.id)) ids.push(ref.id);
    return facadeMarkup(ref, youtubeThumbnail(ref.id), 'Play');
  };

  let out = html.replace(IFRAME_RE, (whole, a, b) => toFacade(whole, a || b || ''));
  out = out.replace(LINK_RE, (whole, href) => toFacade(whole, href || ''));
  return { html: out, ids };
}
