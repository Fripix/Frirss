export interface YouTubeRef {
  id: string;
  /** Start offset in seconds, when the URL carries one. */
  start?: number;
}

// ⚠️ Cette contrainte est une garde de sécurité : la façade de tête du volet
// (`headFacadeHtml`) est injectée sans DOMPurify depuis l'adresse de
// l'article. Ne pas l'élargir (`youtube.test.ts`, façade sûre sans assainissement).
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

/**
 * L'adresse mène-t-elle chez YouTube ? Décidé sur l'HÔTE : `extractYouTubeId`
 * trouve une adresse YouTube n'importe où dans la chaîne (souple pour les
 * iframes d'un corps), et une redirection `…?to=https://www.youtube.com/…`
 * passait pour une vidéo (D-02). Accepte une adresse sans schéma (`//youtu.be/…`).
 * Une adresse illisible n'est pas YouTube.
 */
export function isYouTubeHost(url: string): boolean {
  let host: string;
  try { host = new URL(url.startsWith('//') ? `https:${url}` : url).hostname.toLowerCase(); } catch { return false; }
  return host === 'youtu.be'
    || host === 'youtube.com' || host.endsWith('.youtube.com')
    || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
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
const LINK_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
const VIDEO_RE = new RegExp(`${IFRAME_RE.source}|${LINK_RE.source}`, 'gi');

// Tout <iframe>, avec ou sans `src`, fermé ou auto-fermant. Contrairement aux
// deux regexes ci-dessus, celle-ci ne s'applique qu'à la SORTIE de DOMPurify —
// donc à du HTML déjà normalisé et équilibré par un sérialiseur DOM, jamais au
// balisage brut d'un flux.
const ANY_IFRAME_RE = /<iframe\b([^>]*)>(?:[\s\S]*?<\/iframe>)?/gi;
const IFRAME_SRC_RE = /\bsrc\s*=\s*["']([^"']*)["']/i;

/**
 * Ne garde que les <iframe> que la façade sait transformer en lecteur.
 *
 * Le passage d'assainissement de l'extraction (`src/utils/extractContent.ts`)
 * doit accepter les iframes, sans quoi une vidéo intégrée à un article extrait
 * disparaîtrait avant qu'`injectVideoFacades` puisse la voir. Mais l'accepter
 * sans condition revient à ARCHIVER dans IndexedDB du balisage plus large que
 * ce que la moindre vue affiche : `ReadingPane` repasse tout par
 * `sanitizeHtml`, qui supprime les iframes, donc rien ne s'affichait — la
 * sûreté ne tenait qu'au fait que chaque consommateur pense à réassainir.
 * Aligner le stockage sur le contrat d'affichage retire cette dépendance.
 */
export function dropNonVideoIframes(html: string): string {
  if (!html) return '';
  return html.replace(ANY_IFRAME_RE, (whole, attrs: string) => {
    const src = String(attrs).match(IFRAME_SRC_RE)?.[1] ?? '';
    return extractYouTubeId(src) ? whole : '';
  });
}

const THUMB_IMG_RE = /<img\b[^>]*\bsrc=["']https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\/[^"']*["'][^>]*>/gi;

/**
 * Retire du HTML les vignettes de la vidéo `id` (`i.ytimg.com/vi/<id>/…`).
 *
 * Un article de flux YouTube porte dans son contenu FreshRSS la vignette de
 * sa vidéo (`img.enclosure-thumbnail`) ; le volet pose en tête la façade de
 * cette même vidéo, qui a sa propre vignette : l'image apparaissait deux fois
 * (L-08). À appeler AVANT `injectVideoFacades`, dont la façade porte la même
 * URL et doit rester.
 */
export function dropVideoThumbnails(html: string, id: string): string {
  if (!html || !id) return html || '';
  return html.replace(THUMB_IMG_RE, (whole, found: string) => (found === id ? '' : whole));
}

// Bornes d'un bloc : ce qui peut précéder et suivre un lien seul sur sa ligne.
// Lues sur le voisinage du lien seulement (`NEAR`), espaces retirés : jamais
// tout le document à chaque lien.
const BLOCK_BEFORE_RE = /(?:<(?:p|div|li|figure|blockquote|center|h[1-6])\b[^>]*>|<br\s*\/?>)$/i;
const BLOCK_AFTER_RE = /^(?:<\/(?:p|div|li|figure|blockquote|center|h[1-6])>|<br\s*\/?>)/i;
const NEAR = 400;

/**
 * Un lien vers YouTube tient-il lieu de vidéo ? Seulement s'il est SEUL dans
 * son bloc et qu'il ne dit rien d'autre que la vidéo : texte vide, image, ou
 * l'adresse elle-même. Un lien dans une phrase (« — Nilay Patel, The
 * Vergecast », « when they first built PyTorch in 2016 ») est du texte : le
 * remplacer par une façade effaçait ses mots, et deux liens voisins vers la
 * même vidéo donnaient deux façades identiques (A4-06, 1.9.0).
 */
function linkStandsForVideo(href: string, inner: string, doc: string, start: number, end: number): boolean {
  if (!isYouTubeHost(href)) return false;
  const before = doc.slice(Math.max(0, start - NEAR), start).trimEnd();
  const after = doc.slice(end, end + NEAR).trimStart();
  const opens = (start <= NEAR && before === '') || BLOCK_BEFORE_RE.test(before);
  const closes = (end + NEAR >= doc.length && after === '') || BLOCK_AFTER_RE.test(after);
  if (!opens || !closes) return false;
  const text = inner.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
  if (!text) return true; // vide, ou une image seule
  return /^\S+$/.test(text) && isYouTubeHost(text.replace(/&amp;/gi, '&').replace(/^(?!https?:|\/\/)/i, 'https://'));
}

/**
 * Turn YouTube iframes in article HTML into facades, in place — and the links
 * that stand alone for a video (`linkStandsForVideo`); every other link stays
 * a link, with its words. Must run BEFORE sanitizeHtml — afterwards the
 * iframes no longer exist. One facade per video: a later iframe of the same
 * video is dropped, a later link stays a link. Returns the ids turned into
 * facades, so the caller can avoid showing the same video twice.
 */
export function injectVideoFacades(html: string, labels: FacadeLabels): { html: string; ids: string[] } {
  if (!html) return { html: '', ids: [] };
  const ids: string[] = [];

  // UNE passe, dans l'ordre du document. Deux passes successives (iframes,
  // puis liens) faisaient retraiter par la seconde le lien « Ouvrir sur
  // YouTube » que la première venait de poser dans sa façade : deux lecteurs
  // imbriqués pour une seule vidéo (L-07).
  const out = html.replace(VIDEO_RE, (whole: string, a?: string, b?: string, href?: string, inner?: string, offset?: number, str?: string) => {
    const iframe = !href;
    const ref = extractYouTubeId(iframe ? a || b || '' : href);
    if (!ref) return whole;
    if (!iframe) {
      const at = offset ?? 0;
      if (!linkStandsForVideo(href, inner ?? '', str ?? html, at, at + whole.length)) return whole;
    }
    if (ids.includes(ref.id)) return iframe ? '' : whole;
    ids.push(ref.id);
    return facadeMarkup(ref, youtubeThumbnail(ref.id), labels);
  });
  return { html: out, ids };
}
