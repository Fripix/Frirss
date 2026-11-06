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
import splitBodyAcrossImagesHtml from './splitBodyAcrossImagesFixture.html?raw';
import splitBodyAcrossHeadingsHtml from './splitBodyAcrossHeadingsFixture.html?raw';
import splitBodyAcrossEmbedHtml from './splitBodyAcrossEmbedFixture.html?raw';

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

/**
 * Dix blocs `div.slate-content` cousins (l'arbre d'un article de Clubic,
 * vérification du troisième round, R3V-01), chacun dans sa grille ; deux
 * images légendées et un intertitre seul dans son bloc (sans paragraphe)
 * coupent la suite. La réunion ne prenait que les blocs que rien ne séparait :
 * le morceau du milieu, ainsi grossi, devenait le seul corps — 1 970
 * caractères sur 4 907, chapeau et images perdus.
 */
export function splitBodyAcrossImagesPageHtml(): string {
  return splitBodyAcrossImagesHtml;
}

/**
 * Six blocs `div.slate-content` cousins (l'arbre d'un article de Clubic,
 * quatrième round, A4-01 : 281, 543, 83, 2 143, 54 et 1 829 caractères) :
 * une image légendée entre les deux premiers, et deux intertitres seuls dans
 * leur bloc, sans paragraphe. « Tout ou rien » refusait toute réunion, et
 * Readability ne gardait que le dernier bloc (1 835 caractères sur ~4 900).
 */
export function splitBodyAcrossHeadingsPageHtml(): string {
  return splitBodyAcrossHeadingsHtml;
}

/**
 * Sept blocs `div.slate-content` cousins (un autre article de Clubic, A4-01) :
 * une image légendée, deux intertitres seuls dans leur bloc et un message
 * intégré (`blockquote`) au milieu. Readability ne gardait que l'avant-dernier
 * bloc (840 caractères sur ~2 000).
 */
export function splitBodyAcrossEmbedPageHtml(): string {
  return splitBodyAcrossEmbedHtml;
}
