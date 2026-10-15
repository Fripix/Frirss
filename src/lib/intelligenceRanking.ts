import type { Article } from '../types';
import type { ArticleFeedback } from '../api/intelligence';
import { diversify, normalizeTerm, normalizedTokens, synonymMap, tokenize, validVote } from './intelligenceShared';
import { rankIntelligenceNext, type IntelligenceContext } from './intelligenceNext';

export type { IntelligenceContext, SavedArticleSignal } from './intelligenceNext';

export type InterestingAlgorithm = 'current' | 'weighted-idf' | 'synonyms' | 'topics' | 'combined' | 'microsoft-news' | 'personal-news' | 'intelligence-next';

export const INTERESTING_ALGORITHMS: Array<{ value: InterestingAlgorithm; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'weighted-idf', label: 'Weighted terms + IDF' },
  { value: 'synonyms', label: 'Synonyms + stemming' },
  { value: 'topics', label: 'Topic / interest profiles' },
  { value: 'combined', label: 'Combined' },
  { value: 'microsoft-news', label: 'MS NewsRec' },
  { value: 'personal-news', label: 'Personal News' },
  { value: 'intelligence-next', label: 'Intelligence Next' },
];

/** The default; also the fallback for a missing or unknown saved choice. */
export const DEFAULT_INTERESTING_ALGORITHM: InterestingAlgorithm = 'current';

export function isInterestingAlgorithm(value: unknown): value is InterestingAlgorithm {
  return INTERESTING_ALGORITHMS.some((algorithm) => algorithm.value === value);
}

