import type { Article } from '../types';

/**
 * Règles de correspondance de la recherche côté client.
 *
 * L'API greader de FreshRSS n'a pas de paramètre de recherche (vérifié de la
 * 1.20.2 à la 1.27.0 : `streamContents` ne lit que `xt`, `it`, `n`, `r`, `ot`,
 * `nt`, `c`, `s`, `output`). Le filtrage vit donc ici.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */

/** Minuscules et diacritiques dépliés : « Élection » et « election » se rejoignent. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/**
 * Texte lisible d'un fragment HTML.
 *
 * Les balises deviennent des espaces plutôt que rien : sans ça
 * `<b>moteur</b><i>recherche</i>` donnerait « moteurrecherche » et un mot
 * cherché à cheval sur deux balises matcherait par accident. Les entités sont
 * décodées, sinon « été » ne trouverait pas `l&#39;été`.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (whole: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les mots de la requête, normalisés, sans doublon ni vide. */
export function parseQuery(query: string): string[] {
  return [...new Set(normalizeForSearch(query).split(/\s+/).filter(Boolean))];
}

/**
 * Le texte cherchable d'un article, calculé UNE SEULE FOIS au balayage — jamais
 * à chaque frappe : refiltrer 10 000 articles doit rester instantané.
 */
export function articleHaystack(article: Article): string {
  const body = article.content || article.summary || '';
  return normalizeForSearch(`${stripHtml(article.title)} ${stripHtml(body)}`);
}

/** Tous les mots présents. Sans terme, rien ne correspond. */
export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  return terms.every((term) => haystack.includes(term));
}
