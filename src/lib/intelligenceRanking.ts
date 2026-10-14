import type { Article } from '../types';
import type { ArticleFeedback } from '../api/intelligence';

export type InterestingAlgorithm = 'current' | 'weighted-idf' | 'synonyms' | 'topics' | 'combined' | 'microsoft-news';

export const INTERESTING_ALGORITHMS: Array<{ value: InterestingAlgorithm; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'weighted-idf', label: 'Weighted terms + IDF' },
  { value: 'synonyms', label: 'Synonyms + stemming' },
  { value: 'topics', label: 'Topic / interest profiles' },
  { value: 'combined', label: 'Combined' },
  { value: 'microsoft-news', label: 'Microsoft NewsRec (attention-inspired)' },
];

const meaningfulShortTerms = new Set(['ai', 'eu', 'uk', 'us', 'ua', 'un', 'uk']);

function tokenize(text: string): Set<string> {
  const words = text.toLocaleLowerCase().replace(/<[^>]*>/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length >= 3 || meaningfulShortTerms.has(word)));
}

function articleText(article: Article): string {
  return `${article.title} ${article.summary} ${article.content}`;
}

function validVote(vote: unknown): vote is 1 | -1 {
  return vote === 1 || vote === -1;
}

/** Existing baseline, with source identifiers excluded from lexical similarity. */
function rankCurrent(articles: Article[], feedback: ArticleFeedback[], now: number): Article[] {
  const examples = feedback
    .filter((item) => validVote(item.vote))
    .map((item) => ({
      vote: item.vote,
      terms: tokenize(`${item.title} ${item.summary} ${item.content}`),
    }));
  const score = (article: Article) => {
    const terms = tokenize(articleText(article));
    let positive = 0;
    let negative = 0;
    for (const example of examples) {
      let shared = 0;
      for (const term of example.terms) if (terms.has(term)) shared++;
      const similarity = shared / Math.max(1, Math.sqrt(terms.size * example.terms.size));
      if (example.vote === 1) positive += similarity;
      else if (example.vote === -1) negative += similarity;
    }
    const ageHours = Math.max(0, (now - article.published) / 3600000);
    return positive - negative * 1.25 + (1 / (1 + ageHours / 72)) * 0.03;
  };
  return [...articles].sort((a, b) => score(b) - score(a));
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

const synonymMap = new Map<string, string>();
for (const group of synonymGroups) for (const word of group) synonymMap.set(word, group[0]);

/**
 * A small deterministic stemmer for common English inflections. It is not a
 * full Porter implementation, but handles plurals, -ed and -ing forms without
 * leaving doubled consonants or losing a final silent "e" (running/run, hiking/hike).
 */
function stemTerm(term: string): string {
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

function normalizeTerm(term: string): string {
  const stem = stemTerm(term);
  return synonymMap.get(stem) ?? stem;
}

function normalizedTokens(text: string): Set<string> {
  return new Set([...tokenize(text)].map(normalizeTerm));
}

const topicKeywords: Record<string, string[]> = {
  security: ['defence', 'defense', 'military', 'army', 'navy', 'war', 'nato', 'weapon', 'missile', 'security', 'ukraine', 'iran'],
  technology: ['technology', 'software', 'computer', 'chip', 'ai', 'artificial', 'intelligence', 'data', 'robot', 'openai', 'google', 'apple'],
  economy: ['economy', 'economic', 'finance', 'financial', 'market', 'stock', 'bank', 'trade', 'business', 'company', 'inflation'],
  politics: ['politics', 'political', 'government', 'election', 'minister', 'parliament', 'president', 'policy', 'europe', 'germany'],
  science: ['science', 'research', 'study', 'scientist', 'space', 'physics', 'biology', 'health', 'medical', 'climate', 'energy'],
  culture: ['book', 'movie', 'film', 'music', 'art', 'game', 'culture', 'author', 'celebrity', 'sport'],
};

function topicSet(text: string): Set<string> {
  const terms = normalizedTokens(text);
  const topics = new Set<string>();
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((word) => terms.has(normalizeTerm(word)))) topics.add(topic);
  }
  return topics;
}

function freshness(article: Article, now: number): number {
  const ageHours = Math.max(0, (now - article.published) / 3600000);
  return (1 / (1 + ageHours / 72)) * 0.03;
}

