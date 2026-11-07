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
  if (imgMatch && !extractedHtml.includes(imgMatch[1]) && !holdsImage(extractedHtml, imgMatch[1])) {
    return `<img src="${imgMatch[1].replace(/"/g, '&quot;')}" alt="" />` + extractedHtml;
  }
  return extractedHtml;
}

/** `&amp;` et ses voisines, dans une valeur d'attribut lue telle quelle. */
const unescapeAttr = (value: string) => value.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&quot;/gi, '"');

/**
 * L'extrait montre-t-il déjà l'image `src`, à la taille près (REG-227) ? Par
 * son `src`, ou par une adresse de son `srcset` (un autre hôte, celui de la
 * page, y porte souvent les tailles de la même photo).
 */
function holdsImage(html: string, src: string): boolean {
  const wanted = imageIdentity(unescapeAttr(src));
  if (!wanted) return false;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    for (const attr of tag.matchAll(/\s(?:src|srcset|data-src|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const value = unescapeAttr(attr[1] ?? attr[2] ?? '');
      const candidates = /\ssrcset|data-srcset/i.test(attr[0]) ? value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [value];
      if (candidates.some((c) => imageIdentity(c) === wanted)) return true;
    }
  }
  return false;
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
