// Le corps d'article tel que le volet de lecture l'injecte : une seule
// fonction, de bout en bout, pour que la chaîne cesse d'être recalculée à
// chaque rendu — et surtout pour qu'elle soit **stable**.
//
// ⚠️ Pourquoi la stabilité compte autant que le contenu.
// `dangerouslySetInnerHTML={{ __html: … }}` écrit un objet NEUF à chaque
// rendu. React 19 ne compare plus `__html` : sa boucle de mise à jour
// n'écarte une prop que si `nextProp === lastProp` (identité), puis
// `setProp` affecte `domElement.innerHTML` sans condition. Un objet neuf
// suffit donc à reconstruire tout le corps de l'article — chaque <img> est
// détruite puis recréée, et redevient blanche le temps de se recharger.
// Le volet re-rendait à chaque événement de défilement : d'où le
// clignotement violent observé en PWA iOS. React 18 comparait la chaîne et
// masquait le défaut ; la 1.4.5 (passage à React 19) l'a rendu réel.
//
// Le contrat de ce module : mêmes entrées → même résultat, et l'appelant
// mémoïse. Rien ici ne connaît React.

import { sanitizeArticleBody } from '../utils/sanitizeHtml';
import { articleVideoRef, dropVideoThumbnails, injectVideoFacades, type FacadeLabels } from './youtube';
import { extractShown, hasRenderableContent } from './readingBody';
import { imageIdentity } from './imageIdentity';

/** Combien d'images du début échappent au chargement différé. Les premières
 *  doivent être là *avant* la transition de balayage, pas après. */
const EAGER_IMAGES = 2;

/** Mots lus par minute — le chiffre affiché sur la pastille « x min ». */
const WORDS_PER_MINUTE = 200;

export interface ArticleBodyInput {
  /** HTML du flux RSS. Porte souvent l'image d'en-tête que l'extraction perd. */
  rssHtml?: string | null;
  /** HTML extrait (« contenu complet »), ou `null` tant qu'il n'existe pas. */
  extractedHtml?: string | null;
  /** Réglage « vidéos en ligne » : injecte les façades YouTube. */
  inlineVideos: boolean;
  videoLabels: FacadeLabels;
  /**
   * Adresse de l'article. Quand c'est une vidéo YouTube et que les façades
   * sont actives, le volet en pose une en tête : la vignette de cette vidéo,
   * que FreshRSS met dans le contenu, est alors retirée du corps (L-08).
   */
  videoUrl?: string | null;
  /** Le lecteur a demandé l'article complet : la garde L-04 ne s'applique pas. */
  extractForced?: boolean;
}

export interface ArticleBody {
  /** HTML prêt à injecter : assaini, images différées, direction par bloc. */
  html: string;
  /** Identifiants des vidéos déjà présentes dans le corps. */
  videoIds: string[];
  /** Mots du contenu affiché — base de la durée de lecture. */
  words: number;
}

/**
 * Le contenu réellement affiché : l'extraction quand elle existe, le flux
 * sinon. L'image d'en-tête du flux est réinjectée si l'extraction l'a perdue
 * — Readability écarte souvent l'illustration principale, et l'article
 * arrivait alors amputé de sa seule image. « Perdue » se juge à la taille
 * près (`imageIdentity`, REG-227) : Frandroid donne au flux la photo en
 * `?resize=1200,675` et à la page en `?resize=1200`, et le volet la montrait
 * deux fois.
 */
export function displayedHtml(
  rssHtml?: string | null,
  extractedHtml?: string | null,
  opts: { forced?: boolean } = {},
): string {
  if (!extractedHtml) return rssHtml || '';
  // Un extrait qui n'a pas la moitié du texte du flux est un morceau de la
  // page, pas l'article complet (L-04) : même règle que `readingBodyKind`,
  // `extractShown`. Sauf si le lecteur l'a demandé (`forced`).
  if (hasRenderableContent(extractedHtml) && !extractShown(rssHtml, extractedHtml, opts.forced)) return rssHtml || '';
  const imgMatch = rssHtml?.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && !extractedHtml.includes(imgMatch[1]) && !holdsImage(extractedHtml, imgMatch[1]) && !opensOnImage(extractedHtml)) {
    return `<img src="${imgMatch[1].replace(/"/g, '&quot;')}" alt="" />` + extractedHtml;
  }
  return extractedHtml;
}

