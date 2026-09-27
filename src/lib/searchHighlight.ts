import { normalizeForSearch, stripHtml } from './searchMatch';

/**
 * Dire POURQUOI une ligne est un résultat.
 *
 * La recherche fouille le corps entier des articles (`articleHaystack`), mais
 * la liste n'affiche que le titre et un résumé : sur « docker », 30 lignes sur
 * 50 ne montraient nulle part le mot cherché, et la liste passait pour une
 * liste non filtrée. Ces deux fonctions ramènent la preuve à l'écran — le
 * terme surligné là où il est visible, un extrait du corps quand il ne l'est
 * pas.
 */

export interface Segment {
  text: string;
  /** Ce morceau correspond à un terme de la recherche. */
  hit: boolean;
}

/**
 * Le texte déplié (comme la recherche le compare) et, pour chaque position
 * dépliée, la position correspondante dans le texte D'ORIGINE.
 *
 * Sans cette carte, surligner « election » dans « élection » décalerait tout
 * ce qui suit : `normalizeForSearch` décompose puis retire les diacritiques,
 * donc les deux chaînes n'ont ni la même longueur ni les mêmes indices.
 */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const ch of normalizeForSearch(text[i])) {
      folded += ch;
      at.push(i);
    }
  }
  at.push(text.length); // fin de chaîne : borne haute du dernier segment
  return { folded, at };
}

/** Les plages correspondantes, fusionnées, dans les indices du texte d'origine. */
function hitRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  const { folded, at } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const i = folded.indexOf(term, from);
      if (i === -1) break;
      ranges.push([at[i], at[i + term.length] ?? text.length]);
      from = i + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Découpe `text` pour le rendu : les morceaux correspondants portent `hit`. */
export function highlight(text: string, terms: readonly string[]): Segment[] {
  const ranges = terms.length ? hitRanges(text, terms) : [];
  if (!ranges.length) return [{ text, hit: false }];
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

/** Combien de texte garder de part et d'autre de la correspondance. */
const SNIPPET_RADIUS = 90;

/**
 * Le voisinage de la première correspondance, entre ellipses ; `null` si le
 * texte ne correspond pas.
 */
export function snippet(text: string, terms: readonly string[], radius = SNIPPET_RADIUS): string | null {
  const ranges = terms.length ? hitRanges(text, terms) : [];
  if (!ranges.length) return null;
  const [start, end] = ranges[0];
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

/**
 * Ce qu'une ligne de résultat doit afficher sous son titre : son résumé quand
 * il porte déjà le terme, sinon l'extrait du corps qui l'a fait sortir, sinon
 * le résumé — une ligne sans explication reste préférable à une ligne vide.
 */
export function resultSummary(
  article: { summary: string; content: string },
  terms: readonly string[],
): string {
  if (!terms.length) return article.summary;
  if (hitRanges(article.summary, terms).length) return article.summary;
  return snippet(stripHtml(article.content), terms) ?? article.summary;
}
