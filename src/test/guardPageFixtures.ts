/**
 * Pages de test de la garde de non-perte (REG-220 à REG-222, cycle 1.9.0) :
 * des pages dont le texte d'article voisin du corps sortait parce que le
 * nettoyage (M-04) ou la réunion du corps réparti changeait le bloc que
 * Readability choisit.
 *
 * Les quatre `*StructureFixture.html` sont l'arbre de pages réelles, faits
 * comme `pressPageHtml()` (`boilerplatePageFixtures.ts`) : scripts, styles,
 * SVG, gabarits et `<meta>` retirés, liens et images neutralisés (les ancres
 * de la page gardées), ids et classes qui nommaient un sujet ou un
 * identifiant d'origine neutralisés, et CHAQUE lettre remplacée par une lettre
 * tirée au hasard (graine fixe) d'une phrase inventée — ponctuation, chiffres,
 * blancs et longueurs gardés. Aucun mot d'origine ne reste. Écrites à la main,
 * ces pages ne reproduiraient pas le défaut : il dépend du poids exact de
 * chaque bloc. Chacune a été vérifiée : la version d'avant la garde y perd le
 * texte visé, la 1.8.0 le gardait.
 *
 * Partagées par les tests de la route serveur et ceux du repli navigateur.
 */

// `?raw` (Vite) plutôt que `fs` : voir `boilerplatePageFixtures.ts`.
import ledeStructureHtml from './guardLedeStructureFixture.html?raw';
import heroStructureHtml from './guardHeroStructureFixture.html?raw';
import headerStructureHtml from './guardHeaderStructureFixture.html?raw';
import shortStructureHtml from './guardShortStructureFixture.html?raw';

/**
 * Le `<main>` d'un article de The Verge. Le chapeau
 * (`div.duet--article--lede p.duet--article--dangerously-set-cms-markup`) et
 * l'image d'en-tête sont les frères du corps. Le formulaire de lettre
 * d'information et le bloc « Related » retirés, Readability ne retenait plus
 * que le corps.
 */
export function ledePageHtml(): string {
  return ledeStructureHtml;
}

/**
 * L'`<article>` d'un billet du blog de Google : l'en-tête
 * (`p.uni-article-hero__abstract`, `img.uni-article-hero__image`) précède
 * dix-sept blocs `rich-text` cousins. Réunis, ils gagnaient seuls, et
 * Readability ne remontait plus à l'`<article>`.
 */
export function heroPageHtml(): string {
  return heroStructureHtml;
}

/**
 * Le `<main>` d'un article d'Ars Technica : chapeau et légende dans
 * l'`<header>` de l'`<article>`, quatre `div.post-content` cousins, puis la
 * notice de l'auteur (`div.author-mini-bio`) et le compteur de commentaires.
 * Réuni, le corps gagnait seul : l'`<header>` sortait.
 */
export function headerPageHtml(): string {
  return headerStructureHtml;
}

/**
 * Une page d'accueil courte, toute dans son `<main>` : une introduction
 * (`div.header`), puis un intertitre et trois paliers (`div.donate`). Aucune
 * passe n'atteint le seuil de 500 caractères : Readability rendait la plus
 * longue, l'introduction ; la 1.8.0 (seuil 50) rendait les paliers.
 */
export function shortLandingPageHtml(): string {
  return shortStructureHtml;
}

/** L'intertitre que seul le sommaire donne à lire (REG-222). */
export const TOC_ONLY_HEADING = 'Rappel : l’en-tête transmis par les relais';

/**
 * Écrite à la main d'après un billet de blog statique : un sommaire
 * (`nav.toc`, des ancres vers les titres de la page) en tête du corps, puis
 * les sections. L'id du deuxième titre porte « header » : Readability retire
 * ce titre lui-même (« improbable »), et ne le lit que dans le sommaire.
 */
export function tocPageHtml(): string {
  const para = (n: number) => `<p>Paragraphe ${n} d’un billet inventé pour la mesure : il explique, avec assez de mots et quelques virgules, comment une requête traverse plusieurs relais avant d’arriver au serveur.</p>`;
  return `<!doctype html><html><head><title>Un billet de blog inventé</title></head><body>
<header class="site"><nav><a href="/">Accueil</a> <a href="/blog/">Blog</a> <a href="/a-propos/">À propos</a></nav></header>
<main><div>
<h1>Un billet de blog inventé</h1>
<nav class="toc" aria-label="Sommaire"><h4>Sommaire</h4><ul>
<li><a href="#resume">Résumé</a></li>
<li><a href="#rappel-en-tete-transmis-header">${TOC_ONLY_HEADING}</a></li>
<li><a href="#risques">Les risques</a><ul><li><a href="#usurpation">Usurpation d’adresse</a></li></ul></li>
<li><a href="#conclusion">Conclusion</a></li>
</ul></nav>
<h2 id="resume">Résumé</h2>${para(1)}${para(2)}
<h2 id="rappel-en-tete-transmis-header">${TOC_ONLY_HEADING}</h2>${para(3)}${para(4)}
<h2 id="risques">Les risques</h2>${para(5)}<h3 id="usurpation">Usurpation d’adresse</h3>${para(6)}
<h2 id="conclusion">Conclusion</h2>${para(7)}
</div></main>
<footer><p>Pied de page du blog inventé.</p></footer>
</body></html>`;
}
