/**
 * Pages de test de la garde de non-perte « la page vérifie Readability »
 * (REG-229 à REG-233, cycle 1.9.0) : des pages où Readability laisse du texte
 * d'article dans le conteneur que la page désigne, et des formes que la garde
 * pourrait abîmer.
 *
 * Les trois `container*StructureFixture.html` sont l'arbre de pages réelles :
 * scripts, styles, SVG, cadres, gabarits et `<meta>` retirés, liens et images
 * neutralisés (les ancres de la page gardées, brouillées comme leurs cibles),
 * ids brouillés sauf ceux que lisent les règles de l'extraction (`comments`,
 * `secondary`…), et chaque mot remplacé par un mot inventé de même longueur —
 * le même mot donnant toujours le même, pour que les doublons de la page
 * restent des doublons. Ponctuation, chiffres, blancs et longueurs gardés ;
 * aucun mot d'origine ne reste. Chacune a été vérifiée : la version d'avant
 * (`10031dd`) y perd le texte visé, la garde le remet.
 *
 * Les autres pages sont écrites à la main, d'après les formes réelles citées.
 *
 * Partagées par les tests de la route serveur et ceux du repli navigateur.
 */

// `?raw` (Vite) plutôt que `fs` : voir `boilerplatePageFixtures.ts`.
import relatedCardsStructureHtml from './containerRelatedCardsStructureFixture.html?raw';
import dossierStructureHtml from './containerDossierStructureFixture.html?raw';
import ledeStructureHtml from './containerLedeStructureFixture.html?raw';

/**
 * Le `<main>` d'un billet du blog de Docker : l'`<article>` (date, rubrique,
 * corps), puis les cartes « articles liés ». Readability rend les cartes, et
 * l'article est perdu en entier (8 billets sur 10, 10 sur 10 en 1.8.0).
 */
export function relatedCardsPageHtml(): string {
  return relatedCardsStructureHtml;
}

/**
 * Le `<main>` d'un dossier de Clubic : le titre hors de
 * `article.main-content`, le corps en `div.slate-content` cousins
 * (`div.grid-default > div.row-wrapper.row > div.slate-content`), coupés par
 * des intertitres et des images. Readability n'en gardait qu'une partie
 * (2 491 caractères sur ~5 500).
 */
export function dossierPageHtml(): string {
  return dossierStructureHtml;
}

/**
 * La mise en page d'un article des Numériques : l'en-tête (titre coupé par le
 * site dans `<title>`, date, réseaux, chapeau, image d'en-tête) dans
 * `section.ed__p-artc__hdr`, puis le corps, puis « Publications qui peuvent
 * vous intéresser ». Readability perdait le chapeau et l'image d'en-tête.
 */
export function newsLedePageHtml(): string {
  return ledeStructureHtml;
}

/** Une phrase inventée assez longue pour être suivie (25 caractères au moins). */
const sentence = (word: string) => `${word} : une phrase inventée, assez longue pour compter dans la mesure du corps.`;
const paragraphs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${sentence(`${prefix} ${i + 1}`)} Elle a une seconde phrase pour peser dans le score de Readability.</p>`).join('\n');

/**
 * Une page d'accueil : un `<main>` fait de huit cartes en `<article>`, aucune
 * dominante. Elle ne désigne aucun article : la garde n'y remet rien.
 */
export function listPageHtml(): string {
  const card = (n: number) => `<article class="card"><h2><a href="/billet-${n}">Titre inventé de la carte numéro ${n}</a></h2>${paragraphs(`Résumé de la carte ${n}`, 2)}</article>`;
  return `<!doctype html><html><head><title>Accueil du site inventé</title></head><body>
<header><a href="/">Le site inventé</a></header>
<main>${Array.from({ length: 8 }, (_, i) => card(i + 1)).join('\n')}</main>
</body></html>`;
}

/**
 * Un billet du blog de DeepMind : le corps dans le `<main>`, sans `<article>`,
 * une vidéo paresseuse (`<source data-src>`) entre deux paragraphes, puis
 * quatre cartes « à lire aussi » en `<article>`. Les cartes ne font pas une
 * page de liste : le corps est lu dans le `<main>`.
 */
export function cardsBelowPageHtml(): string {
  const card = (n: number) => `<article class="card"><a href="/autre-${n}"><h3>Autre billet inventé numéro ${n}</h3></a></article>`;
  return `<!doctype html><html><head><title>Un billet inventé avec une vidéo</title></head><body>
