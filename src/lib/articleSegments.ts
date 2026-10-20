// Découpage d'un article en segments traduisibles, et réinjection des
// traductions. Module pur (DOM du navigateur uniquement) : le serveur traduit
// des segments numérotés, le client garde la main sur le DOM.

export const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, dt, dd';

export interface Segmented {
  /** Segment 0 = le titre ; les suivants = HTML interne des blocs feuilles. */
  segments: string[];
  /** Réinjecte les traductions (même indices que `segments`) après `sanitize` ;
   *  rend le HTML du corps. Le titre traduit est `translated[0]`, à part. */
  apply: (translated: string[], sanitize: (html: string) => string) => string;
}

const HAS_LETTER = /\p{L}/u;

/** Blocs feuilles, en ordre du document : sans autre bloc dedans, hors `pre`,
 *  avec au moins une lettre. */
function leafBlocks(root: Element): Element[] {
  return Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => !el.closest('pre') && !el.querySelector(BLOCK_SELECTOR) && HAS_LETTER.test(el.textContent ?? ''),
  );
}

export function segmentArticle(title: string, html: string): Segmented {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const segments = [title, ...leafBlocks(body).map((el) => el.innerHTML)];
  return {
    segments,
    apply(translated, sanitize) {
      const copy = body.cloneNode(true) as HTMLElement;
      leafBlocks(copy).forEach((el, i) => {
        const text = translated[i + 1];
        if (text !== undefined) el.innerHTML = sanitize(text);
      });
      return copy.innerHTML;
    },
  };
}

export function wordCount(html: string): number {
  const text = html.replace(/<[^>]*>/g, '').trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Regroupe des indices consécutifs en lots (mots ≤ maxWords, octets UTF-8 ≤
 *  maxBytes). Un segment à lui seul plus lourd que maxBytes n'entre dans aucun
 *  lot (« traduit en partie »). */
export function batchSegments(segments: string[], maxWords = 1200, maxBytes = 200_000): number[][] {
  const encoder = new TextEncoder();
  const batches: number[][] = [];
  let current: number[] = [];
  let words = 0;
  let bytes = 0;
  segments.forEach((segment, i) => {
    const w = wordCount(segment);
    const b = encoder.encode(segment).length;
    if (b > maxBytes) return;
    if (current.length && (words + w > maxWords || bytes + b > maxBytes)) {
      batches.push(current);
      current = [];
      words = 0;
      bytes = 0;
    }
    current.push(i);
    words += w;
    bytes += b;
  });
  if (current.length) batches.push(current);
  return batches;
}
