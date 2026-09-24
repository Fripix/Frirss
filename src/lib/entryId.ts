/**
 * L'identifiant d'entrée FreshRSS caché dans l'identifiant greader d'un article.
 *
 * FreshRSS compare `ts` (mark-all-as-read) à l'`id` de l'entrée — l'instant où
 * il l'a INSÉRÉE, en microsecondes — et non à la date de publication :
 * `UPDATE _entry … WHERE id_feed=? AND is_read <> ? AND id <= ?`. Et il rend
 * cet id en hexadécimal dans l'identifiant greader
 * (`tag:google.com,2005:reader/item/00065a872a755226`). La borne d'un
 * « marquer en dessous » se calcule donc depuis l'article lui-même.
 *
 * Tout passe par des chaînes et `BigInt` : 16 chiffres décimaux dépassent la
 * précision d'un `number`, et une borne arrondie marquerait lus des articles
 * voisins de celui qu'on a cliqué.
 * Spec : docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md
 */

const HEX = /^[0-9a-f]+$/i;
const DEC = /^[0-9]+$/;

/** L'identifiant d'entrée, en décimal, ou `null` si la forme est inconnue. */
export function entryIdUsec(articleId: string): string | null {
  const id = articleId.trim();
  if (!id) return null;
  const slash = id.lastIndexOf('/');
  if (slash >= 0) {
    // Forme greader (`…/reader/item/00065a872a755226`) : l'identifiant est en
    // HEXADÉCIMAL, complété à seize caractères par `dec2hex` côté FreshRSS.
    //
    // ⚠️ La base se déduit de la FORME, jamais du contenu : un identifiant
    // hexadécimal dont les seize caractères sont tous des chiffres — environ un
    // article sur 450 — passerait pour du décimal et rendrait une valeur des
    // centaines de fois trop petite. Côté « en dessous », la borne ne
    // marquerait plus rien ; côté « au-dessus », la pagination ne s'arrêterait
    // jamais et marquerait le flux entier.
    const hex = id.slice(slash + 1);
    if (!HEX.test(hex)) return null;
    try {
      return BigInt(`0x${hex}`).toString();
    } catch {
      return null;
    }
  }
  // Forme brute de `stream/items/ids` : décimal, sans préfixe.
  return DEC.test(id) ? id : null;
}

/** Borne « strictement plus ancien que cet article », pour `ts`. */
export function exclusiveOlderThanEntryId(articleId: string): string | null {
  const usec = entryIdUsec(articleId);
  if (usec === null) return null;
  return (BigInt(usec) - 1n).toString();
}

/**
 * `a` a-t-il été inséré avant `b` ? Un identifiant illisible n'est jamais
 * « plus ancien » : dans le doute, on ne marque pas.
 */
export function isOlderEntry(a: string, b: string): boolean {
  const ua = entryIdUsec(a);
  const ub = entryIdUsec(b);
  if (ua === null || ub === null) return false;
  return BigInt(ua) < BigInt(ub);
}