<main id="page-content">
<section class="cover"><h1>Un billet inventé avec une vidéo</h1><p class="cover__text">${sentence('Le chapeau du billet')}</p></section>
<section class="rich-text">${paragraphs('Premier temps du corps', 4)}</section>
<section class="media"><figure><video controls preload="none" poster="/affiche.jpg"><source data-src="https://example.com/media/demo.mp4" type="video/mp4"> Votre navigateur ne lit pas la vidéo.</video><figcaption>${sentence('La légende de la vidéo')}</figcaption></figure></section>
<section class="rich-text">${paragraphs('Second temps du corps', 4)}</section>
<section class="related"><h2>À lire aussi</h2>${Array.from({ length: 4 }, (_, i) => card(i + 1)).join('\n')}</section>
</main>
</body></html>`;
}

/**
 * Un billet dont l'`<article>` porte aussi les commentaires (LWN, Krebs) : une
 * section `#comments`, chaque commentaire en `<article class="comment">`, et
 * un compteur de commentaires en tête.
 */
export function commentsInsidePageHtml(): string {
  const comment = (n: number) => `<article class="comment" id="comment-${n}"><p class="comment-author">Lecteur ${n}</p><div class="comment-body"><p>${sentence(`Le commentaire du lecteur ${n}`)}</p></div></article>`;
  return `<!doctype html><html><head><title>Un billet commenté inventé</title></head><body><main><article class="post">
<h1>Un billet commenté inventé</h1>
<p class="meta"><a class="comments-link" href="#comments">${sentence('Douze commentaires sur ce billet')}</a></p>
<div class="entry">${paragraphs('Corps du billet commenté', 6)}</div>
<section id="comments"><h2>Douze commentaires</h2>${Array.from({ length: 4 }, (_, i) => comment(i + 1)).join('\n')}</section>
</article></main></body></html>`;
}

/**
 * Un article de Clubic : le titre est hors de l'`<article>`, dans l'ancêtre
 * commun ; après l'article, dans ce même ancêtre, des vidéos, une lettre
 * d'information et les commentaires, en classes hachées, sans aucun mot qui
 * les nomme. Remonter jusqu'au titre ne doit pas les ramasser.
 */
export function commentsAfterPageHtml(): string {
  return `<!doctype html><html><head><title>Un article inventé au titre hors du corps</title></head><body><main class="a1b2c3">
<div class="d4e5f6">
<div class="g7h8i9"><h1>Un article inventé au titre hors du corps</h1><p class="j1k2l3">${sentence('Le chapeau hors du corps')}</p></div>
<article class="main-content">${paragraphs('Corps de l’article', 6)}</article>
<section class="m4n5o6"><h2>Nos vidéos</h2><p>${sentence('La vidéo du jour, à regarder ici')}</p></section>
<div class="p7q8r9">Commentaires (2)<div><div>lecteur_1</div><div><blockquote><p>${sentence('Corps de l’article 1')} Elle a une seconde phrase pour peser dans le score de Readability.</p></blockquote><p>${sentence('La réponse du premier lecteur')}</p><p>${sentence('La suite de la réponse du lecteur')}</p></div></div></div>
</div>
</main></body></html>`;
}

/** Le titre d'une page dont la description est le titre. */
export const DESCRIBED_TITLE = 'Un titre inventé que la description répète mot pour mot';

/**
 * Un billet (linuxfr, Simon Willison) dont `og:description` et
 * `description` sont le titre, et dont le `<h1>` porte le titre entier quand
 * `<title>` le coupe (Les Numériques).
 */
export function descriptionIsTitlePageHtml(): string {
  return `<!doctype html><html><head><title>Un titre inventé que la description répète mo...</title>
<meta property="og:description" content="${DESCRIBED_TITLE}"><meta name="description" content="${DESCRIBED_TITLE}"></head><body><main><article>
<header><h1>${DESCRIBED_TITLE}</h1></header>
<div class="corps">${paragraphs('Corps du billet décrit', 5)}</div>
</article></main></body></html>`;
}

/**
 * Un billet du blog de GitHub : pas d'`<article>` ; le corps est dans une
 * `section`, derrière un `<html><body>` écrit en clair que linkedom imbrique,
 * avec un encadré (`aside`) de définitions dans le fil du texte. Une colonne
 * de côté en `aside`, elle, voisine des gabarits.
 */
export function asideInFlowPageHtml(): string {
  return `<!doctype html><html><head><title>Un billet inventé avec un encadré</title></head><body>
<main>
<div class="container"><div class="d-flex">
<section class="col-8 post__content">
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html><body>${paragraphs('Avant l’encadré', 3)}
<aside class="wp-block-group post-aside--large"><p><strong>décalage /de.ka.laʒ/</strong></p><ul>
<li>${sentence('Première définition de l’encadré')}</li><li>${sentence('Deuxième définition de l’encadré')}</li><li>${sentence('Troisième définition de l’encadré')}</li></ul></aside>
${paragraphs('Après l’encadré', 3)}</body></html>
</section>
<aside class="col-4 sidebar"><div class="widget"><h3>Populaires</h3><div><a href="/a">${sentence('Un billet populaire de la colonne')}</a></div><div><span>${sentence('Le slogan de la colonne de côté')}</span></div></div></aside>
</div></div>
</main></body></html>`;
}
