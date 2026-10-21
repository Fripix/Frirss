// Réserver la place d'une image AVANT qu'elle n'arrive.
//
// `reserveImgAspect()` déclarait un `aspect-ratio` sur la seule foi des attributs `width`/`height` de la balise. Beaucoup de flux ne
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
// ⚠️ La clé est l'URL **normalisée**. Le réchauffage lit ses URL dans le HTML
// brut du flux, où un `&` s'écrit souvent `&amp;` ; la passe de rendu lit le
// `src` sur l'arbre assaini, où il est déjà décodé. Sans normalisation, une
// image mesurée depuis le flux ne serait jamais retrouvée au moment du rendu.
//
// ⚠️ Le travail se fait sur l'ÉLÉMENT, jamais par motif sur le HTML
// sérialisé (corrigé en 1.6.2). L'ancien motif trouvait aussi `<img` dans
// une valeur d'attribut, là où le sérialiseur n'échappe pas `<` : le
// guillemet du `style="…"` inséré refermait la valeur, et la suite devenait
// des attributs — un gestionnaire d'événement, après DOMPurify.

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

/** Une mesure vaut-elle quelque chose ? Un zéro ne réserve aucune place. */
const usable = (m: ImageMeasure | null): m is ImageMeasure =>
  !!m && m.width > 0 && m.height > 0;

/** Les chiffres en tête d'un attribut `width`/`height` (`"800px"` → `800`). */
const leadingDigits = (value: string | null): string | null =>
  value?.match(/^(\d{1,5})/)?.[1] ?? null;

/**
 * La déclaration `aspect-ratio` à poser sur cette image, ou `null`.
 *
 * Les attributs de la balise l'emportent : ils viennent de l'éditeur du flux,
 * qui décrit l'image telle qu'il veut la voir affichée. La mesure ne sert que
 * de repli — ce qui est précisément le cas manquant.
 */
export function aspectDecl(img: Element, measure: ImageMeasure | null): string | null {
  const w = leadingDigits(img.getAttribute('width'));
  const h = leadingDigits(img.getAttribute('height'));
  if (w && h && +w > 0 && +h > 0) return `aspect-ratio:${w}/${h}`;
  if (usable(measure)) return `aspect-ratio:${measure.width}/${measure.height}`;
  return null;
}

/**
 * Réserver la place verticale d'une image de l'arbre assaini, via
 * `aspect-ratio` — pour que le texte sous une image d'en-tête ne saute pas
 * pendant qu'elle charge (très visible pendant la transition de balayage).
 *
 * Appelée par la passe « corps d'article » (`sanitizeArticleBody`) sur chaque
 * `<img>` que DOMPurify vient d'assainir. Deux sources de dimensions, dans cet
 * ordre : les attributs `width`/`height`, puis la mesure du réchauffage. Sans
 * l'une ni l'autre, l'image ressort **intacte**.
 *
 * Seul `style` est touché : ajouté s'il manque, sa valeur complétée sur place
 * sinon — jamais retiré ni reposé (voir `sanitizeArticleBody`).
 *
 * ⚠️ Ce n'est pas une fonction pure : son résultat dépend de ce qui a été
 * mesuré. Le contrat de stabilité de `articleBody.ts` tient quand même — les
 * mesures arrivent AVANT que l'article ne soit ouvert, précisément parce que
 * le réchauffage travaille en avance.
 */
export function reserveImgAspect(img: Element): void {
  // La vignette d'une façade vidéo est NOTRE balisage, pas celui du flux. Sa
  // place est déjà réservée par le `aspect-ratio: 16/9` de `.yt-facade`, et
  // elle remplit sa boîte en `object-fit: cover`. Le cas se présente vraiment :
  // `youtubeThumbnail()` réutilise l'URL `hqdefault.jpg` que le réchauffage a
  // déjà mesurée comme image d'en-tête du même article, et un
  // `aspect-ratio:480/360` — du 4:3 — se posait sur une boîte 16:9.
  if (img.classList.contains('yt-facade__thumb')) return;
  const src = img.getAttribute('src');
  const decl = aspectDecl(img, src ? measuredImageSize(src) : null);
  if (!decl) return;
  const style = img.getAttribute('style');
  img.setAttribute('style', style ? `${style};${decl}` : decl);
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
