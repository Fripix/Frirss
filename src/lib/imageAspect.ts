// Réserver la place d'une image AVANT qu'elle n'arrive.
//
// `reserveImgAspect()` (`articleBody.ts`) déclarait un `aspect-ratio` sur la
// seule foi des attributs `width`/`height` de la balise. Beaucoup de flux ne
// les écrivent pas : l'image tombait alors dans une boîte de hauteur nulle et
// poussait le texte vers le bas en se posant — le saut très visible pendant
// une transition de balayage sur iPhone.
//
// Le réchauffage en avant (`heroWarm.ts`) charge déjà l'image d'en-tête des
// articles suivants. Son événement `load` porte `naturalWidth`/`naturalHeight`
// : la mesure est **gratuite**, et c'est elle qu'on retient ici pour combler
// le trou.
//
// Deux règles tiennent ce module :
//
//  1. **Ne jamais deviner.** Pas de mesure, ou une mesure dégénérée (0) ⇒ la
//     balise ressort telle quelle, exactement comme avant. Un mauvais
//     `aspect-ratio` serait pire que pas de réservation du tout : il
//     déplacerait le texte deux fois.
//  2. **La carte reste bornée.** Une session de lecture dure des heures et
//     traverse des milliers d'images ; une `Map` qui ne relâche rien finirait
//     par peser. La plus anciennement mesurée sort quand la limite est
//     atteinte (ordre d'insertion d'une `Map`).
//
// ⚠️ La clé est l'URL **normalisée**. Le HTML du flux et celui que rend
// l'assainisseur n'écrivent pas la même chaîne : DOMPurify sérialise `&` en
// `&amp;`. Sans normalisation, une image mesurée depuis le flux ne serait
// jamais retrouvée au moment du rendu.

/** Dimensions naturelles d'une image, telles que le navigateur les rapporte. */
export interface ImageMeasure {
  width: number;
  height: number;
}

/** Nombre d'images dont on retient les dimensions. */
export const MEASURED_LIMIT = 300;

const measured = new Map<string, ImageMeasure>();

/**
 * L'URL telle qu'on la retient et telle qu'on la demande au réseau : les
 * entités HTML d'un attribut `src` sont décodées. Un `img.src` laissé avec un
 * `&amp;` demanderait littéralement cette chaîne au serveur.
 */
export function normalizeImageUrl(url: string): string {
  return url
    .replace(/&(?:amp|#38|#x26);/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'");
}

/** Le `src` d'une balise `<img>`, normalisé. `null` s'il n'y en a pas. */
export function imgTagSrc(tag: string): string | null {
  const m = tag.match(/\bsrc=["']([^"']+)["']/i);
  return m ? normalizeImageUrl(m[1]) : null;
}

/** Une mesure vaut-elle quelque chose ? Un zéro ne réserve aucune place. */
const usable = (m: ImageMeasure | null): m is ImageMeasure =>
  !!m && m.width > 0 && m.height > 0;

/**
 * La déclaration `aspect-ratio` à poser sur cette balise, ou `null`.
 *
 * Les attributs de la balise l'emportent : ils viennent de l'éditeur du flux,
 * qui décrit l'image telle qu'il veut la voir affichée. La mesure ne sert que
 * de repli — ce qui est précisément le cas manquant.
 */
export function aspectDecl(tag: string, measure: ImageMeasure | null): string | null {
  const w = tag.match(/\bwidth=["']?(\d{1,5})/i);
  const h = tag.match(/\bheight=["']?(\d{1,5})/i);
  if (w && h && +w[1] > 0 && +h[1] > 0) return `aspect-ratio:${w[1]}/${h[1]}`;
  if (usable(measure)) return `aspect-ratio:${measure.width}/${measure.height}`;
  return null;
}

/** Poser la déclaration sur la balise, en complétant un `style` existant. */
export function withAspect(tag: string, decl: string): string {
  if (/\bstyle=/i.test(tag)) {
    return tag.replace(/style=(["'])(.*?)\1/i, (_m, q, s) => `style=${q}${s};${decl}${q}`);
  }
  return tag.replace(/<img\b/i, `<img style="${decl}"`);
}

/** Retenir les dimensions naturelles d'une image qui vient de charger. */
export function rememberImageSize(url: string, width: number, height: number): void {
  if (!usable({ width, height })) return;
  const key = normalizeImageUrl(url);
  // Réinsérer replace ET rafraîchit la position dans l'ordre d'éviction.
  measured.delete(key);
  measured.set(key, { width, height });
  while (measured.size > MEASURED_LIMIT) {
    const oldest = measured.keys().next();
    if (oldest.done) break;
    measured.delete(oldest.value);
  }
}

/** Ce qui a été mesuré pour cette URL, ou `null`. */
export function measuredImageSize(url: string): ImageMeasure | null {
  const m = measured.get(normalizeImageUrl(url));
  return usable(m ?? null) ? m! : null;
}

/** Tout oublier — pour les tests, et pour rien d'autre. */
export function forgetMeasuredSizes(): void {
  measured.clear();
}
