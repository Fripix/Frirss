/**
 * Refus rapide d'une page piégée, mesuré sur le TEXTE avant toute analyse HTML
 * (relecture 1.9.0, suite de M-01).
 *
 * Le refus de M-01 se mesurait sur l'arbre que construit `parseHTML`. Or
 * linkedom est lui-même quadratique en profondeur — htmlparser2 range sa pile
 * d'éléments ouverts en insérant en tête (`unshift`) : 50 000 `<div>`
 * imbriqués coûtaient 1,2 s avant le refus, 390 000 `<div>` jamais fermés
 * (2 Mo) 42 s, bornés seulement par le délai du worker. Ce balayage-ci est
 * linéaire : quelques millisecondes pour 2 Mo, piège ou non.
 *
 * Il rejoue, à grands traits, ce que fait htmlparser2 10 (l'analyseur de
 * linkedom) de sa pile, pour estimer la profondeur de l'arbre qui SERAIT
 * construit, sans fausse alerte sur une page réelle :
 * - les éléments vides (`<br>`, `<img>`…) ne s'ouvrent pas ;
 * - une ouverture ferme ce que htmlparser2 ferme implicitement (`<p>` ferme
 *   `<p>`, `<li>` ferme `<li>`, `<td>` ferme `<td>`… — `OPEN_IMPLIES_CLOSE`) ;
 * - une fermeture remonte jusqu'à l'élément du même nom, s'il est ouvert, et
 *   ferme tout ce qui est au-dessus ; sinon elle est ignorée ;
 * - `<x/>` ne ferme qu'en SVG et MathML ; ailleurs, `<div/>` OUVRE un `<div>`,
 *   comme dans htmlparser2 ;
 * - le contenu de `script`, `style`, `title`, `textarea`, `xmp` (texte brut),
 *   les commentaires, déclarations et attributs ne sont pas lus comme des
 *   balises.
 * La pile ne dépasse jamais `maxDepth + 1` (le balayage s'arrête avant) : la
 * recherche d'une fermeture coûte au plus `maxDepth` pas.
 *
 * Copie conforme dans `src/lib/markupBounds.ts` (le repli du navigateur, qui
 * n'avait aucune borne) : `server/test/markupBounds.test.ts` passe les deux.
 */

export interface MarkupLimits {
  /** Profondeur d'imbrication maximale acceptée (`<html>` compte pour 1). */
  maxDepth: number;
  /** Nombre maximal de balises ouvrantes. */
  maxElements: number;
}

const VOID = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img', 'input', 'isindex',
  'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp']);
const FOREIGN = new Set(['math', 'svg']);
const HTML_INTEGRATION = new Set(['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml', 'foreignobject', 'desc', 'title']);

const P = new Set(['p']);
const FORM = new Set(['input', 'option', 'optgroup', 'select', 'button', 'datalist', 'textarea']);
const TABLE_SECTION = new Set(['thead', 'tbody']);
const DD_DT = new Set(['dd', 'dt']);
const RT_RP = new Set(['rt', 'rp']);
const OPEN_IMPLIES_CLOSE = new Map<string, Set<string>>([
  ['tr', new Set(['tr', 'th', 'td'])], ['th', new Set(['th'])], ['td', new Set(['thead', 'th', 'td'])],
  ['body', new Set(['head', 'link', 'script'])], ['li', new Set(['li'])],
  ['select', FORM], ['input', FORM], ['output', FORM], ['button', FORM], ['datalist', FORM], ['textarea', FORM],
  ['option', new Set(['option'])], ['optgroup', new Set(['optgroup', 'option'])],
  ['dd', DD_DT], ['dt', DD_DT], ['rt', RT_RP], ['rp', RT_RP], ['tbody', TABLE_SECTION], ['tfoot', TABLE_SECTION],
  ...['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr', 'main', 'nav', 'ol', 'pre', 'section',
    'table', 'ul'].map((tag) => [tag, P] as [string, Set<string>]),
]);

