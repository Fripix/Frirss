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
 * Il rejoue ce que fait htmlparser2 10 (l'analyseur de linkedom) de sa pile,
 * pour connaître la profondeur de l'arbre qui SERAIT construit. Il peut la
 * surestimer (un refus prudent), jamais la sous-estimer : une forme que
 * htmlparser2 lit autrement que lui serait une porte dérobée — tout ce qui la
 * suit échapperait au comptage (C-01, quatrième round : `<div =" >` et
 * `<!--->`). `server/test/markupBounds.test.ts` le confronte à l'arbre réel
 * sur une liste de formes étranges. Ce qu'il rejoue :
 * - les éléments vides (`<br>`, `<img>`…) ne s'ouvrent pas, mais comptent,
 *   au niveau où ils sont posés ;
 * - une ouverture ferme ce que htmlparser2 ferme implicitement (`<p>` ferme
 *   `<p>`, `<li>` ferme `<li>`, `<td>` ferme `<td>`… — `OPEN_IMPLIES_CLOSE`) ;
 * - une fermeture remonte jusqu'à l'élément du même nom, s'il est ouvert, et
 *   ferme tout ce qui est au-dessus ; sinon elle est ignorée — sauf `</p>` et
 *   `</br>` orphelins, qui créent un élément ;
 * - `<x/>` ne ferme qu'en SVG et MathML ; ailleurs, `<div/>` OUVRE un `<div>`,
 *   comme dans htmlparser2 ;
 * - les attributs suivent la machine d'états d'htmlparser2 : le premier
 *   caractère d'un nom est pris tel quel, même `=` ou un guillemet — dans
 *   `<div =" >`, `="` est un NOM, et la balise se ferme au `>` ;
 * - commentaires et déclarations finissent où htmlparser2 les finit :
 *   `<!-->` et `<!--->` sont des commentaires déjà fermés, le caractère qui
 *   suit `<!` (ou `<!-`) est avalé sans être lu (`<!>` ne se ferme qu'au `>`
 *   suivant) ; `--!>` ne ferme pas un commentaire ;
 * - le contenu de `script`, `style`, `title`, `textarea`, `xmp` (texte brut)
 *   n'est pas lu comme des balises, jusqu'à la fermeture qu'htmlparser2
 *   reconnaît : `</nom` suivi d'un blanc ou de `>` — et ses comparaisons
 *   « insensibles à la casse » (`c | 0x20`) prennent aussi `\x1c` pour `<` et
 *   `\x0f` pour `/` (`rawTextEnd`).
 * La pile ne dépasse jamais `maxDepth + 1` (le balayage s'arrête avant) : la
 * recherche d'une fermeture coûte au plus `maxDepth` pas.
 *
 * Copie conforme de `server/markupBounds.ts`, pour le repli du navigateur, qui
 * n'avait aucune borne (le serveur et le client ne partagent pas de code) :
 * `server/test/markupBounds.test.ts` passe les deux. Toute modification de
 * l'une va avec l'autre.
 */

export interface MarkupLimits {
  /** Profondeur d'imbrication maximale acceptée (`<html>` compte pour 1). */
  maxDepth: number;
  /** Nombre maximal d'éléments. */
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

  /** Un élément créé sans rester ouvert (vide, auto-fermé, `</p>` ou `</br>` orphelin), posé au sommet de la pile. */
  const leaf = (): 'depth' | 'elements' | null => {
    if (++elements > limits.maxElements) return 'elements';
    return stack.length + 1 > limits.maxDepth ? 'depth' : null;
  };
  /** `</nom>` : ce qu'en fait le `onclosetag` d'htmlparser2. */
  const close = (name: string): 'depth' | 'elements' | null => {
    if ((FOREIGN.has(name) || HTML_INTEGRATION.has(name)) && foreign.length) foreign.pop();
    if (VOID.has(name)) return name === 'br' ? leaf() : null;
    const pos = stack.lastIndexOf(name);
    if (pos !== -1) stack.length = pos;
    else if (name === 'p') return leaf();
    return null;
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1 || lt + 1 >= n) break;
    const c = html[lt + 1];

    // ── Commentaires, déclarations, CDATA ──
    if (c === '!') {
      let end: number;
      if (html.startsWith('<!--', lt)) {
        // `<!--` vaut déjà `--` lu : `<!-->` et `<!--->` sont fermés.
        end = html.indexOf('-->', lt + 2);
        if (end === -1) break;
        i = end + 3;
      } else if (html.startsWith('<![CDATA[', lt)) {
        end = html.indexOf(']]>', lt + 9);
        if (end === -1) break;
        i = end + 3;
      } else {
        // Déclaration : le caractère après `<!` — après `<!-` s'il n'est pas
        // un second `-` — est avalé sans être lu, `>` compris.
        end = html.indexOf('>', html[lt + 2] === '-' ? lt + 4 : lt + 3);
        if (end === -1) break;
        i = end + 1;
      }
      continue;
    }
    // ── Instruction de traitement ──
    if (c === '?') {
      const end = html.indexOf('>', lt + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    // ── Fermeture ── (blancs tolérés après `</`, nom jusqu'à un blanc ou `>`)
    if (c === '/') {
      let j = lt + 2;
      while (j < n && isSpace(html[j])) j++;
      if (j < n && isAlpha(html[j])) {
        const start = j;
        while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        const over = close(html.slice(start, j).toLowerCase());
        if (over) return over;
      }
      const end = html.indexOf('>', j);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    // ── Texte : un `<` qui n'ouvre rien ──
    if (!isAlpha(c)) { i = lt + 1; continue; }

    // ── Ouverture : nom, puis attributs jusqu'au `>` ──
    let j = lt + 1;
    while (j < n && !endsName(html[j])) j++;
    const name = html.slice(lt + 1, j).toLowerCase();
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      const ch = html[j];
      if (ch === '>') { closed = true; j++; break; }
      if (isSpace(ch)) { j++; continue; }
      if (ch === '/') {
        // htmlparser2 tolère des blancs entre `/` et `>` ; tout autre
        // caractère est relu comme le début d'un attribut.
        j++;
        while (j < n && isSpace(html[j])) j++;
        if (j < n && html[j] === '>') { selfClosing = true; closed = true; j++; break; }
        continue;
      }
      // Nom d'attribut : son PREMIER caractère est pris tel quel, même `=` ou
      // un guillemet ; il finit sur `=`, un blanc, `/` ou `>`.
      j++;
      while (j < n && html[j] !== '=' && !endsName(html[j])) j++;
      while (j < n && isSpace(html[j])) j++;
      if (j < n && html[j] === '=') {
        j++;
        while (j < n && isSpace(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          if (end === -1) { j = n; break; }
          j = end + 1;
        } else {
          while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
        }
      }
    }
    if (!closed) break;

    const impliesClose = OPEN_IMPLIES_CLOSE.get(name);
    if (impliesClose) {
      while (stack.length && impliesClose.has(stack[stack.length - 1])) stack.pop();
    }
    if (VOID.has(name)) {
      const over = leaf();
      if (over) return over;
    } else {
      if (++elements > limits.maxElements) return 'elements';
      stack.push(name);
      if (FOREIGN.has(name)) foreign.push(true);
      else if (HTML_INTEGRATION.has(name)) foreign.push(false);
      if (stack.length > limits.maxDepth) return 'depth';
      if (selfClosing && foreign[foreign.length - 1]) stack.pop();
    }
    i = j;

    // ── Texte brut : rien n'est une balise jusqu'à sa fermeture ──
    if (RAW_TEXT.has(name) && !selfClosing) {
      const end = rawTextEnd(html, name, i);
      if (end === -1) break;
      const over = close(name);
      if (over) return over;
      const gt = html.indexOf('>', end);
      if (gt === -1) break;
      i = gt + 1;
    }
  }
  return null;
}

/**
 * Où se ferme un texte brut ouvert juste avant `from` : la position du blanc
 * ou du `>` qui suit `</nom`, ou -1. Rejoue `stateInSpecialTag` d'htmlparser2,
 * en une passe : sa comparaison `(c | 0x20) === attendu` prend aussi `\x1c`
 * pour `<` et `\x0f` pour `/` ; hors de `title`, il saute d'un bond au `<`
 * suivant quand rien n'est en cours (et ne voit alors pas `\x1c`).
 */
function rawTextEnd(html: string, name: string, from: number): number {
  const sequence = `</${name}`;
  const jumps = name !== 'title';
  const n = html.length;
  let k = 0;
  let i = from;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (k === sequence.length) {
      if (c === 0x3e || c === 0x20 || c === 0x0a || c === 0x09 || c === 0x0d || c === 0x0c) return i;
      k = 0;
    }
    if ((c | 0x20) === sequence.charCodeAt(k)) {
      k++;
    } else if (k === 0) {
      if (jumps) {
        const lt = html.indexOf('<', i + 1);
        if (lt === -1) return -1;
        i = lt + 1;
        k = 1;
        continue;
      }
    } else {
      k = c === 0x3c ? 1 : 0;
    }
    i++;
  }
  return -1;
}
