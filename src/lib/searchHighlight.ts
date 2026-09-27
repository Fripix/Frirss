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

/**
 * Combien de texte garder AVANT la correspondance.
 *
 * Volontairement court. La ligne d'article coupe le résumé à deux lignes
 * (`line-clamp-2`), soit ~90 caractères dans un panneau de liste ordinaire :
 * un extrait qui CENTRE la correspondance la pousse hors du cadre visible.
 * Mesuré sur l'instance de dev le 2026-09-27, avec un rayon de 90 de part et
 * d'autre : 29 extraits sur 34 avaient leur terme surligné coupé — la ligne
 * restait inexpliquée, ce que l'extrait existe précisément pour corriger.
 */
const SNIPPET_LEAD = 20;

/**
 * Jusqu'où une correspondance dans le résumé reste visible sans recadrage.
 *
 * Prudent : la largeur de la ligne varie (panneau de liste, carte de grille,
 * téléphone), et recadrer un résumé dont le terme était déjà visible ne coûte
 * qu'une ellipse, alors que l'inverse rend la ligne inexplicable.
 */
const VISIBLE_SUMMARY = 70;

/** Longueur visée, contexte d'après compris : de quoi remplir les deux lignes. */
const SNIPPET_LENGTH = 200;

/**
 * Le voisinage de la première correspondance, entre ellipses ; `null` si le
 * texte ne correspond pas. La correspondance tombe au DÉBUT, pour rester
 * visible là où la ligne coupe.
 */
export function snippet(text: string, terms: readonly string[], lead = SNIPPET_LEAD): string | null {
  const ranges = terms.length ? hitRanges(text, terms) : [];
  if (!ranges.length) return null;
  const [start] = ranges[0];
  const from = Math.max(0, start - lead);
  const to = Math.min(text.length, from + SNIPPET_LENGTH);
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
  const inSummary = hitRanges(article.summary, terms)[0];
  // Le résumé porte le terme, mais l'y laisser ne suffit pas : au-delà des deux
  // lignes rendues, il est aussi invisible que s'il n'y était pas. Même
  // recadrage que pour le corps.
  if (inSummary) {
    return inSummary[0] <= VISIBLE_SUMMARY
      ? article.summary
      : snippet(article.summary, terms) ?? article.summary;
  }
  return snippet(stripHtml(article.content), terms) ?? article.summary;
}
