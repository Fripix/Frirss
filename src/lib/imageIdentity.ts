/**
 * L'identité d'une image, à la taille près (REG-225, REG-227) : deux adresses
 * qui ne diffèrent que par la taille demandée désignent la même photo.
 *
 * Frandroid sert l'image d'en-tête au flux en `…-1200x800.jpg?resize=1200,675&key=…`
 * et dans la page en `….jpg?resize=1200&key=…` : comparées telles quelles,
 * le volet la croyait absente de l'extrait et la remettait en tête — la photo
 * s'affichait deux fois. The Verge sert la même photo en deux largeurs
 * (`?quality=90&crop=…&w=…`) l'une à côté de l'autre, pour deux mises en page.
 *
 * Règles (RD-02 : jeter toute la requête d'une adresse d'image confondait
 * `step.png?step=1` et `?step=2`) :
 * - le schéma et le fragment ne comptent pas, l'hôte est mis en minuscules ;
 * - seuls les paramètres de TAILLE sortent de la requête (`SIZE_PARAMS` :
 *   `w`, `h`, `width`, `height`, `resize`, `fit`, `quality`, `q`, `dpr`) ; tout
 *   autre reste, recadrage (`crop`) et format (`format`) compris : c'est une
 *   autre image ;
 * - une signature (`SIGNATURES` : `key`, `sig`, `signature`) ne sort qu'avec
 *   la taille qu'elle signe : Frandroid signe chaque `resize` d'un `key`
 *   différent ; sans paramètre de taille, elle reste ;
 * - le suffixe de taille de WordPress avant l'extension (`-1200x675`) sort.
 *
 * Partagée par le volet (`articleBody.ts`), le repli d'extraction
 * (`extractContent.ts`) et l'outil de corpus (`scripts/corpus/lib.ts`) ; le
 * serveur en porte une copie à l'identique (`server/extract.ts`).
 */
const SIZE_SUFFIX = /-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i;
const SIZE_PARAMS = new Set(['w', 'h', 'width', 'height', 'resize', 'fit', 'quality', 'q', 'dpr']);
const SIGNATURES = new Set(['key', 'sig', 'signature']);

/** `address` ramenée à son identité, ou `null` si elle ne se lit pas (ou est en ligne). */
export function imageIdentity(address: string | null | undefined, base?: string): string | null {
  const raw = (address || '').trim();
  if (!raw || /^data:/i.test(raw)) return null;
  let url: URL;
  try { url = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  const params = [...url.searchParams];
  const sized = params.some(([key]) => SIZE_PARAMS.has(key.toLowerCase()));
  const kept = params.filter(([key]) => !SIZE_PARAMS.has(key.toLowerCase()) && !(sized && SIGNATURES.has(key.toLowerCase())));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${url.host.toLowerCase()}${url.pathname.replace(SIZE_SUFFIX, '')}${query}`;
}
