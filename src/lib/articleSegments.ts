// Découpage d'un article en segments traduisibles, et réinjection des
// traductions. Module pur (DOM du navigateur uniquement) : le serveur traduit
// des segments numérotés, le client garde la main sur le DOM.

export const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, dt, dd';

export interface Segmented {
  /** Segment 0 = le titre ; les suivants = HTML interne des blocs feuilles. */
  segments: string[];
  /** Réinjecte les traductions (même indices que `segments`) après `sanitize` ;
   *  rend le HTML du corps. Le titre traduit est `translated[0]`, à part. */
  apply: (translated: string[], sanitize: (html: string) => string) => string;
}

const HAS_LETTER = /\p{L}/u;
// Conteneurs sans texte propre garanti : on les parcourt, on ne les fond pas
// dans une suite. Les éléments de SKIPPED ne sont jamais traduits.
const CONTAINERS = 'div, section, article, main, aside, header, footer, nav, figure, details, form, center, address, hgroup, fieldset';
const BREAKERS = `${BLOCK_SELECTOR}, pre, ${CONTAINERS}`;
const SKIPPED = 'pre, script, style, noscript, template, textarea, svg, math';

/** Un segment : un bloc feuille (son HTML interne), ou une suite de nœuds
 *  consécutifs hors bloc posée directement dans un conteneur ou un bloc qui en
 *  contient d'autres (« Fruits » dans `<li>Fruits<ul>…</ul></li>`, texte nu
 *  d'un `div` ou de la racine). */
type Unit = { kind: 'block'; el: Element } | { kind: 'run'; nodes: Node[] };

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** Sépare le texte des blocs, conteneurs et éléments ignorés : ne fait jamais
 *  partie d'une suite. */
function isBreaker(node: Node): boolean {
  return isElement(node) && (node.matches(`${BREAKERS}, ${SKIPPED}`) || node.querySelector(BREAKERS) !== null);
}

function hasLetter(nodes: Node[]): boolean {
  return nodes.some((n) => (n.nodeType === 1 || n.nodeType === 3) && HAS_LETTER.test(n.textContent ?? ''));
}

/** Segments du document dans l'ordre de lecture. Les éléments SKIPPED ne sont jamais descendus. */
function collectUnits(root: Element): Unit[] {
  const units: Unit[] = [];
  const walk = (parent: Element) => {
    let run: Node[] = [];
    const flush = () => {
      if (run.length && hasLetter(run)) units.push({ kind: 'run', nodes: run });
      run = [];
    };
    for (const node of Array.from(parent.childNodes)) {
      if (!isBreaker(node)) {
        run.push(node);
        continue;
      }
      flush();
      const el = node as Element;
      if (el.matches(SKIPPED)) continue;
      if (el.matches(BLOCK_SELECTOR) && !el.querySelector(BREAKERS)) {
        if (HAS_LETTER.test(el.textContent ?? '')) units.push({ kind: 'block', el });
      } else {
        walk(el);
      }
    }
    flush();
  };
  walk(root);
  return units;
}

function serialize(doc: Document, nodes: Node[]): string {
  const box = doc.createElement('div');
  nodes.forEach((n) => box.appendChild(n.cloneNode(true)));
  return box.innerHTML;
}

export function segmentArticle(title: string, html: string): Segmented {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const doc = body.ownerDocument;
  const segments = [
    title,
    ...collectUnits(body).map((u) => (u.kind === 'block' ? u.el.innerHTML : serialize(doc, u.nodes))),
  ];
  return {
    segments,
    apply(translated, sanitize) {
      const copy = body.cloneNode(true) as HTMLElement;
      collectUnits(copy).forEach((unit, i) => {
        // La sortie du modèle n'est pas fiable : tout ce qui n'est pas du
        // texte, ou que le sanitiseur ne digère pas, laisse l'original en place.
        const text: unknown = translated[i + 1];
        if (typeof text !== 'string' || text.trim() === '') return;
        let clean: string;
        try {
          clean = sanitize(text);
        } catch {
          return;
        }
        if (typeof clean !== 'string' || clean.trim() === '') return;
        if (unit.kind === 'block') {
          unit.el.innerHTML = clean;
          return;
        }
        const box = doc.createElement('div');
        box.innerHTML = clean;
        const first = unit.nodes[0];
        const parent = first.parentNode;
        if (!parent) return;
        while (box.firstChild) parent.insertBefore(box.firstChild, first);
        unit.nodes.forEach((n) => n.parentNode?.removeChild(n));
      });
      return copy.innerHTML;
    },
  };
}

// Les écritures sans espaces (chinois, japonais, coréen, thaï) comptent pour un
// mot par paire de caractères : sans cela un paragraphe entier vaudrait un mot.
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu;

export function wordCount(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').trim();
  if (!text) return 0;
  const bySpace = text.split(/\s+/).length;
  const spaceless = text.match(SPACELESS)?.length ?? 0;
  return Math.max(bySpace, Math.ceil(spaceless / 2));
}

/** Regroupe des indices consécutifs en lots (mots ≤ maxWords, octets UTF-8 ≤
 *  maxBytes, segments ≤ maxSegments). Un segment à lui seul plus lourd que
 *  maxBytes n'entre dans aucun lot (« traduit en partie »).
 *
 *  `maxSegments` : chaque segment coûte une dizaine de jetons de balisage
 *  (`<s n="N">…</s>`) en sortie. Un grand tableau ou une longue liste —
 *  des centaines de cellules de deux mots — tenait sous 1 200 mots, et la
 *  réponse se tronquait (8 192 jetons chez Anthropic, la fenêtre d'Ollama) :
 *  rejouée, payée deux fois, puis « segments » à chaque nouvel essai. */
export function batchSegments(segments: string[], maxWords = 1200, maxBytes = 200_000, maxSegments = 120): number[][] {
  const encoder = new TextEncoder();
  const batches: number[][] = [];
  let current: number[] = [];
  let words = 0;
  let bytes = 0;
  segments.forEach((segment, i) => {
    const w = wordCount(segment);
    const b = encoder.encode(segment).length;
    if (b > maxBytes) return;
    if (current.length && (words + w > maxWords || bytes + b > maxBytes || current.length >= maxSegments)) {
      batches.push(current);
      current = [];
      words = 0;
      bytes = 0;
    }
    current.push(i);
    words += w;
    bytes += b;
  });
  if (current.length) batches.push(current);
  return batches;
}
