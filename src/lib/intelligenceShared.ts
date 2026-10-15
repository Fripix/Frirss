/**
 * Text normalisation and list helpers shared by the Interesting rankers, so
 * every model tokenises, stems and maps synonyms the same way.
 */
import type { Article } from '../types';

export const meaningfulShortTerms = new Set(['ai', 'eu', 'uk', 'us', 'ua', 'un', 'uk']);

export function tokenize(text: string): Set<string> {
  const words = text.toLocaleLowerCase().replace(/<[^>]*>/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length >= 3 || meaningfulShortTerms.has(word)));
}

export function validVote(vote: unknown): vote is 1 | -1 {
  return vote === 1 || vote === -1;
}

const synonymGroups: string[][] = [
  ['defence', 'defense', 'military', 'armed', 'security'],
  ['ai', 'artificial', 'intelligence', 'machine', 'learning'],
  ['economy', 'economic', 'economics', 'finance', 'financial', 'markets'],
  ['government', 'politics', 'political', 'policy', 'parliament'],
  ['climate', 'environment', 'emissions', 'warming', 'renewable'],
  ['company', 'companies', 'business', 'corporate', 'enterprise'],
  ['car', 'cars', 'automobile', 'automotive', 'vehicle', 'vehicles'],
  ['buy', 'bought', 'purchase', 'purchasing', 'procurement'],
  ['produce', 'produced', 'production', 'manufacturing', 'manufacture'],
];

export const synonymMap = new Map<string, string>();
for (const group of synonymGroups) for (const word of group) synonymMap.set(word, group[0]);

/**
 * A small deterministic stemmer for common English inflections. It is not a
 * full Porter implementation, but handles plurals, -ed and -ing forms without
 * leaving doubled consonants or losing a final silent "e" (running/run, hiking/hike).
 */
export function stemTerm(term: string): string {
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;

  if (term.length > 5 && term.endsWith('sses')) return term.slice(0, -2);
  if (term.length > 4 && /(ches|shes|xes|zes)$/.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith('s') && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);

  let stem = term;
  if (stem.length > 5 && stem.endsWith('ing')) {
    stem = stem.slice(0, -3);
  } else if (stem.length > 4 && stem.endsWith('ed')) {
    stem = stem.slice(0, -2);
  } else {
    return stem;
  }

  // Remove a doubled final consonant: runn -> run, stopp -> stop.
  const hadDoubleConsonant = /(bb|cc|dd|ff|gg|mm|nn|pp|rr|tt)$/.test(stem);
  if (hadDoubleConsonant) stem = stem.slice(0, -1);

  // Restore a silent e for common CVC forms: hik -> hike, mak -> make.
  // Do not do this after de-doubling: runn -> run, not rune.
  if (!hadDoubleConsonant && stem.length >= 3 && /[^aeiou][aeiou][^aeiouwxy]$/.test(stem)) stem += 'e';
  return stem;
}

export function normalizeTerm(term: string): string {
  const stem = stemTerm(term);
  return synonymMap.get(stem) ?? stem;
}

export function normalizedTokens(text: string): Set<string> {
  return new Set([...tokenize(text)].map(normalizeTerm));
}

/** The identity used for source diversity: the feed stream id, else its title. */
export function articleSource(article: Article): string {
  return article.sourceId || article.source || '';
}

/**
 * Avoid more than maxRun consecutive items from one source when alternatives
 * exist. Items keep their relative order otherwise; nothing is dropped.
 */
export function diversifyBy<T>(items: T[], sourceOf: (item: T) => string, maxRun = 2): T[] {
  const remaining = [...items];
  const result: T[] = [];
  while (remaining.length) {
    const recentSources = result.slice(-maxRun).map(sourceOf);
    const alternativeIndex = remaining.findIndex((item) => {
      const source = sourceOf(item);
      return recentSources.length < maxRun || !recentSources.every((recent) => recent === source);
    });
    // If every remaining item is from the same source, do not lose articles;
    // relevance order is the least-bad fallback.
    const nextIndex = alternativeIndex >= 0 ? alternativeIndex : 0;
    result.push(remaining.splice(nextIndex, 1)[0]);
  }
  return result;
}

/** Avoid more than maxRun consecutive items from one source when alternatives exist. */
export function diversify(articles: Article[], maxRun = 2): Article[] {
  return diversifyBy(articles, articleSource, maxRun);
}