const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const endsName = (c: string) => isSpace(c) || c === '/' || c === '>';

/**
 * `'depth'` ou `'elements'` si la page dépasse une borne, `null` sinon.
 * Linéaire en la taille du texte.
 */
export function markupTooComplex(html: string, limits: MarkupLimits): 'depth' | 'elements' | null {
  const n = html.length;
  const stack: string[] = [];
  const foreign: boolean[] = [false];
  let elements = 0;
  let i = 0;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1 || lt + 1 >= n) break;
    const c = html[lt + 1];

    // ── Commentaires, déclarations, CDATA, instructions ──
    if (c === '!' || c === '?') {
      if (html.startsWith('<!--', lt)) {
        if (html[lt + 4] === '>') { i = lt + 5; continue; }
        const end = html.indexOf('-->', lt + 4);
        if (end === -1) break;
        i = end + 3;
      } else if (html.startsWith('<![CDATA[', lt)) {
        const end = html.indexOf(']]>', lt + 9);
        if (end === -1) break;
        i = end + 3;
      } else {
        const end = html.indexOf('>', lt + 2);
        if (end === -1) break;
        i = end + 1;
      }
      continue;
    }

    // ── Fermeture ──
    if (c === '/') {
      let j = lt + 2;
      if (j < n && isAlpha(html[j])) {
        const start = j;
        while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        const name = html.slice(start, j).toLowerCase();
        if ((FOREIGN.has(name) || HTML_INTEGRATION.has(name)) && foreign.length) foreign.pop();
        if (!VOID.has(name)) {
          const pos = stack.lastIndexOf(name);
          if (pos !== -1) stack.length = pos;
        }
      }
      const end = html.indexOf('>', j);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    // ── Texte : un `<` qui n'ouvre rien ──
    if (!isAlpha(c)) { i = lt + 1; continue; }

    // ── Ouverture : nom, puis attributs jusqu'au `>` (guillemets respectés) ──
    let j = lt + 1;
    while (j < n && !endsName(html[j])) j++;
    const name = html.slice(lt + 1, j).toLowerCase();
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      const ch = html[j];
      if (ch === '>') { closed = true; j++; break; }
      if (ch === '/') {
        // htmlparser2 tolère des blancs entre `/` et `>`.
        j++;
        while (j < n && isSpace(html[j])) j++;
        if (html[j] === '>') { selfClosing = true; closed = true; j++; break; }
        continue;
      }
      if (ch === '=') {
        j++;
        while (j < n && isSpace(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          if (close === -1) { j = n; break; }
          j = close + 1;
        } else {
          while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        }
        continue;
      }
      j++;
    }
    if (!closed) break;

    if (++elements > limits.maxElements) return 'elements';
    const impliesClose = OPEN_IMPLIES_CLOSE.get(name);
    if (impliesClose) {
      while (stack.length && impliesClose.has(stack[stack.length - 1])) stack.pop();
    }
    if (!VOID.has(name)) {
      stack.push(name);
      if (FOREIGN.has(name)) foreign.push(true);
      else if (HTML_INTEGRATION.has(name)) foreign.push(false);
      if (selfClosing && foreign[foreign.length - 1]) {
        stack.pop();
      } else if (stack.length > limits.maxDepth) {
        return 'depth';
      }
    }
    i = j;

    // ── Texte brut : rien n'est une balise jusqu'à `</nom` ──
    if (RAW_TEXT.has(name) && !selfClosing) {
      const end = indexOfCaseless(html, `</${name}`, i);
      if (end === -1) break;
      i = end;
    }
  }
  return null;
}

/** `indexOf` insensible à la casse pour un motif ASCII en minuscules, linéaire. */
function indexOfCaseless(text: string, lowerNeedle: string, from: number): number {
  const re = new RegExp(lowerNeedle.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'), 'gi');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : -1;
}
