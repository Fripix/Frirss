/**
 * Pages de test des doublons de l'article complet (REG-225, REG-226, cycle
 * 1.9.0) : des pages qui portent deux exemplaires d'un même bloc, dont la
 * feuille de style de la page n'en montre qu'un — et que l'article complet
 * montrait tous les deux.
 *
 * Faites comme celles de `guardPageFixtures.ts` (arbre de la page réelle,
 * scripts, styles, SVG, gabarits et `<meta>` retirés, liens neutralisés,
 * identifiants d'origine remplacés, chaque lettre tirée au hasard d'une phrase
 * inventée), à une différence près, qui est tout le sujet : un même texte
 * reçoit le même brouillage, et une même photo (à la taille près) la même
 * adresse, sa taille demandée gardée. Les doublons de la page restent donc
 * des doublons. Chacune a été vérifiée : la version d'avant le correctif y
 * rend les deux exemplaires.
 *
 * Partagées par les tests de la route serveur et ceux du repli navigateur.
 */

// `?raw` (Vite) plutôt que `fs` : voir `boilerplatePageFixtures.ts`.
import ledeStructureHtml from './repeatLedeStructureFixture.html?raw';
import lightboxStructureHtml from './repeatLightboxStructureFixture.html?raw';

/**
 * Le `<body>` d'un article de The Verge : l'en-tête (`div.duet--ledes--standard-lede`)
 * porte deux mises en page, chacune avec son exemplaire du chapeau
 * (`p.duet--article--dangerously-set-cms-markup`), et la photo d'en-tête en
 * deux recadrages côte à côte (`/img/2.jpg?w=…`). La feuille de style n'en
 * montre qu'un de chaque ; le HTML ne dit pas lequel (classes hachées).
 */
export function repeatLedePageHtml(): string {
  return ledeStructureHtml;
}

/**
 * Le `<body>` d'un article d'Ars Technica : chaque figure porte sa légende deux
 * fois — dans la visionneuse (`div.pswp-caption-content`, que la feuille de
 * style masque) puis dans le `<figcaption>`.
 */
export function repeatLightboxPageHtml(): string {
  return lightboxStructureHtml;
}
