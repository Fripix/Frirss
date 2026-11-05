/**
 * Version de l'extraction d'articles, côté navigateur. Même valeur que
 * `server/extractVersion.ts`, qui dit quand la monter (vérifié par
 * `server/test/cache.test.ts`).
 *
 * Chaque extrait gardé dans IndexedDB en porte le tampon (`extractVersion`,
 * absent avant la 1.9.0, donc version 1). Un extrait d'une version antérieure
 * n'est plus servi en ligne : il est réextrait, et le nouveau le remplace en
 * gardant son épinglage. Hors ligne il reste servi — un article d'une version
 * antérieure vaut mieux qu'aucun (`extractCache.ts`).
 */
export const EXTRACT_VERSION = 2;
