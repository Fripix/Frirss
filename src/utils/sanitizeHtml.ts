import DOMPurify from 'dompurify';
import { reserveImgAspect } from '../lib/imageAspect';

/** Blocs qui reçoivent `dir="auto"` dans le corps d'un article. */
const DIR_AUTO_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION']);

/** Passe « corps d'article » en cours (`sanitizeArticleBody`), sinon `null`. */
let bodyPass: { eagerImages: number; images: number; blockDir: boolean } | null = null;

// Registered once at module load (DOMPurify hooks are global).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  // Harden links opened in a new tab against reverse-tabnabbing.
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (!bodyPass) return;
  // On AJOUTE (ou on remplace la valeur sur place), sans jamais retirer ni
  // reposer un attribut existant : DOMPurify garde des noms `data-*` que le
  // parseur HTML accepte mais que la vérification de nom XML refuse
  // (`data-a×b`). Les reposer levait `InvalidCharacterError` sur les moteurs
  // à l'ancienne règle, et l'exception remontait jusqu'à la frontière
  // d'erreur de l'application : un seul article faisait tomber l'app.
  // Un lien du corps s'ouvre dans un nouvel onglet (issue #24) : cliqué dans
  // la page, il remplaçait FriRSS — et en app installée, il n'y avait plus de
  // barre d'adresse pour revenir. Une ancre interne (`#…`) reste dans la page.
  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (href && !href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  } else if (node.tagName === 'IMG') {
    if (++bodyPass.images > bodyPass.eagerImages) node.setAttribute('loading', 'lazy');
    reserveImgAspect(node);
  } else if (bodyPass.blockDir && DIR_AUTO_TAGS.has(node.tagName) && !node.hasAttribute('dir')) {
    node.setAttribute('dir', 'auto');
  }
});

const CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'loading'],
};

/**
 * Sanitize untrusted article HTML before injecting it via dangerouslySetInnerHTML.
 * DOMPurify strips <script>, event handlers (onerror/onload/…), javascript: URIs, etc.
 * We keep `target` and `loading` so external links and lazy images still work.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, CONFIG);
}

/** Un nœud qui ne montre rien : blancs (`&nbsp;` compris) ou `<br>`. */
const isBlank = (n: Node): boolean =>
  n.nodeType === Node.TEXT_NODE ? /^\s*$/.test(n.nodeValue ?? '') : n.nodeName === 'BR';

/**
 * Retirer les paragraphes vides et les `<br>` / blancs de tête que certains
 * flux ajoutent autour de l'image d'en-tête : ils creusent un écart au-dessus
 * du texte que le contenu extrait n'a pas, et la mise en page sautait quand
 * l'extraction automatique remplaçait le corps.
 */
function dropBlankLead(body: Element): void {
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (Array.from(p.childNodes).every(isBlank)) p.remove();
  }
  for (let n = body.firstChild; n; ) {
    const next = n.nextSibling;
    if (n.nodeType === Node.TEXT_NODE) {
      const rest = (n.nodeValue ?? '').replace(/^\s+/, '');
      if (rest) {
        n.nodeValue = rest;
        break;
      }
    } else if (n.nodeName !== 'BR') {
      break;
    }
    n.remove();
    n = next;
  }
}

/**
 * `sanitizeHtml` pour le corps d'un article, avec les retouches faites sur
 * l'arbre que DOMPurify vient d'assainir, avant son unique sérialisation :
 *
 * - chargement différé (`loading="lazy"`) de toutes les images après les
 *   `eagerImages` premières (`Infinity` : aucune) ;
 * - `dir="auto"` sur `p`, `h1`–`h6`, `li`, `blockquote`, `figcaption` qui n'ont
 *   pas déjà de `dir` (sauf `blockDir: false`) ;
 * - `aspect-ratio` réservé dans le `style` des images aux dimensions connues
 *   (`reserveImgAspect`, `imageAspect.ts`) ;
 * - paragraphes vides et blancs de tête retirés.
 *
 * ⚠️ Pas de motif sur le HTML sérialisé. Ceux d'avant n'avaient pas de borne
 * après le nom (`<pre>` → `<p dir="auto"re>`, `<picture>` → `<p dir="auto"icture>`)
 * et trouvaient aussi `<p` ou `<img` à l'intérieur d'une valeur d'attribut, là
 * où le sérialiseur n'échappe pas `<` : leurs guillemets refermaient la valeur
 * et la suite devenait des attributs, après DOMPurify. Sur l'arbre, un nœud est
 * un élément ou il n'est pas.
 */
export function sanitizeArticleBody(
  html: string | null | undefined,
  eagerImages: number,
  { blockDir = true }: { blockDir?: boolean } = {},
): string {
  if (!html) return '';
  bodyPass = { eagerImages, images: 0, blockDir };
  try {
    const body = DOMPurify.sanitize(html, { ...CONFIG, RETURN_DOM: true }) as Element;
    dropBlankLead(body);
    return body.innerHTML;
  } finally {
    bodyPass = null;
  }
}
