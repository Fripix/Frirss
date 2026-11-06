/**
 * Page de test aux images paresseuses (A1, campagne 1.9.0, troisième round) —
 * texte et adresses inventés, structure reprise de deux pages réelles :
 *
 * - type « Numerama » : `<picture>` dont la `<source>` porte `data-srcset`,
 *   l'`<img>` un `src` en `data:image/svg+xml` NON base64 (un cadre blanc) et
 *   la vraie adresse dans `data-src` / `data-srcset`, suivie d'un
 *   `<noscript>` qui porte l'image réelle ; une seconde image sans `data-src`,
 *   que seul son `<noscript>` sauve ;
 * - type « Zoomit » : chaque image enveloppée dans un `<button>` d'agrandissement,
 *   que Readability retire avec son contenu.
 *
 * Partagée par les tests de la route serveur et ceux du repli navigateur.
 */

const PLACEHOLDER = "data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%271024%27 height=%27576%27/%3E";

/** Les images que l'extraction doit rendre, dans l'ordre de la page. */
export const LAZY_IMAGES = {
  picture: 'https://images.example.com/usine-1024.jpg',
  pictureSet: 'https://images.example.com/usine-480.jpg 480w, https://images.example.com/usine-1024.jpg 1024w',
  webpSet: 'https://images.example.com/usine-1024.webp 1024w',
  noscriptOnly: 'https://images.example.com/batterie-1024.jpg',
  zoomed: 'https://images.example.com/vue-laterale-1300.jpg',
};

/** Une image en ligne, réelle : `data:` base64 que rien ne doit toucher. */
export const INLINE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const paragraph = (i: number) => `<p>Paragraphe ${i} de l’article sur l’usine d’exemple, qui décrit la chaîne d’assemblage, les délais de livraison et les choix du constructeur, assez longuement pour peser.</p>`;

export function lazyImagePageHtml(): string {
  return `<!doctype html><html lang="fr"><head><title>Une usine d’exemple</title></head><body>
<article><h1>Une usine d’exemple</h1>
${paragraph(1)}${paragraph(2)}
<figure><picture><source type="image/webp" data-srcset="${LAZY_IMAGES.webpSet}"><img width="1024" height="576" loading="lazy" alt="La chaîne d’assemblage" class="wp-image placeholder-default" src="${PLACEHOLDER}" data-src="${LAZY_IMAGES.picture}" data-srcset="${LAZY_IMAGES.pictureSet}"></picture><noscript><img width="1024" height="576" alt="La chaîne d’assemblage" src="${LAZY_IMAGES.picture}"></noscript><figcaption>La chaîne d’assemblage, vue d’en haut.</figcaption></figure>
${paragraph(3)}${paragraph(4)}
<figure><img width="1024" height="576" alt="Le bloc batterie" class="placeholder-default" src="${PLACEHOLDER}"><noscript><img width="1024" height="576" alt="Le bloc batterie" src="${LAZY_IMAGES.noscriptOnly}"></noscript><figcaption>Le bloc batterie, avant montage.</figcaption></figure>
${paragraph(5)}
<figure><button type="button" aria-label="Agrandir l’image : vue latérale" class="cursor-pointer border-0 bg-transparent p-0"><img alt="Vue latérale" loading="lazy" width="1300" height="665" src="${LAZY_IMAGES.zoomed}"></button><figcaption>Vue latérale du modèle.</figcaption></figure>
${paragraph(6)}
<p>Un schéma en ligne : <img alt="point" width="1" height="1" src="${INLINE_IMAGE}"></p>
${paragraph(7)}${paragraph(8)}
</article></body></html>`;
}
