/**
 * Bornes temporelles d'un « tout lu en dessous / au-dessus » (issue #15).
 *
 * Trois unités se croisent dans ce seul geste : `Article.published` est en
 * MILLISECONDES, `mark-all-as-read` attend des MICROSECONDES (`ts`), et la
 * borne `ot` de `stream/items/ids` attend des SECONDES. Chaque conversion
 * décale d'une unité pour EXCLURE l'article cliqué : il garde son état, c'est
 * ce qu'on attend d'un « en dessous ».
 * Spec : docs/superpowers/specs/2026-09-24-mark-above-below-read-design.md
 */

/** Tout ce qui est strictement plus ancien que cet article, en microsecondes. */
export function exclusiveOlderThanUsec(publishedMs: number): string {
  // Chaîne, pas nombre : l'appelant la transmet telle quelle à l'API, et rien
  // ne peut l'additionner par mégarde à un autre horodatage.
  return String(publishedMs * 1000 - 1);
}

/**
 * Tout ce qui est strictement plus récent, en secondes.
 *
 * ⚠️ Conséquence assumée de la seconde d'écart : les articles publiés dans la
 * MÊME seconde que celui qu'on a cliqué ne sont pas marqués. C'est le sens
 * prudent — mieux vaut en oublier un que marquer lu l'article qu'on regarde.
 */
export function exclusiveNewerThanSec(publishedMs: number): number {
  return Math.floor(publishedMs / 1000) + 1;
}
