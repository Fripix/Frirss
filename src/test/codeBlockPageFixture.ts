/**
 * Page de test aux blocs de code (REG-219, campagne 1.9.0) — code et texte
 * inventés, structure reprise d'un billet réel du blog de Node.js, rendu par
 * Shiki avec Twoslash :
 *
 * - chaque exemple est un `div.root` qui porte un `pre.shiki > code`, ligne par
 *   ligne en `span.line`, suivi d'un `div.footer` (langue et bouton « Copy to
 *   clipboard ») ;
 * - un exemple d'une ligne porte en plus la classe `no-footer` sur son `<pre>` :
 *   le mot `footer` le faisait retirer en entier par le nettoyage ;
 * - un identifiant est enveloppé dans un `<button class="twoslash-hover">`
 *   (l'infobulle de type) : Readability retire tout `<button>`, et son texte
 *   avec.
 *
 * Partagée par les tests de la route serveur et ceux du repli navigateur.
 */

/** Le texte des exemples, tel que l'article doit le rendre (balises retirées). */
export const CODE_SAMPLES = {
  first: "const total = Math.sumPrecise([0.25, 0.5]); // 0.75",
  noFooter: "new Intl.Locale('fr-CH').region; // 'CH'",
  last: "const parts = Intl.Segmenter.supportedLocalesOf(['fr']);",
};

/** Le bouton de copie, hors du `<pre>` : il ne doit pas entrer dans l'article. */
export const COPY_LABEL = 'Copy to clipboard';

const span = (text: string, color = '#1F2328') => `<span style="color:${color};--shiki-dark:#D8DEE9">${text}</span>`;

/** Un exemple Shiki : `pre` + pied (langue, bouton de copie), comme sur la page réelle. */
function shikiBlock(line: string, preClass = ''): string {
  return `<div class="HWYciG_root"><pre class="HWYciG_content shiki shiki-themes github-light-default nord twoslash lsp language-js${preClass}" tabindex="0"><code><span class="line">${line}</span></code></pre>`
    + `<div class="HWYciG_footer"><span class="HWYciG_language">JavaScript</span><button class="EPgSia_button HWYciG_action" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z"></path></svg>${COPY_LABEL}</button></div></div>`;
}

const paragraph = (i: number) => `<p>Paragraphe ${i} du billet sur les nouveautés du moteur JavaScript, qui présente une fonction, son usage et ce qu’elle remplace, assez longuement pour peser.</p>`;

export function codeBlockPageHtml(): string {
  const first = shikiBlock(`${span('const', '#CF222E')}${span(' total = Math.')}${span('sumPrecise', '#8250DF')}${span('([0.25, 0.5]);')}${span(' // 0.75', '#6E7781')}`);
  const noFooter = shikiBlock(
    `${span('new', '#CF222E')}${span(' ')}${span('Intl')}${span('.')}<span style="color:#8250DF"><button data-state="closed" class="twoslash-hover">Locale</button></span>${span('(')}${span('&#x27;fr-CH&#x27;', '#0A3069')}${span(').region;')}${span(' // &#x27;CH&#x27;', '#6E7781')}`,
    ' no-line-numbers no-footer',
  );
  const last = shikiBlock(`${span('const', '#CF222E')}${span(' parts = Intl.Segmenter.')}<span style="color:#8250DF"><button data-state="closed" class="twoslash-hover">supportedLocalesOf</button></span>${span('([&#x27;fr&#x27;]);')}`);
  return `<!doctype html><html lang="en"><head><title>Nouveautés du moteur</title></head><body>
<header><nav><a href="/">Accueil</a> <a href="/blog">Blog</a></nav></header>
<main><article><h1>Nouveautés du moteur</h1>
${paragraph(1)}${paragraph(2)}
<h4 id="sum"><a href="#sum"><code>Math.sumPrecise</code></a></h4>
${paragraph(3)}${first}
<h4 id="locale"><a href="#locale"><code>Intl.Locale.prototype.region</code></a></h4>
${paragraph(4)}${noFooter}
${paragraph(5)}${last}
${paragraph(6)}${paragraph(7)}
</article></main>
<footer><p>Pied de page du site.</p></footer>
</body></html>`;
}

/**
 * Une page d'article minimale autour de `blocks`, pour les autres formes de
 * code (contrôles, `<details>`, bouton de copie dans le `<pre>`…).
 */
export function codeArticleHtml(blocks: string): string {
  return `<!doctype html><html><head><title>Exemples</title></head><body><article><h1>Exemples</h1>${paragraph(1)}${paragraph(2)}${blocks}${paragraph(3)}${paragraph(4)}</article></body></html>`;
}