/** `&amp;` et ses voisines, dans une valeur d'attribut lue telle quelle. */
const unescapeAttr = (value: string) => value.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&quot;/gi, '"');

/**
 * L'extrait montre-t-il déjà l'image `src` ? À la taille près (REG-227), par
 * son `src` ou une adresse de son `srcset` (un autre hôte, celui de la page, y
 * porte souvent les tailles de la même photo) ; ou sous une autre adresse de
 * la même photo (`sameLeadPhoto`, REG-245).
 */
function holdsImage(html: string, src: string): boolean {
  const raw = unescapeAttr(src);
  const wanted = imageIdentity(raw);
  if (!wanted) return false;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    for (const attr of tag.matchAll(/\s(?:src|srcset|data-src|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = unescapeAttr(attr[1] ?? attr[2] ?? '');
      const candidates = /\ssrcset|data-srcset/i.test(attr[0]) ? value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [value];
      if (candidates.some((c) => imageIdentity(c) === wanted || sameLeadPhoto(c, raw))) return true;
    }
  }
  return false;
}

// ── L'image d'en-tête du flux, en double (REG-245) ───────────────────
// The Verge donne au flux la photo d'en-tête dans un autre recadrage que la
// page (`?crop=0,0,100,100` contre `?crop=9.17,0,89.7,74.4&w=376`), Clubic
// sous une autre adresse (`/v1/images/2471365/raw` contre
// `/b7c53e582471365/1600x900/smart/…`) : à la taille près, ce sont deux
// images, et le volet remettait celle du flux au-dessus de celle de l'extrait.
// Deux règles, pour CE SEUL usage (l'identité stricte de `imageIdentity`,
// qui décide des doublons de l'extraction, ne change pas) :
// - l'extrait OUVRE sur une image (`opensOnImage`) : c'est son image
//   d'en-tête, celle de l'article — celle du flux n'est pas remise, même une
//   autre photo (une vignette carrée du flux ne remplace pas la photo de la
//   page) ;
// - l'extrait porte la même photo (`sameLeadPhoto`) : même hôte, et même
//   chemin aux paramètres près (recadrage), ou un même numéro d'image dans le
//   chemin (six chiffres au moins, l'un finissant l'autre ; pas une date).

/** Blocs de texte au-delà desquels une image n'est plus l'image d'en-tête. */
const LEAD_TEXT_BLOCKS = 3;
/** Une image déclarée plus petite que ceci est une icône (avatar de l'auteur). */
const LEAD_ICON_MAX = 100;
const LEAD_ICON_NAME = /avatar|author|logo|icon|emoji/i;

/** Une image qui n'est pas une icône : ni petite (taille déclarée), ni un avatar ou un logo. */
function photoTag(tag: string): boolean {
  for (const name of ['width', 'height']) {
    const size = parseInt(new RegExp(`\\s${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(tag)?.[1] ?? '', 10);
    if (Number.isFinite(size) && size > 0 && size < LEAD_ICON_MAX) return false;
  }
  const said = /\s(?:alt|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of tag.matchAll(said)) if (LEAD_ICON_NAME.test(m[1] ?? m[2] ?? '')) return false;
  const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return !LEAD_ICON_NAME.test((src?.[1] ?? src?.[2] ?? '').split('?')[0]);
}

/** L'extrait montre-t-il une photo avant son `LEAD_TEXT_BLOCKS`-ième bloc de texte ? */
export function opensOnImage(html: string): boolean {
  let blocks = 0;
  for (const m of html.matchAll(/<img\b[^>]*>|<\/(?:p|h[1-6]|li|blockquote)\s*>|<(p|h[1-6]|li|blockquote)\b[^>]*>([^<]*)/gi)) {
    if (m[0].startsWith('<img')) {
      if (photoTag(m[0])) return true;
      continue;
    }
    // Un bloc compte quand il s'ouvre sur du texte : `<p><a><img></a></p>` n'en est pas un.
    if (m[1] && m[2].replace(/&nbsp;/gi, ' ').trim() && ++blocks >= LEAD_TEXT_BLOCKS) return false;
  }
  return false;
}

/** Un numéro de 8 chiffres qui est une date (`20261107`) ne désigne pas une image. */
const DATE_LIKE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;
const ID_MIN_DIGITS = 6;
/** Paramètres de recadrage, de taille et de format : la même photo autrement servie. */
const FRAMING_PARAMS = new Set(['crop', 'rect', 'strip', 'gravity', 'focus', 'fit', 'format', 'fm', 'auto', 'w', 'h', 'width', 'height', 'resize', 'quality', 'q', 'dpr', 'key', 'sig', 'signature', 'hash']);

/** `a` et `b` sont-elles la même photo, sous deux adresses du même hôte ? */
export function sameLeadPhoto(a: string, b: string): boolean {
  let ua: URL;
  let ub: URL;
  try { ua = new URL(a); ub = new URL(b); } catch { return false; }
  const host = (u: URL) => u.host.toLowerCase().replace(/^www\./, '');
  if (host(ua) !== host(ub)) return false;
  const path = (u: URL) => u.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '');
  // Hors recadrage, taille et format, la requête désigne l'image (`image.php?id=2`).
  const query = (u: URL) => [...u.searchParams].filter(([key]) => !FRAMING_PARAMS.has(key.toLowerCase())).map(([k, v]) => `${k}=${v}`).sort().join('&');
  if (path(ua) === path(ub) && query(ua) === query(ub)) return true;
  const ids = (u: URL) => (u.pathname.match(/\d+/g) ?? []).filter((run) => run.length >= ID_MIN_DIGITS && !DATE_LIKE.test(run));
  const mine = ids(ub);
  return ids(ua).some((run) => mine.some((other) => {
    const [short, long] = run.length <= other.length ? [run, other] : [other, run];
    return long.endsWith(short);
  }));
}

/** Durée de lecture en minutes, jamais inférieure à 1. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * La chaîne complète, dans l'ordre où elle doit tourner :
 *
 *  1. choisir le contenu (extrait ou flux, image d'en-tête préservée) ;
 *  2. injecter les façades vidéo **avant** l'assainissement — DOMPurify
 *     supprime les <iframe>, c'est pour ça que les vidéos embarquées sont
 *     invisibles sans cette étape ;
 *  3. assainir (scripts, gestionnaires d'événements, `javascript:`) et, sur
 *     l'arbre assaini, différer le chargement de toutes les images sauf les
 *     deux premières, donner sa direction à chaque bloc — un paragraphe
 *     arabe ou hébreu se lit de droite à gauche même dans un article qui, lui,
 *     va de gauche à droite —, réserver la place des images
 *     (`reserveImgAspect`, `imageAspect.ts`) et retirer les paragraphes vides.
 */
export function buildArticleBody(input: ArticleBodyInput): ArticleBody {
  const displayed = displayedHtml(input.rssHtml, input.extractedHtml, { forced: input.extractForced });
  const words = displayed.replace(/<[^<>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

  const headVideo = input.inlineVideos ? articleVideoRef(input.videoUrl || '') : null;
  const shown = headVideo ? dropVideoThumbnails(displayed, headVideo.id) : displayed;
  const withVideos = input.inlineVideos
    ? injectVideoFacades(shown, input.videoLabels)
    : { html: displayed, ids: [] as string[] };

  // Images différées, `dir="auto"`, format réservé et paragraphes vides : tout
  // se fait sur l'arbre assaini, rien par motif sur la chaîne (voir
  // `sanitizeArticleBody`).
  const html = sanitizeArticleBody(withVideos.html, EAGER_IMAGES);

  return { html, videoIds: withVideos.ids, words };
}
