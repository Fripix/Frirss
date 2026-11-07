import DOMPurify from 'dompurify';
import { reserveImgAspect } from '../lib/imageAspect';
import { purifyToString, releaseDocument } from '../lib/parsedDocument';

/** Blocs qui reçoivent `dir="auto"` dans le corps d'un article. */
const DIR_AUTO_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION']);

/** Passe « corps d'article » en cours (`sanitizeArticleBody`), sinon `null`. */
let bodyPass: { eagerImages: number; images: number; blockDir: boolean } | null = null;

/** `auto` en tête d'une liste `sizes`, avec sa virgule. */
const AUTO_SIZES = /^\s*auto\s*(?:,\s*|$)/i;

/**
 * `sizes="auto, …"` sans son `auto` (REG-248). Avec `loading="lazy"`, `auto`
 * fait choisir la variante du `srcset` d'après la largeur de l'image AVANT son
 * chargement : le volet la laisse en `width: auto` (`.article-content img`),
 * donc 300 px par défaut, et la variante choisie fixe ensuite sa largeur
 * naturelle — l'image du blog de GitHub restait à 300 px dans un volet de
 * 700. Le reste de la liste demeure (`(max-width: 1000px) 100vw, 1000px`) ;
 * `auto` seul devient `100vw`, la valeur d'un `sizes` absent. Valeur
 * remplacée sur place, jamais l'attribut retiré (voir plus bas).
 */
function withoutAutoSizes(node: Element): void {
  const sizes = node.getAttribute('sizes');
  if (!sizes || !AUTO_SIZES.test(sizes)) return;
  node.setAttribute('sizes', sizes.replace(AUTO_SIZES, '').trim() || '100vw');
}

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
    withoutAutoSizes(node);
  } else if (node.tagName === 'SOURCE') {
    withoutAutoSizes(node);
  } else if (bodyPass.blockDir && DIR_AUTO_TAGS.has(node.tagName) && !node.hasAttribute('dir')) {
    node.setAttribute('dir', 'auto');
  }
});

const CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'loading'],
  // `data-floating-surface` marque les surfaces flottantes de l'app (menus,
  // Popover) : tant qu'un élément le porte, `useKeyboardNav` coupe les
  // raccourcis. DOMPurify garde les `data-*` : venu du corps d'un article, il
  // coupait j/k, `s`, `t` tant que l'article restait ouvert. La garde du
  // clavier ignore aussi `.article-content` ; on retire en plus l'attribut ici,
  // pour qu'aucun autre lecteur du marqueur n'ait à s'en souvenir.
  // (`sanitizeExtracted` refuse déjà tous les `data-*`.)
  FORBID_ATTR: ['data-floating-surface'],
};

/**
 * Sanitize untrusted article HTML before injecting it via dangerouslySetInnerHTML.
 * DOMPurify strips <script>, event handlers (onerror/onload/…), javascript: URIs, etc.
 * We keep `target` and `loading` so external links and lazy images still work.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Document interne vidé : voir `parsedDocument.ts` (vidéo, `<source media>`).
  return purifyToString(html, CONFIG);
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
 * Chaque tableau (le plus extérieur seulement) dans un bloc qui défile de
 * côté (`.article-scroll-x`, `index.css`) : un tableau plus large que la
 * colonne était coupé à droite, sans défilement (M-11). Le tableau garde sa
 * largeur naturelle ; c'est l'enveloppe qui défile, et le balayage du volet
 * lui laisse le geste (`horizontalScroller.ts`).
 */
function wrapTables(body: Element): void {
  for (const table of Array.from(body.querySelectorAll('table'))) {
    if (table.parentElement?.closest('table')) continue;
    const box = body.ownerDocument.createElement('div');
    box.className = 'article-scroll-x';
    table.replaceWith(box);
    box.appendChild(table);
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
 * - paragraphes vides et blancs de tête retirés ;
 * - chaque tableau extérieur enveloppé d'un bloc qui défile de côté
 *   (`wrapTables`, M-11).
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
    try {
      dropBlankLead(body);
      wrapTables(body);
      return body.innerHTML;
    } finally {
      releaseDocument(body.ownerDocument); // voir `parsedDocument.ts`
    }
  } finally {
    bodyPass = null;
  }
}
