/**
 * Version de l'extraction d'articles. À MONTER chaque fois que le résultat de
 * l'extraction change pour une même page (`server/extract.ts`, ou son repli
 * navigateur `src/utils/extractContent.ts`).
 *
 * Elle entre dans la clé du cache Redis des extraits (`extractKey`) : un
 * extrait gardé par l'algorithme précédent n'est plus relu, il expire avec
 * `CACHE_TTL`. Sans elle, l'avis tronqué d'avant L-04/A-1 restait servi
 * jusqu'à 24 h, et le navigateur le recopiait dans son propre cache (A-2).
 *
 * Même valeur que `src/lib/extractVersion.ts` (le cache du navigateur) : le
 * serveur et le client ne partagent pas de code, `server/test/cache.test.ts`
 * vérifie qu'elles ne divergent pas.
 *
 * 1 : jusqu'à la 1.8.x (implicite, absent des clés et des extraits).
 * 2 : 1.9.0 — seuil de Readability à 500 (L-04), seconde passe sur le
 *     conteneur principal (A-1).
 */
export const EXTRACT_VERSION = 2;
