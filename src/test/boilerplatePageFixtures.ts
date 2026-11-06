/**
 * Pages de test qui reproduisent la STRUCTURE de pages réelles dont
 * l'extraction ramassait des blocs étrangers (M-04, campagne 1.9.0, second
 * round) — sans leur texte : tout est inventé.
 *
 * - `blogPageHtml()` : écrite à la main d'après un billet de Schneier on
 *   Security (WordPress).
 * - `newsStructureFixture.html` (`newsPageHtml()`) : l'arbre d'un article de The Verge,
 *   balises, ids et classes lisibles conservés, scripts, styles et classes
 *   hachées retirés, CHAQUE texte remplacé par un texte inventé de même
 *   longueur, réduit au `<main>`. Écrite à la main, la page ne reproduisait
 *   pas le défaut : la seconde passe dépend du poids exact de chaque bloc.
 *
 * Partagées par les tests de la route serveur et ceux du repli navigateur, qui
 * doivent juger les mêmes pages.
 */

// `?raw` (Vite) plutôt que `fs` : sous jsdom, `import.meta.url` n'est pas une
// URL `file:`, et la fixture sert aux deux environnements de test.
import newsStructureHtml from './newsStructureFixture.html?raw';

/** L'article de type « The Verge » (voir l'en-tête). */
export function newsPageHtml(): string {
  return newsStructureHtml;
}

/** Phrase repérable dans le billet court de type « Schneier ». */
export const BLOG_BODY_MARKER = 'Un lecteur me signale';

/**
 * Structure d'un blog WordPress (Schneier on Security) : un billet COURT
 * (~400 caractères, sous le seuil de 500 de Readability), dans un
 * `div#content` qui porte aussi le fil d'Ariane, les commentaires, le
 * formulaire de réponse, le lien d'abonnement aux commentaires et les crédits
 * du pied (« Powered by WordPress »). La barre latérale est un `<aside>` de
 * page. Plusieurs `<article>` (le billet et chaque commentaire) : aucun
 * conteneur principal, c'est la PREMIÈRE passe qui ramassait ces blocs.
 */
export function blogPageHtml(): string {
  const comment = (i: number) => `<article class="comment depth-1" id="comment-${100 + i}"><div class="comment by-lecteur-${i}"><p class="commentcredit"><span class="commenter">Lecteur ${i}</span> • <a href="#comment-${100 + i}">2 novembre 2026 8:${10 + i}</a></p><p>Un commentaire de lecteur numéro ${i}, qui donne son avis sur le billet avec quelques phrases et une opinion bien tranchée sur la question.</p></div></article>`;
  return `<!doctype html><html lang="fr"><head><title>Trouver des failles - Sécurité d’Exemple</title></head>
<body class="single single-post"><div id="wrapper"><div id="main">
<header><div id="header"><h1><a href="/">Sécurité d’Exemple</a></h1></div></header>
<nav><div id="header-nav" class="nav"><ul><li><a href="/blog">Blog</a></li><li><a href="/livres">Livres</a></li><li><a href="/essais">Essais</a></li></ul></div></nav>
<aside><div id="sidebar-one" class="sidebar"><section><div class="sidesection widget"><h3>Recherche</h3><p class="small">Powered by DuckDuckGo</p><form><input name="q"></form></div></section><section><h3>S’abonner</h3></section></div></aside>
<div id="content">
  <p id="breadcrumbs"><a href="/">Accueil</a><a href="/blog">Blog</a></p>
  <article id="post-1" class="post type-post hentry"><div class="article">
    <h2 class="entry">Trouver des failles</h2>
    <p>${BLOG_BODY_MARKER} ce chiffre :</p>
    <blockquote><p>Trois pour cent des failles critiques jamais recensées l’ont été le mois dernier, et à ce rythme l’année en ajoutera un quart au total historique.</p></blockquote>
    <p>Oui. C’est un monde nouveau qui s’ouvre devant nous.</p>
    <p class="entry-tags"><span class="tags-links">Étiquettes : <a href="/t/ia" rel="tag">IA</a>, <a href="/t/failles" rel="tag">failles</a></span></p>
    <p class="posted"><a href="/p/1" rel="bookmark">Publié le 2 novembre 2026 à 7:02</a> • <a href="#comments">5 commentaires</a></p>
  </div></article>
  <h3 id="comments">Commentaires</h3>
  ${Array.from({ length: 5 }, (_, i) => comment(i)).join('\n  ')}
  <p><a href="/p/1/feed"><img alt="Flux Atom" src="/feed.png"> S’abonner aux commentaires de ce billet</a></p>
  <div id="respond" class="comment-respond"><h3>Laisser un commentaire</h3><form id="commentform"><p>Politique de modération du blog</p><label>Nom</label><input name="author"><textarea name="comment"></textarea><p>HTML autorisé : a, em, cite, i, strong, b</p></form></div>
  <p class="nav-links"><a href="/p/0">← Billet précédent</a> <a href="/p/2">Billet suivant →</a></p>
  <p id="powered">Photo de la barre latérale par un photographe d’exemple.</p>
  <p id="footer-credits"><a href="https://wordpress.example">Powered by WordPress</a> <a href="https://host.example">Hosted by Exemple</a></p>
</div>
</div></div></body></html>`;
}
