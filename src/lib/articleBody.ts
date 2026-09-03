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

import { sanitizeHtml } from '../utils/sanitizeHtml';
import { injectVideoFacades, type FacadeLabels } from './youtube';

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
 * Réserver la place verticale des images qui déclarent width/height, via
 * `aspect-ratio` — pour que le texte sous une image d'en-tête ne saute pas
 * pendant qu'elle charge (très visible pendant la transition de balayage).
 */
export function reserveImgAspect(html: string): string {
  // On retire au passage les paragraphes vides et les <br> égarés que
  // certains flux ajoutent autour de l'image d'en-tête : ils creusent un
  // écart au-dessus du texte que le contenu extrait n'a pas, et la mise en
  // page saute quand l'extraction automatique remplace le corps.
  html = html
    .replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/^(?:\s|&nbsp;|<br\s*\/?>)+/i, '');
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const w = tag.match(/\bwidth=["']?(\d{1,5})/i);
    const h = tag.match(/\bheight=["']?(\d{1,5})/i);
    if (!w || !h || +w[1] === 0 || +h[1] === 0) return tag;
    const decl = `aspect-ratio:${w[1]}/${h[1]}`;
    if (/\bstyle=/i.test(tag)) {
      return tag.replace(/style=(["'])(.*?)\1/i, (_m, q, s) => `style=${q}${s};${decl}${q}`);
    }
    return tag.replace(/<img\b/i, `<img style="${decl}"`);
  });
}

/**
 * Le contenu réellement affiché : l'extraction quand elle existe, le flux
 * sinon. L'image d'en-tête du flux est réinjectée si l'extraction l'a perdue
 * — Readability écarte souvent l'illustration principale, et l'article
 * arrivait alors amputé de sa seule image.
 */
export function displayedHtml(rssHtml?: string | null, extractedHtml?: string | null): string {
  if (!extractedHtml) return rssHtml || '';
  const imgMatch = rssHtml?.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && !extractedHtml.includes(imgMatch[1])) {
    return `<img src="${imgMatch[1].replace(/"/g, '&quot;')}" alt="" />` + extractedHtml;
  }
  return extractedHtml;
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
 *  3. assainir (scripts, gestionnaires d'événements, `javascript:`) ;
 *  4. réserver la place des images, puis différer le chargement de toutes
 *     sauf les deux premières ;
 *  5. donner sa direction à chaque bloc : un paragraphe arabe ou hébreu se
 *     lit de droite à gauche même dans un article qui, lui, va de gauche à
 *     droite.
 */
export function buildArticleBody(input: ArticleBodyInput): ArticleBody {
  const displayed = displayedHtml(input.rssHtml, input.extractedHtml);
  const words = displayed.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

  const withVideos = input.inlineVideos
    ? injectVideoFacades(displayed, input.videoLabels)
    : { html: displayed, ids: [] as string[] };

  let imgIdx = 0;
  const html = reserveImgAspect(sanitizeHtml(withVideos.html))
    .replace(/<img(?!\s+loading=)/gi, (m) => (++imgIdx <= EAGER_IMAGES ? m : '<img loading="lazy"'))
    .replace(/<(p|h[1-6]|li|blockquote|figcaption)(?![^>]*\bdir=)/gi, '<$1 dir="auto"');

  return { html, videoIds: withVideos.ids, words };
}