function rankByTermModel(
  articles: Article[],
  feedback: ArticleFeedback[],
  now: number,
  mode: 'weighted-idf' | 'synonyms',
): Article[] {
  const termsFor = mode === 'synonyms' ? normalizedTokens : tokenize;
  const candidates = articles.map((article) => ({ article, terms: termsFor(articleText(article)) }));
  const examples = feedback
    .filter((item) => validVote(item.vote))
    .map((item) => ({ vote: item.vote, terms: termsFor(`${item.title} ${item.summary} ${item.content}`) }));

  // Estimate document frequency over candidate articles and feedback examples,
  // so the profile and candidates use the same corpus and IDF is applied once.
  const df = new Map<string, number>();
  for (const document of [...candidates.map((item) => item.terms), ...examples.map((item) => item.terms)]) {
    for (const term of document) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const documentCount = candidates.length + examples.length;
  const idf = (term: string) => Math.log((documentCount + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  // Keep the preference profile as raw signed vote counts. IDF belongs only
  // in candidate scoring; weighting both stages squares the rarity effect.
  const profile = new Map<string, number>();
  for (const example of examples) {
    for (const term of example.terms) {
      profile.set(term, (profile.get(term) ?? 0) + example.vote);
    }
  }

  const scored = candidates.map(({ article, terms }) => {
    let positive = 0;
    let negative = 0;
    for (const term of terms) {
      const preference = profile.get(term) ?? 0;
      const rarity = mode === 'weighted-idf' ? idf(term) : 1;
      if (preference > 0) positive += preference * rarity;
      else if (preference < 0) negative += Math.abs(preference) * rarity;
    }
    const score = (positive - negative * 1.25) / Math.max(1, Math.sqrt(terms.size)) + freshness(article, now);
    return { article, score };
  });
  return scored.sort((a, b) => b.score - a.score).map(({ article }) => article);
}

function rankTopics(articles: Article[], feedback: ArticleFeedback[], now: number): Article[] {
  const profile = new Map<string, number>();
  for (const item of feedback) {
    if (!validVote(item.vote)) continue;
    for (const topic of topicSet(`${item.title} ${item.summary} ${item.content}`)) {
      profile.set(topic, (profile.get(topic) ?? 0) + item.vote);
    }
  }
  return articles.map((article) => {
    const topics = topicSet(articleText(article));
    let score = 0;
    for (const topic of topics) score += profile.get(topic) ?? 0;
    return { article, score: score / Math.max(1, topics.size) + freshness(article, now) };
  }).sort((a, b) => b.score - a.score).map(({ article }) => article);
}

/** Avoid more than maxRun consecutive items from one source when alternatives exist. */
function diversify(articles: Article[], maxRun = 2): Article[] {
  const remaining = [...articles];
  const result: Article[] = [];
  while (remaining.length) {
    const recentSources = result.slice(-maxRun).map((article) => article.sourceId || article.source || '');
    const alternativeIndex = remaining.findIndex((article) => {
      const source = article.sourceId || article.source || '';
      return recentSources.length < maxRun || !recentSources.every((recent) => recent === source);
    });
    // If every remaining item is from the same source, do not lose articles;
    // relevance order is the least-bad fallback.
    const nextIndex = alternativeIndex >= 0 ? alternativeIndex : 0;
    result.push(remaining.splice(nextIndex, 1)[0]);
  }
  return result;
}


/**
 * Lightweight, local adaptation inspired by Microsoft's NewsRec/NRMS family.
 *
 * This is NOT the official neural NRMS model: that implementation expects
 * pretrained word embeddings and a trained TensorFlow model. This variant
 * keeps FriRSS dependency-free and borrows the useful high-level idea of
 * attending to the most relevant parts of a reader's positive/negative history.
 * It weights title, summary and body separately, applies corpus IDF, then uses
 * candidate-conditioned attention over feedback examples so one prolific
 * topic cannot dominate solely because it has more votes.
 */
function rankMicrosoftNews(articles: Article[], feedback: ArticleFeedback[], now: number): Article[] {
  type Sections = { title: Set<string>; summary: Set<string>; content: Set<string> };
  const sectionsFor = (title: string, summary: string, content: string): Sections => ({
    title: tokenize(title),
    summary: tokenize(summary),
    content: tokenize(content),
  });
  const candidates = articles.map((article) => ({
    article,
    sections: sectionsFor(article.title, article.summary, article.content),
  }));
  const examples = feedback
    .filter((item) => validVote(item.vote))
    .map((item) => ({
      vote: item.vote,
      sections: sectionsFor(item.title, item.summary, item.content),
    }));

  const documents = [
    ...candidates.map(({ sections }) => sections),
    ...examples.map(({ sections }) => sections),
  ];
  const df = new Map<string, number>();
  for (const doc of documents) {
    const terms = new Set([...doc.title, ...doc.summary, ...doc.content]);
    for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = (term: string) => Math.log(1 + (documents.length + 1) / ((df.get(term) ?? 0) + 1));
  const weighted = (terms: Set<string>) => new Map([...terms].map((term) => [term, idf(term)]));
  const cosine = (left: Set<string>, right: Set<string>) => {
    if (!left.size || !right.size) return 0;
    const a = weighted(left);
    const b = weighted(right);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const value of a.values()) normA += value * value;
    for (const value of b.values()) normB += value * value;
    for (const [term, value] of a) dot += value * (b.get(term) ?? 0);
    return dot / Math.max(1e-9, Math.sqrt(normA * normB));
  };
  const sectionSimilarity = (a: Sections, b: Sections) =>
    cosine(a.title, b.title) * 0.5 +
    cosine(a.summary, b.summary) * 0.3 +
    cosine(a.content, b.content) * 0.2;

  const scored = candidates.map(({ article, sections }) => {
    const evidence = examples.map((example) => ({
      vote: example.vote,
      similarity: sectionSimilarity(sections, example.sections),
    }));
    // Candidate-conditioned attention: sharpen the strongest evidence while
    // normalizing each polarity separately, so many weak votes do not swamp
    // one strong match. The small floor avoids numerical underflow.
    const aggregate = (vote: 1 | -1) => {
      const matching = evidence.filter((item) => item.vote === vote && item.similarity > 0);
      if (!matching.length) return 0;
      const weights = matching.map((item) => Math.exp(Math.min(12, item.similarity * 8)));
      const total = weights.reduce((sum, value) => sum + value, 0);
      return matching.reduce((sum, item, index) => sum + item.similarity * weights[index], 0) / total;
    };
    const positive = aggregate(1);
    const negative = aggregate(-1);
    const score = positive - negative * 1.35 + freshness(article, now);
    return { article, score };
  });
  return diversify(scored.sort((a, b) => b.score - a.score).map(({ article }) => article));
}

/**
 * Local deterministic ranking methods for the Interesting feed.
 * All lexical models use article text only; source identifiers are reserved for
 * diversification, where source identity is compared consistently.
 */
export function rankInterestingArticles(
  articles: Article[],
  feedback: ArticleFeedback[],
  now = Date.now(),
  algorithm: InterestingAlgorithm = 'current',
): Article[] {
  if (algorithm === 'current') return rankCurrent(articles, feedback, now);
  if (algorithm === 'weighted-idf') return rankByTermModel(articles, feedback, now, 'weighted-idf');
  if (algorithm === 'synonyms') return rankByTermModel(articles, feedback, now, 'synonyms');
  if (algorithm === 'topics') return rankTopics(articles, feedback, now);
  if (algorithm === 'microsoft-news') return rankMicrosoftNews(articles, feedback, now);

  const weighted = rankByTermModel(articles, feedback, now, 'weighted-idf');
  const synonyms = rankByTermModel(articles, feedback, now, 'synonyms');
  const topics = rankTopics(articles, feedback, now);
  // Object identity, not article.id, prevents collisions from duplicate or missing IDs.
  const rankMaps = [weighted, synonyms, topics].map(
    (ranked) => new Map(ranked.map((article, index) => [article, index])),
  );
  const scores = new Map<Article, number>();
  for (const article of articles) {
    const score = rankMaps.reduce(
      (sum, ranks, index) => sum + 1 / (20 + (ranks.get(article) ?? articles.length)) * [0.45, 0.3, 0.25][index],
      0,
    );
    scores.set(article, score);
  }
  const combined = [...articles].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  return diversify(combined);
}
