import DOMPurify from 'dompurify';

/** Blocs qui reçoivent `dir="auto"` dans le corps d'un article. */
const DIR_AUTO_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION']);

/** Passe « corps d'article » en cours (`sanitizeArticleBody`), sinon `null`. */
let bodyPass: { eagerImages: number; images: number } | null = null;

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
  if (node.tagName === 'IMG') {
    if (++bodyPass.images > bodyPass.eagerImages) node.setAttribute('loading', 'lazy');
  } else if (DIR_AUTO_TAGS.has(node.tagName) && !node.hasAttribute('dir')) {
    node.setAttribute('dir', 'auto');
  }
});

/**
 * Sanitize untrusted article HTML before injecting it via dangerouslySetInnerHTML.
 * DOMPurify strips <script>, event handlers (onerror/onload/…), javascript: URIs, etc.
 * We keep `target` and `loading` so external links and lazy images still work.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'loading'],
  });
}

/**
 * `sanitizeHtml` pour le corps d'un article, avec deux retouches faites sur
 * l'arbre que DOMPurify vient d'assainir, avant son unique sérialisation :
 *
 * - chargement différé (`loading="lazy"`) de toutes les images après les
 *   `eagerImages` premières ;
 * - `dir="auto"` sur `p`, `h1`–`h6`, `li`, `blockquote`, `figcaption` qui n'ont
 *   pas déjà de `dir`.
 *
 * ⚠️ Pas de motif sur le HTML sérialisé. Ceux d'avant n'avaient pas de borne
 * après le nom (`<pre>` → `<p dir="auto"re>`, `<picture>` → `<p dir="auto"icture>`)
 * et trouvaient aussi `<p` ou `<img` à l'intérieur d'une valeur d'attribut, là
 * où le sérialiseur n'échappe pas `<` : leurs guillemets refermaient la valeur
 * et la suite devenait des attributs, après DOMPurify. Sur l'arbre, un nœud est
 * un élément ou il n'est pas.
 */
export function sanitizeArticleBody(html: string | null | undefined, eagerImages: number): string {
  bodyPass = { eagerImages, images: 0 };
  try {
    return sanitizeHtml(html);
  } finally {
    bodyPass = null;
  }
}