function articleText(article: Article): string {
  return `${article.title} ${article.summary} ${article.content}`;
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

const topicKeywords: Record<string, string[]> = {
  security: ['defence', 'defense', 'military', 'army', 'navy', 'war', 'nato', 'weapon', 'missile', 'security', 'ukraine', 'iran'],
  technology: ['technology', 'software', 'computer', 'chip', 'ai', 'artificial', 'intelligence', 'data', 'robot', 'openai', 'google', 'apple'],
  economy: ['economy', 'economic', 'finance', 'financial', 'market', 'stock', 'bank', 'trade', 'business', 'company', 'inflation'],
  politics: ['politics', 'political', 'government', 'election', 'minister', 'parliament', 'president', 'policy', 'europe', 'germany'],
  science: ['science', 'research', 'study', 'scientist', 'space', 'physics', 'biology', 'health', 'medical', 'climate', 'energy'],
  culture: ['book', 'movie', 'film', 'music', 'art', 'game', 'culture', 'author', 'celebrity', 'sport'],
};

/**
 * The taxonomy topics a text mentions.
 *
 * `listedSynonyms` also looks each word up as written. `normalizeTerm` stems a
 * word before its synonym lookup, so the inflected forms the synonym groups
 * list ("learning", "armed", "emissions", "warming", "markets", "politics")
 * never reached their group, and e.g. a deep-learning article had no topic.
 * Only the exact listed spellings are added, never other inflections ("learn"
 * is not AI, "warm" is not climate), so a text can gain topics but never lose
 * one. The Topic model (and so Combined) uses it; Personal News keeps the
 * original lookup for its topic features, so its rankings are unchanged.
 * Fixing the shared lookup for every model is a separate, deferred change.
 */
function topicSet(text: string, listedSynonyms = false): Set<string> {
  const terms = normalizedTokens(text);
  if (listedSynonyms) {
    for (const word of tokenize(text)) {
      const synonym = synonymMap.get(word);
      if (synonym !== undefined) terms.add(synonym);
    }
  }
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

/**
 * Document frequency over the articles being ranked. Feedback examples are
 * deliberately excluded: they are the reader's history, not the corpus. Counting
 * them made every topic the reader voted on look common, which lowered the IDF of
 * exactly the terms the profile is built from.
 */
function candidateDocumentFrequency(documents: Iterable<Set<string>>): Map<string, number> {
  const df = new Map<string, number>();
  for (const terms of documents) for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
  return df;
}

/**
 * Sums per-term (or per-topic) weights separately for upvotes and downvotes and
 * normalises each polarity on its own, so one polarity cannot swamp the other
 * just because the reader casts more votes of that kind.
 */
function polarityProfiles<T>(
  examples: Array<{ vote: 1 | -1; keys: Iterable<T> }>,
  weight: (key: T) => number,
  normalise: 'per-example' | 'l1',
): { positive: Map<T, number>; negative: Map<T, number> } {
  const build = (vote: 1 | -1) => {
    const profile = new Map<T, number>();
    let exampleCount = 0;
    for (const example of examples) {
      if (example.vote !== vote) continue;
      exampleCount++;
      for (const key of example.keys) profile.set(key, (profile.get(key) ?? 0) + weight(key));
    }
    const scale = normalise === 'per-example'
      ? exampleCount
      : [...profile.values()].reduce((sum, value) => sum + Math.abs(value), 0);
    if (scale > 0) for (const [key, value] of profile) profile.set(key, value / scale);
    return profile;
  };
  return { positive: build(1), negative: build(-1) };
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

  // IDF comes from the candidate articles only (see candidateDocumentFrequency).
  // Both modes apply it: they differ only in how term forms are normalised.
  const df = candidateDocumentFrequency(candidates.map((item) => item.terms));
  const idf = (term: string) => Math.log((candidates.length + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  // Rocchio-style profiles: the share of upvotes and the share of downvotes
  // that contain each term. IDF belongs only in candidate scoring; weighting
  // both stages squares the rarity effect.
  const { positive: liked, negative: disliked } = polarityProfiles(
    examples.map((example) => ({ vote: example.vote, keys: example.terms })),
    () => 1,
    'per-example',
  );

  const scored = candidates.map(({ article, terms }) => {
    let positive = 0;
    let negative = 0;
    for (const term of terms) {
      const rarity = idf(term);
      positive += (liked.get(term) ?? 0) * rarity;
      negative += (disliked.get(term) ?? 0) * rarity;
    }
    const score = (positive - negative * 1.25) / Math.max(1, Math.sqrt(terms.size)) + freshness(article, now);
    return { article, score };
  });
  return scored.sort((a, b) => b.score - a.score).map(({ article }) => article);
}

function rankTopics(articles: Article[], feedback: ArticleFeedback[], now: number): Article[] {
  // Share of upvotes and share of downvotes touching each topic, normalised per
  // polarity, so a topic that is in every downvote is not rescued by a few of
  // many upvotes.
  const { positive, negative } = polarityProfiles(
    feedback
      .filter((item) => validVote(item.vote))
      .map((item) => ({ vote: item.vote, keys: topicSet(`${item.title} ${item.summary} ${item.content}`, true) })),
    () => 1,
    'per-example',
  );
  return articles.map((article) => {
    const topics = topicSet(articleText(article), true);
    let score = 0;
    for (const topic of topics) score += (positive.get(topic) ?? 0) - (negative.get(topic) ?? 0);
    return { article, score: score / Math.max(1, topics.size) + freshness(article, now) };
  }).sort((a, b) => b.score - a.score).map(({ article }) => article);
}

/** Candidates reranked for diversity by Personal News; the rest keep relevance order. */
const PERSONAL_NEWS_MMR_POOL = 120;

/**
 * Personal News: a dependency-free hybrid recommender inspired by
 * content-based personalisation and maximal marginal relevance (MMR).
 *
 * It discovers interests from the user's own voted article vocabulary rather
 * than requiring a fixed topic taxonomy, blends article-to-feedback similarity
 * with a signed term profile, and greedily reranks for novelty and source/topic
 * diversity. This is a local heuristic, not a port of the Python prototype's
 * trained BERTopic/ALS/association-rule pipeline.
 */
function rankPersonalNews(articles: Article[], feedback: ArticleFeedback[], now: number): Article[] {
  const candidates = articles.map((article) => ({
    article,
    terms: normalizedTokens(articleText(article)),
    topics: topicSet(articleText(article)),
  }));
  const examples = feedback
    .filter((item) => validVote(item.vote))
    .map((item) => ({
      vote: item.vote,
      terms: normalizedTokens(`${item.title} ${item.summary} ${item.content}`),
      topics: topicSet(`${item.title} ${item.summary} ${item.content}`),
    }));
  const df = candidateDocumentFrequency(candidates.map((item) => item.terms));
  const idf = (term: string) => Math.log((candidates.length + 1) / ((df.get(term) ?? 0) + 1)) + 1;
  // Build each IDF-weighted vector once; the similarity loops below reuse them.
  const vectorFor = (terms: Set<string>) => {
    const weights = new Map([...terms].map((term) => [term, idf(term)]));
    let norm = 0;
    for (const value of weights.values()) norm += value * value;
    return { weights, norm: Math.sqrt(norm) };
  };
  type Vector = ReturnType<typeof vectorFor>;
  const cosine = (a: Vector, b: Vector) => {
    if (!a.weights.size || !b.weights.size) return 0;
    const [small, large] = a.weights.size <= b.weights.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, value] of small.weights) dot += value * (large.weights.get(term) ?? 0);
    return dot / Math.max(1e-9, a.norm * b.norm);
  };
  const candidateVectors = candidates.map((candidate) => vectorFor(candidate.terms));
  const exampleVectors = examples.map((example) => ({ vote: example.vote, vector: vectorFor(example.terms) }));

  // Learned interests: IDF-weighted term profile and topic profile, each
  // L1-normalised per polarity so affinities stay in [-1, 1] and upvotes and
  // downvotes are judged on their own scale.
  const termProfile = polarityProfiles(
    examples.map((example) => ({ vote: example.vote, keys: example.terms })),
    idf,
    'l1',
  );
  const topicProfile = polarityProfiles(
    examples.map((example) => ({ vote: example.vote, keys: example.topics })),
    () => 1,
    'l1',
  );
  const affinity = <T,>(keys: Set<T>, profile: { positive: Map<T, number>; negative: Map<T, number> }) => {
    let sum = 0;
    for (const key of keys) sum += (profile.positive.get(key) ?? 0) - (profile.negative.get(key) ?? 0);
    return sum;
  };
  const meanTop = (values: number[]) => {
    const top = values.sort((a, b) => b - a).slice(0, 3);
    return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  };

  const scored = candidates.map((candidate, index) => {
    const termAffinity = affinity(candidate.terms, termProfile);
    const topicAffinity = affinity(candidate.topics, topicProfile);
    const positive: number[] = [];
    const negative: number[] = [];
    for (const example of exampleVectors) {
      (example.vote === 1 ? positive : negative).push(cosine(candidateVectors[index], example.vector));
    }
    const feedbackAffinity = meanTop(positive) - meanTop(negative) * 1.2;
    const ageHours = Math.max(0, (now - candidate.article.published) / 3600000);
    const fresh = 1 / (1 + ageHours / 72);
    const relevance = feedbackAffinity * 0.55 + termAffinity * 0.25 + topicAffinity * 0.12 + fresh * 0.08;
    return { ...candidate, vector: candidateVectors[index], relevance };
  });

  // MMR-style greedy reranking: trade a little relevance for new vocabulary,
  // topic coverage and publishers. Only the most relevant PERSONAL_NEWS_MMR_POOL
  // candidates are reranked; the rest follow in relevance order. Each pick
  // updates the remaining items' maximum similarity incrementally, so the cost
  // is O(pool^2) similarity checks instead of growing cubically with the list.
  const byRelevance = [...scored].sort((a, b) => b.relevance - a.relevance);
  const remaining = byRelevance.slice(0, PERSONAL_NEWS_MMR_POOL)
    .map((item) => ({ item, maxSimilarity: 0, maxTopicOverlap: 0 }));
  const result: typeof scored = [];
  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    const recentSources = result.slice(-2).map((item) => item.article.sourceId || item.article.source || '');
    for (let index = 0; index < remaining.length; index++) {
      const { item, maxSimilarity, maxTopicOverlap } = remaining[index];
      const source = item.article.sourceId || item.article.source || '';
      const sourcePenalty = source && recentSources.includes(source) ? 0.08 : 0;
      const mmr = item.relevance - maxSimilarity * 0.22 - maxTopicOverlap * 0.08 - sourcePenalty;
      if (mmr > bestScore) { bestScore = mmr; bestIndex = index; }
    }
    const [{ item: selected }] = remaining.splice(bestIndex, 1);
    result.push(selected);
    for (const entry of remaining) {
      entry.maxSimilarity = Math.max(entry.maxSimilarity, cosine(entry.item.vector, selected.vector));
      if (entry.item.topics.size) {
        const shared = [...entry.item.topics].filter((topic) => selected.topics.has(topic)).length;
        const overlap = shared / Math.max(1, new Set([...entry.item.topics, ...selected.topics]).size);
        entry.maxTopicOverlap = Math.max(entry.maxTopicOverlap, overlap);
      }
    }
  }
  return [...result, ...byRelevance.slice(PERSONAL_NEWS_MMR_POOL)].map(({ article }) => article);
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

  // Document frequency over candidate articles only (see candidateDocumentFrequency).
  const df = candidateDocumentFrequency(
    candidates.map(({ sections }) => new Set([...sections.title, ...sections.summary, ...sections.content])),
  );
  const idf = (term: string) => Math.log(1 + (candidates.length + 1) / ((df.get(term) ?? 0) + 1));
  // Weighted section vectors are built once and reused for every comparison.
  const weighted = (terms: Set<string>) => {
    const weights = new Map([...terms].map((term) => [term, idf(term)]));
    let norm = 0;
    for (const value of weights.values()) norm += value * value;
    return { weights, norm: Math.sqrt(norm) };
  };
  type Weighted = ReturnType<typeof weighted>;
  const weightedSections = (sections: Sections) => ({
    title: weighted(sections.title),
    summary: weighted(sections.summary),
    content: weighted(sections.content),
  });
  const cosine = (a: Weighted, b: Weighted) => {
    if (!a.weights.size || !b.weights.size) return 0;
    let dot = 0;
    for (const [term, value] of a.weights) dot += value * (b.weights.get(term) ?? 0);
    return dot / Math.max(1e-9, a.norm * b.norm);
  };
  type WeightedSections = ReturnType<typeof weightedSections>;
  const sectionSimilarity = (a: WeightedSections, b: WeightedSections) =>
    cosine(a.title, b.title) * 0.5 +
    cosine(a.summary, b.summary) * 0.3 +
    cosine(a.content, b.content) * 0.2;
  const weightedExamples = examples.map((example) => ({ vote: example.vote, sections: weightedSections(example.sections) }));

  const scored = candidates.map(({ article, sections }) => {
    const candidateSections = weightedSections(sections);
    const evidence = weightedExamples.map((example) => ({
      vote: example.vote,
      similarity: sectionSimilarity(candidateSections, example.sections),
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
 * `context` (subscriptions, saved articles) is used by Intelligence Next only.
 */
export function rankInterestingArticles(
  articles: Article[],
  feedback: ArticleFeedback[],
  now = Date.now(),
  algorithm: InterestingAlgorithm = DEFAULT_INTERESTING_ALGORITHM,
  context: IntelligenceContext = {},
): Article[] {
  if (algorithm === 'current') return rankCurrent(articles, feedback, now);
  if (algorithm === 'intelligence-next') return rankIntelligenceNext(articles, feedback, now, context);
  if (algorithm === 'weighted-idf') return rankByTermModel(articles, feedback, now, 'weighted-idf');
  if (algorithm === 'synonyms') return rankByTermModel(articles, feedback, now, 'synonyms');
  if (algorithm === 'topics') return rankTopics(articles, feedback, now);
  if (algorithm === 'microsoft-news') return rankMicrosoftNews(articles, feedback, now);
  if (algorithm === 'personal-news') return rankPersonalNews(articles, feedback, now);

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
