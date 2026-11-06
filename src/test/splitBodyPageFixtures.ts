/**
 * Pages de test dont le CORPS est réparti en plusieurs blocs de même classe,
 * chacun dans son propre gabarit (campagne 1.9.0, troisième round) — l'arbre
 * de deux articles d'Ars Technica, réduits à leur `<article>`, faits comme
 * `pressPageHtml()` (`boilerplatePageFixtures.ts`) : classes et ids gardés
 * (celles qui nomment le sujet neutralisées), scripts, styles et images
 * neutralisés, CHAQUE lettre remplacée par une lettre d'un texte inventé —
 * ponctuation, blancs et longueurs gardés. Écrite à la main, une telle page ne
 * reproduirait pas le défaut : il dépend du poids exact de chaque bloc.
 *
 * Chaque morceau du corps vit dans un `div.post-content`, enveloppé dans sa
 * propre grille (texte + colonne de publicité vide), les grilles séparées par
 * un emplacement publicitaire. Les blocs sont donc des COUSINS, pas des
 * frères : Readability n'en garde qu'un.
 *
 * Partagées par les tests de la route serveur et ceux du repli navigateur.
 */

// `?raw` (Vite) plutôt que `fs` : voir `boilerplatePageFixtures.ts`.
import splitBodyStructureHtml from './splitBodyStructureFixture.html?raw';
import splitBodyBioStructureHtml from './splitBodyBioStructureFixture.html?raw';

/**
 * Trois blocs (1 827, 1 722 et 2 258 caractères). Readability ne gardait que
 * le dernier : le chapeau et le premier intertitre disparaissaient.
 */
export function splitBodyPageHtml(): string {
  return splitBodyStructureHtml;
}

/**
 * Deux blocs (1 919 et 2 290 caractères), suivis, dans le gabarit du second,
 * de la notice de l'auteur (`div.author-mini-bio`) et du compteur de
 * commentaires. La première passe ne gardait qu'un bloc ; la seconde (A-1),
 * faite sur l'`<article>` entier, retrouvait le corps mais ramassait aussi la
 * notice et le compteur.
 */
export function splitBodyWithBioPageHtml(): string {
  return splitBodyBioStructureHtml;
}
