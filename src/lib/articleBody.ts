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
 * la même photo (`sameLeadPhoto`, REG-245) : même chemin hors recadrage, ou le
 * numéro de l'image — porté par UNE seule image de l'extrait (RM-01).
 */
function holdsImage(html: string, src: string): boolean {
  const raw = unescapeAttr(src);
  const wanted = imageIdentity(raw);
  if (!wanted) return false;
  const byNumber = new Set<string>();
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    for (const attr of tag.matchAll(/\s(?:src|srcset|data-src|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = unescapeAttr(attr[1] ?? attr[2] ?? '');
      const candidates = /\ssrcset|data-srcset/i.test(attr[0]) ? value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [value];
      for (const c of candidates) {
        if (imageIdentity(c) === wanted) return true;
        const same = sameLeadPhoto(c, raw);
        if (same === 'path') return true;
        if (same === 'number') byNumber.add(imageIdentity(c) ?? c);
      }
    }
  }
  // Deux images de l'extrait portent le numéro : c'est celui d'un dossier, pas de la photo.
  return byNumber.size === 1;
}

// ── L'image d'en-tête du flux, en double (REG-245) ───────────────────
// The Verge donne au flux la photo d'en-tête dans un autre recadrage que la
// page (`?crop=0,0,100,100` contre `?crop=9.17,0,89.7,74.4&w=376`), Clubic
// sous une autre adresse (`/v1/images/2471365/raw` contre
// `/b7c53e582471365/1600x900/smart/…`) : à la taille près, ce sont deux
// images, et le volet remettait celle du flux au-dessus de celle de l'extrait.
// Deux règles, pour CE SEUL usage (l'identité stricte de `imageIdentity`,
// qui décide des doublons de l'extraction, ne change pas) :
// - l'extrait OUVRE sur une photo (`opensOnImage`) : c'est son image
//   d'en-tête, celle de l'article — celle du flux n'est pas remise, même une
//   autre photo (une vignette carrée du flux ne remplace pas la photo de la
//   page). Un bloc compte pour son texte VISIBLE, quelle que soit sa première
//   balise (`<p><strong>`, `<p><span>`, `<div>` : RM-03), s'il en porte au
//   moins 20 caractères (une date, « | », une signature n'en sont pas) ; une photo a une
//   taille connue d'au moins 100 px (attributs, `srcset` à largeurs, taille
//   dans l'adresse) — ni un pixel de suivi, ni un logo `.svg`, ni un avatar ;
// - l'extrait porte la même photo (`sameLeadPhoto`) : même hôte, et même
//   chemin aux paramètres près (recadrage) et au suffixe de taille et de
//   recadrage près (`-1200x675`, `__1200_678__8-48-2066-1208` de Les
//   Numériques, REG-247), ou le NUMÉRO DE L'IMAGE du flux
//   (après `images/`, ou le dernier nombre de son nom de fichier : six
//   chiffres au moins, ni une date, ni une heure, ni un horodatage) à la fin
//   d'un nombre de l'adresse de l'extrait — et d'une seule de ses images.
//   Un numéro de dossier (l'article chez Les Numériques, le site chez
//   Squarespace, `v<horodatage>` chez Cloudinary) est commun à toutes les
//   photos de l'article : la photo du flux que l'extrait n'avait pas n'était
//   plus remise (RM-01). Dans le doute, elle est remise : un doublon vaut
//   mieux qu'une perte.

/** Blocs de texte au-delà desquels une image n'est plus l'image d'en-tête. */
const LEAD_TEXT_BLOCKS = 3;
/** Un bloc plus court (une date, « | », une signature) n'en est pas un. */
const LEAD_TEXT_MIN = 20;
/** Une photo a une taille connue d'au moins ceci (en deçà : icône, avatar, pixel). */
const LEAD_ICON_MAX = 100;
const LEAD_ICON_NAME = /avatar|author|logo|icon|emoji|pixel|tracking|beacon/i;
/** Fins et débuts de bloc : un texte de bloc se compte entre deux d'entre eux. */
const LEAD_BLOCK_TAG = /^(?:p|h[1-6]|li|blockquote|div|figcaption|section|article|header|ul|ol|dl|dt|dd|table|tr|td|th|figure|pre)$/i;

/** La plus grande taille connue d'une image (attributs, `srcset` à largeurs, adresse), ou `null`. */
function knownSize(tag: string, address: string): number | null {
  const sizes: number[] = [];
  for (const name of ['width', 'height']) {
    const size = parseInt(new RegExp(`\\s${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(tag)?.[1] ?? '', 10);
    if (Number.isFinite(size) && size > 0) {
      if (size < LEAD_ICON_MAX) return size;
      sizes.push(size);
    }
  }
  const srcset = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  for (const m of (srcset?.[1] ?? srcset?.[2] ?? '').matchAll(/\s(\d+)w(?:\s*,|\s*$)/g)) sizes.push(Number(m[1]));
  const inAddress = /\/(\d{2,4})x(\d{2,4})\/|[-_](\d{2,4})x(\d{2,4})(?=[._])|__(\d{2,4})_(\d{2,4})|[?&](?:w|width)=(\d{2,4})|[./]width-(\d{2,4})\b/i.exec(address);
  if (inAddress) sizes.push(...inAddress.slice(1).filter(Boolean).map(Number));
  return sizes.length ? Math.max(...sizes) : null;
}

/** Une photo : ni icône, logo, avatar ou pixel de suivi, et d'une taille connue d'au moins 100 px. */
function photoTag(tag: string): boolean {
  const said = /\s(?:alt|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const m of tag.matchAll(said)) if (LEAD_ICON_NAME.test(m[1] ?? m[2] ?? '')) return false;
  const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const address = unescapeAttr(src?.[1] ?? src?.[2] ?? '');
  const srcset = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const first = address || (srcset?.[1] ?? srcset?.[2] ?? '').trim().split(/\s+/)[0] || '';
  if (/\.svg(?:[?#]|$)/i.test(first) || /^data:/i.test(first) || LEAD_ICON_NAME.test(first.split('?')[0])) return false;
  const size = knownSize(tag, first);
  return size !== null && size >= LEAD_ICON_MAX;
}

/** L'extrait montre-t-il une photo avant son `LEAD_TEXT_BLOCKS`-ième bloc de texte ? */
export function opensOnImage(html: string): boolean {
  let blocks = 0;
  let text = 0;
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>|[^<]+/gi)) {
    const token = m[0];
    if (!m[2]) {
      text += token.replace(/&nbsp;|&#160;/gi, ' ').replace(/&[a-z#0-9]+;/gi, '_').replace(/\s+/g, ' ').trim().length;
      continue;
    }
    const tag = m[2].toLowerCase();
    if (tag === 'img' && !m[1]) {
      if (photoTag(token)) return true;
      continue;
    }
    // Un bloc s'ouvre ou se ferme : le texte lu depuis le précédent était un bloc.
    if (LEAD_BLOCK_TAG.test(tag) || tag === 'br') {
      if (text >= LEAD_TEXT_MIN && ++blocks >= LEAD_TEXT_BLOCKS) return false;
      text = 0;
    }
  }
  return false;
}

/** Un numéro de 8 chiffres qui est une date (`20261107`) ne désigne pas une image. */
const DATE_LIKE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/;
/** Une heure (`143012`) non plus. */
const TIME_LIKE = /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/;
const ID_MIN_DIGITS = 6;
/** Au-delà, un nombre est un horodatage (`v1730987654`, `1730987654321-…`). */
const ID_MAX_DIGITS = 9;
/** Paramètres de recadrage, de taille et de format : la même photo autrement servie. */
const FRAMING_PARAMS = new Set(['crop', 'rect', 'strip', 'gravity', 'focus', 'fit', 'format', 'fm', 'auto', 'w', 'h', 'width', 'height', 'resize', 'quality', 'q', 'dpr', 'key', 'sig', 'signature', 'hash']);

/**
 * La taille et le recadrage dans le nom du fichier, à la manière de Les
 * Numériques (REG-247) : `…serveurs__1200_678__8-48-2066-1208.jpg`,
 * `…__800_800__overflow.jpg`, `…__452_254.jpg` — le flux donne
 * `…serveurs.jpg`. Deux nombres après `__`, puis au plus un recadrage.
 */
const LEAD_SIZE_SUFFIX = /__\d{2,5}_\d{2,5}(?:__[a-z0-9-]+)?(?=\.[a-z0-9]+$)/i;

/** Le numéro de l'image d'une adresse : le segment qui suit `images/`, sinon le dernier nombre du nom de fichier. */
function imageNumber(u: URL): string | null {
  const segments = u.pathname.split('/').filter(Boolean);
  const after = segments.findIndex((seg, i) => i > 0 && segments[i - 1].toLowerCase() === 'images' && /^\d+$/.test(seg));
  const found = after >= 0 ? segments[after] : (segments[segments.length - 1] ?? '').replace(/\.[a-z0-9]+$/i, '').match(/\d+/g)?.pop();
  if (!found || found.length < ID_MIN_DIGITS || found.length > ID_MAX_DIGITS || DATE_LIKE.test(found) || TIME_LIKE.test(found)) return null;
  return found;
}

/**
 * `a` (une adresse de l'extrait) et `b` (l'image du flux) sont-elles la même
 * photo, sous deux adresses du même hôte ? `path` : même chemin hors
 * recadrage ; `number` : le numéro de l'image de `b` finit un nombre de `a`
 * (l'appelant vérifie qu'une seule image de l'extrait le porte).
 */
export function sameLeadPhoto(a: string, b: string): 'path' | 'number' | null {
  let ua: URL;
  let ub: URL;
  try { ua = new URL(a); ub = new URL(b); } catch { return null; }
  const host = (u: URL) => u.host.toLowerCase().replace(/^www\./, '');
  if (host(ua) !== host(ub)) return null;
  const path = (u: URL) => u.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '').replace(LEAD_SIZE_SUFFIX, '');
  // Hors recadrage, taille et format, la requête désigne l'image (`image.php?id=2`).
  const query = (u: URL) => [...u.searchParams].filter(([key]) => !FRAMING_PARAMS.has(key.toLowerCase())).map(([k, v]) => `${k}=${v}`).sort().join('&');
  if (path(ua) === path(ub) && query(ua) === query(ub)) return 'path';
  const wanted = imageNumber(ub);
  if (!wanted) return null;
  return (ua.pathname.match(/\d+/g) ?? []).some((run) => run.endsWith(wanted)) ? 'number' : null;
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
