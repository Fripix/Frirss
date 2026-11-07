/**
 * L'identité d'une image, à la taille près (REG-225, REG-227) : deux adresses
 * qui ne diffèrent que par la taille demandée désignent la même photo.
 *
 * Frandroid sert l'image d'en-tête au flux en `…-1200x800.jpg?resize=1200,675&key=…`
 * et dans la page en `….jpg?resize=1200&key=…` : comparées telles quelles,
 * le volet la croyait absente de l'extrait et la remettait en tête — la photo
 * s'affichait deux fois. The Verge sert la même photo en deux recadrages
 * (`?quality=90&crop=…&w=…`) l'un à côté de l'autre, pour deux mises en page.
 *
 * Règles, dans l'ordre :
 * - le schéma et le fragment ne comptent pas, l'hôte est mis en minuscules ;
 * - une adresse dont le chemin finit par une extension d'image perd toute sa
 *   requête : elle n'y porte que des consignes de rendu (taille, qualité,
 *   recadrage, format) et leur signature (`key` de Frandroid), jamais
 *   l'identité de la photo, que le chemin donne déjà ;
 * - sinon (`/image.php?id=1`, `/_next/image?url=…&w=640`), seuls les
 *   paramètres de taille connus sortent (`SIZE_PARAMS`) : le reste peut être
 *   l'identité même de l'image ;
 * - le suffixe de taille de WordPress avant l'extension (`-1200x675`,
 *   `-scaled`) sort.
 *
 * Partagée par le volet (`articleBody.ts`), le repli d'extraction
 * (`extractContent.ts`) et l'outil de corpus (`scripts/corpus/lib.ts`) ; le
 * serveur en porte une copie à l'identique (`server/extract.ts`).
 */
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif|jxl|bmp|tiff?|svg)$/i;
const SIZE_SUFFIX = /-(?:\d{2,5}x\d{2,5}|scaled)(?=\.[a-z0-9]+$)/i;
const SIZE_PARAMS = new Set(['resize', 'w', 'h', 'width', 'height', 'quality', 'q', 'crop', 'fit', 'dpr', 'strip', 'auto', 'fm', 'format', 'webp', 'ssl', 'zoom']);

/** `address` ramenée à son identité, ou `null` si elle ne se lit pas (ou est en ligne). */
export function imageIdentity(address: string | null | undefined, base?: string): string | null {
  const raw = (address || '').trim();
  if (!raw || /^data:/i.test(raw)) return null;
  let url: URL;
  try { url = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  const path = url.pathname.replace(SIZE_SUFFIX, '');
  let query = '';
  if (!IMAGE_PATH.test(url.pathname)) {
    const kept = [...url.searchParams].filter(([key]) => !SIZE_PARAMS.has(key.toLowerCase()));
    if (kept.length) query = `?${new URLSearchParams(kept).toString()}`;
  }
  return `${url.host.toLowerCase()}${path}${query}`;
}
