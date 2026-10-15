/**
 * Intelligence Next — a local, deterministic and explainable ranker for the
 * Interesting view.
 *
 * Every signal becomes a bounded piece of evidence in [0, 1]:
 *
 * - explicit votes (strong): similarity to upvoted / downvoted articles,
 * - starred and read-later articles (weak positive),
 * - subscriptions (weak positive): every subscribed feed is a feed-level
 *   example, profiled from its recent articles plus its title and folders;
 *   an article is corroborated by the closest feeds of *other publishers*
 *   (feeds grouped by site host). Each feed is one unit-length profile however
 *   many articles it has, a just-added feed counts from its title and folders
 *   alone, and a repetitive feed — or its sibling feeds on the same site —
 *   cannot vouch for itself,
 * - a small own-feed prior: every subscribed feed has the same fixed budget,
 *   shared among its candidates, so a niche feed's few articles each get a
 *   little and a prolific feed's many get almost nothing,
 * - freshness, which scales relevance instead of replacing it. An undated
 *   article counts as neither new nor old.
 *
 * Example evidence is support-aware: it is the similarity of the best
 * matching example, discounted when few *distinct* examples back it up (one
 * example gives half its similarity, two give three quarters, …). Near
 * duplicates — the same story voted or saved twice, or syndicated to another
 * feed — count once; issues of a series in one feed do not. So one vote
 * on a topic whose articles all look alike no longer counts almost as much as
 * twenty.
 *
 * A bounded maximal-marginal-relevance pass then adds variety to the head of
 * the list. Its penalties scale an article's relevance by at most 35 %, so it
 * mainly reorders articles of comparable relevance; the final source-run
 * breaking can still move an article a few places. Neither pass touches
 * articles with net-negative evidence or a direct downvote, so variety never
 * lifts what the reader voted against.
 *
 * Read state is not a signal, and no dwell/scroll data is used. All weights
 * below are hand-set heuristics that have not been validated on real reading
 * data. The design draws on textbook IR techniques (BM25F term weighting,
 * Rocchio-style feedback, nearest-neighbour evidence, maximal marginal
 * relevance); it is not a port of any product's recommender.
 */
import type { Article, Subscription } from '../types';
import type { ArticleFeedback } from '../api/intelligence';
import { articleSource, diversifyBy, meaningfulShortTerms, stemTerm, synonymMap, validVote } from './intelligenceShared';
import { feedSiteUrl } from './feedSiteUrl';

/** Starred / read-later article the reader saved; may be read (not a candidate). */
export interface SavedArticleSignal {
  id: string;
  title: string;
  summary: string;
  content: string;
  sourceId: string;
  starred: boolean;
  readLater: boolean;
}

export interface IntelligenceContext {
  /** Current subscriptions. Articles from feeds not listed here get no subscription evidence. */
  subscriptions?: Subscription[];
  /** Snapshot of starred / read-later articles. Live flags on candidates take precedence. */
  savedArticles?: SavedArticleSignal[];
}

/** Every tunable used by Intelligence Next, in one place. Heuristic, not fitted. */
export const INTELLIGENCE_NEXT_PARAMETERS = Object.freeze({
  // Representation (fixed: the term cache depends on them)
  titleWeight: 2,
  titleTokens: 30,
  leadTokens: 100,
  maxRawChars: 20_000,
  bm25K1: 1.2,
  bm25B: 0.75,
  // Example evidence (votes, saved articles)
  maxExplicitExamples: 1000,
  maxSavedExamples: 400,
  /** Distinct examples that can support one candidate. */
  nearestExamples: 8,
  exampleAggregation: 'best-support' as ExampleAggregation,
  /** `best-support`: share of the best similarity one example gives (two give 1 − (1 − h)², …). */
  supportHalf: 0.5,
  /** `shrunk` (evaluation only): pseudo-count of the shrunk mean. */
  supportPseudoCount: 1,
  /** Skip examples that near-duplicate a stronger one already counted. */
  distinctExamples: true,
  starredStrength: 1,
  readLaterStrength: 0.6,
  // Subscription evidence
  nearestFeeds: 3,
  feedRecentArticles: 30,
  feedMetadataWeight: 1,
  /** Feeds of one site host are one publisher: they do not corroborate each other. */
  groupFeedsByHost: true,
  ownFeedPrior: 'volume' as OwnFeedPrior,
  /** `volume`: whose candidates share the budget, the feed's or the whole publisher's. */
  ownFeedBudget: 'feed' as OwnFeedBudget,
  /** `volume`: candidates per budget that each get the full prior; more share it. */
  ownFeedShare: 5,
  confidenceTerms: 5,
  // Score
  upvoteWeight: 1,
  downvoteWeight: 1.5,
  savedWeight: 0.35,
  subscriptionWeight: 0.2,
  ownFeedWeight: 0.1,
  freshnessHalfLifeHours: 72,
  freshnessShare: 0.3,
  freshnessTieBreak: 0.02,
  // Diversity
  diversityPool: 80,
  diversitySelections: 30,
  similarityPenalty: 0.25,
  sourcePenalty: 0.1,
  nearDuplicatePenalty: 2,
  nearDuplicateCosine: 0.85,
  nearDuplicateTitleJaccard: 0.6,
  nearDuplicateMinTitleTerms: 3,
  maxSourceRun: 2,
});
/**
 * How the similarities of the distinct nearest examples combine. The shipped
 * default is `best-support`; the others are kept so the committed synthetic
 * evaluation (`evaluation/interesting`) can reproduce the comparison:
 * `noisy-or` is the first version of this ranker (saturates: one close
 * example ≈ many), `squared` and `shrunk` are the support-aware alternatives
 * that were measured and not chosen.
 */
export type ExampleAggregation = 'noisy-or' | 'squared' | 'shrunk' | 'best-support';
/**
 * Own-feed prior: `volume` (default) shares a fixed budget among a feed's
 * candidates; `similarity` (evaluation only; not chosen: it rewards repetitive
 * feeds) is the similarity to the article's own feed profile; `none` is the
 * first version of this ranker.
 */
export type OwnFeedPrior = 'none' | 'volume' | 'similarity';
/**
 * Who shares a `volume` budget: each subscribed `feed` (default), or every
 * feed of one `publisher` (evaluation only; not chosen: on a platform host
 * such as a video site or code forge every channel would share one budget).
 */
export type OwnFeedBudget = 'feed' | 'publisher';
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T;
/** The parameters as values (the frozen object's literal types widened). */
type Settings = { readonly [K in keyof typeof INTELLIGENCE_NEXT_PARAMETERS]: Widen<(typeof INTELLIGENCE_NEXT_PARAMETERS)[K]> };
/** Overridable for evaluation and tests; the representation parameters are not. */
export type IntelligenceNextOverrides = Partial<Omit<Settings, 'titleWeight' | 'titleTokens' | 'leadTokens' | 'maxRawChars' | 'bm25K1' | 'bm25B'>>;
const P = INTELLIGENCE_NEXT_PARAMETERS;

/** FreshRSS stream id of the read-later label (mirrors `READ_LATER_LABEL` in feedStore). */
const READ_LATER_STREAM = 'user/-/label/read-later';
/** Read-later sub-categories (`savedCategories.ts`), current and legacy names. */
const READ_LATER_CATEGORY_PREFIXES = [`${READ_LATER_STREAM}/`, 'user/-/label/À lire plus tard/'];
/** Title FriRSS substitutes when an item has none; it carries no meaning. */
const UNTITLED = 'Sans titre';

export type IntelligenceNextTier = 'normal' | 'net-negative' | 'downvoted';

export interface EvidenceMatch {
  articleId: string;
  title: string;
  similarity: number;
}

/** Why an article sits where it does; every evidence value is in [0, 1]. */
export interface IntelligenceNextExplanation {
  article: Article;
  tier: IntelligenceNextTier;
  score: number;
  directVote: 1 | -1 | null;
  evidence: {
    upvote: number;
    downvote: number;
    saved: number;
    subscription: number;
    ownFeed: number;
    freshness: number;
    confidence: number;
  };
  strongestUpvote: EvidenceMatch | null;
  strongestDownvote: EvidenceMatch | null;
  strongestSaved: EvidenceMatch | null;
  strongestFeedId: string | null;
}

// ── Text representation ─────────────────────────────────────────────────

const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out',
  'has', 'have', 'his', 'how', 'its', 'may', 'new', 'now', 'see', 'two', 'way', 'who', 'did', 'get', 'got', 'him',
  'let', 'say', 'says', 'said', 'she', 'too', 'use', 'used', 'with', 'that', 'this', 'from', 'they', 'will', 'would',
  'there', 'their', 'what', 'about', 'which', 'when', 'your', 'more', 'been', 'than', 'them', 'then', 'into', 'also',
  'just', 'over', 'such', 'only', 'some', 'very', 'after', 'before', 'most', 'other', 'these', 'those', 'where',
  'while', 'could', 'should', 'being', 'because', 'does', 'each', 'here', 'like', 'make', 'many', 'much', 'must',
  'even', 'back', 'well', 'were', 'via', 'why',
  // French
  'les', 'des', 'une', 'est', 'que', 'qui', 'dans', 'pour', 'par', 'sur', 'pas', 'plus', 'avec', 'ses', 'aux',
  'mais', 'ont', 'été', 'cette', 'ces', 'elle', 'ils', 'nous', 'vous', 'leur', 'leurs', 'comme', 'tout', 'tous',
  'sont', 'fait', 'sans', 'entre', 'être', 'avoir', 'même', 'aussi', 'après', 'avant',
  // German
  'der', 'die', 'das', 'und', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen', 'ist', 'sind',
  'mit', 'von', 'für', 'auf', 'aus', 'bei', 'nach', 'sich', 'nicht', 'auch', 'als', 'wie', 'oder', 'aber', 'wird',
  'werden', 'wurde', 'haben', 'noch', 'nur', 'zum', 'zur', 'über', 'unter', 'durch', 'vor', 'bis', 'kann', 'mehr',
  'dass', 'sie', 'ihr', 'wir', 'ich',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  hellip: ' ', mdash: ' ', ndash: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß',
};

function decodeEntity(body: string): string {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? ' ';
}

/** HTML → plain text: no script/style bodies, no tags, entities decoded. */
function plainText(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  let text = raw.slice(0, P.maxRawChars)
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // A script/style block the length cap cut before its closing tag.
    .replace(/<(script|style|noscript)\b[\s\S]*$/i, ' ')
    .replace(/<[^>]*>/g, ' ');
  // A tag cut in half by the length cap would otherwise leak attribute text.
  if (raw.length > P.maxRawChars) text = text.replace(/<[^>]*$/, ' ');
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (_, body: string) => decodeEntity(body));
}

/**
 * Synonym roots keyed by stem, so every inflection of a listed word reaches its
 * group: "markets" and "market", "learning" and "learned", "emission(s)".
 * The shared `normalizeTerm` looks the stem up by the listed spelling and so
 * misses those; it is left unchanged here to keep the older models' rankings.
 */
const SYNONYM_BY_STEM = new Map<string, string>();
for (const [word, root] of synonymMap) SYNONYM_BY_STEM.set(stemTerm(word), root);

/**
 * Normalised term sequence: the shared tokeniser rules (letters/digits, length
 * ≥ 3 or a known short term), minus stopwords and bare numbers, then stemmed
 * and mapped to synonym groups. Adjacent words from the same synonym group
 * count once, so "machine learning" is one mention of `ai`, not two.
 * Short terms only count when written in capitals ("US", "AI"), so the pronoun
 * "us" is not read as the country. Lower-casing is locale-independent, so the
 * ranking does not depend on the device language.
 */
function termSequence(text: string, limit: number): string[] {
  const terms: string[] = [];
  let previousSynonym: string | null = null;
  for (const [original] of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = original.toLowerCase();
    if (word.length < 3 && !(meaningfulShortTerms.has(word) && original === original.toUpperCase())) continue;
    if (STOPWORDS.has(word) || /^\p{N}+$/u.test(word)) continue;
    const stem = stemTerm(word);
    const synonym = SYNONYM_BY_STEM.get(stem);
    if (synonym !== undefined && synonym === previousSynonym) continue;
    previousSynonym = synonym ?? null;
    terms.push(synonym ?? stem);
    if (terms.length >= limit) break;
  }
  return terms;
}

interface DocumentTerms {
  title: Map<string, number>;
  lead: Map<string, number>;
  leadLength: number;
}

function counts(terms: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const term of terms) result.set(term, (result.get(term) ?? 0) + 1);
  return result;
}

// Tokenising is the expensive part; cache per source object and revalidate the
// text fields, so a re-rank after a vote does not re-parse every article.
// Votes arrive as new objects after every vote (the list is re-fetched), so
// they are also cached by article id. That cache holds exactly the votes the
// last ranking used (≤ maxExplicitExamples) and is replaced by each ranking.
interface CachedTerms { title: unknown; summary: unknown; content: unknown; terms: DocumentTerms }
const termCache = new WeakMap<object, CachedTerms>();
let voteTermCache = new Map<string, CachedTerms>();
const sameText = (cached: CachedTerms | undefined, title: unknown, summary: unknown, content: unknown): cached is CachedTerms =>
  !!cached && cached.title === title && cached.summary === summary && cached.content === content;

/**
 * One representation for candidates, votes, saved articles and feed metadata:
 * the title plus a lead of the body. The lead is the start of `content`, or the
 * summary when there is no content. Summary is a prefix of content in FriRSS,
 * so using both would count the opening sentences twice.
 */
function documentTerms(source: object, title: unknown, summary: unknown, content: unknown): DocumentTerms {
  return cachedDocumentTerms(source, title, summary, content).terms;
}

/** `previous`: an entry for the same document under another object (a re-fetched vote). */
function cachedDocumentTerms(source: object, title: unknown, summary: unknown, content: unknown, previous?: CachedTerms): CachedTerms {
  const cached = termCache.get(source);
  if (sameText(cached, title, summary, content)) return cached;
  if (sameText(previous, title, summary, content)) {
    termCache.set(source, previous);
    return previous;
  }
  const titleText = typeof title === 'string' && title.trim() !== UNTITLED ? title : '';
  let lead = termSequence(plainText(content), P.leadTokens);
  if (!lead.length) lead = termSequence(plainText(summary), P.leadTokens);
  const terms: DocumentTerms = {
    title: counts(termSequence(plainText(titleText), P.titleTokens)),
    lead: counts(lead),
    leadLength: lead.length,
  };
  const entry = { title, summary, content, terms };
  termCache.set(source, entry);
  return entry;
}

interface Corpus {
  idf: (term: string) => number;
  averageLeadLength: number;
}

/**
 * Statistics come from the candidate articles only — the reader's history is
 * not part of the corpus being ranked. BM25's IDF gives a term found in almost
 * every candidate a weight close to zero, which is enough for feed boilerplate.
 * Common terms are deliberately not cut off: when one topic makes up most of
 * the unread list, its words must still carry a vote against that topic.
 */
function corpusStatistics(documents: DocumentTerms[]): Corpus {
  const df = new Map<string, number>();
  let leadTotal = 0;
  for (const doc of documents) {
    leadTotal += doc.leadLength;
    for (const term of new Set([...doc.title.keys(), ...doc.lead.keys()])) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = documents.length;
  return {
    idf: (term) => {
      const frequency = df.get(term) ?? 0;
      return Math.log(1 + (n - frequency + 0.5) / (frequency + 0.5));
    },
    averageLeadLength: leadTotal > 0 ? leadTotal / n : 1,
  };
}

/** Unit-length term vector; empty when nothing meaningful remains. */
type Vector = Map<string, number>;

/** BM25F-style weights: title counts double, the lead is length-normalised, tf saturates. */
function weightVector(doc: DocumentTerms, corpus: Corpus): Vector {
  const lengthNorm = 1 - P.bm25B + P.bm25B * (doc.leadLength / corpus.averageLeadLength);
  const weights: Vector = new Map();
  let squared = 0;
  for (const term of new Set([...doc.title.keys(), ...doc.lead.keys()])) {
    const idf = corpus.idf(term);
    if (idf <= 0) continue;
    const tf = P.titleWeight * (doc.title.get(term) ?? 0) + (doc.lead.get(term) ?? 0) / lengthNorm;
    const weight = ((tf * (P.bm25K1 + 1)) / (tf + P.bm25K1)) * idf;
    weights.set(term, weight);
    squared += weight * weight;
  }
  if (squared > 0) {
    const norm = Math.sqrt(squared);
    for (const [term, weight] of weights) weights.set(term, weight / norm);
  }
  return weights;
}

function dot(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, weight] of small) sum += weight * (large.get(term) ?? 0);
  return sum;
}

function jaccard(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  for (const term of a.keys()) if (b.has(term)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

/** Combine independent pieces of evidence in [0, 1]: monotone and never above 1. */
function noisyOr(values: number[]): number {
  let miss = 1;
  for (const value of values) miss *= 1 - Math.min(1, Math.max(0, value));
  return 1 - miss;
}

/**
 * Evidence in [0, 1] from the similarities (descending) of the distinct
 * examples that count. `best-support`: the best similarity s₁, scaled by how
 * well it is backed up, s₁ · (1 − (1 − h)^n) with n = Σ (sᵢ / s₁)² — one
 * example gives h·s₁, several about as close give nearly s₁, and weak extra
 * matches add little. It grows with every similarity and every added example.
 */
function aggregateSupport(similarities: number[], S: Settings): number {
  if (!similarities.length) return 0;
  switch (S.exampleAggregation) {
    case 'noisy-or':
      return noisyOr(similarities);
    case 'squared':
      return noisyOr(similarities.map((similarity) => similarity * similarity));
    case 'shrunk': {
      let sum = 0;
      let squares = 0;
      for (const similarity of similarities) { sum += similarity; squares += similarity * similarity; }
      return squares / (S.supportPseudoCount + sum);
    }
    case 'best-support': {
      const best = similarities[0];
      let support = 0;
      for (const similarity of similarities) support += (similarity / best) ** 2;
      return best * (1 - (1 - S.supportHalf) ** support);
    }
  }
}

// ── Example evidence (votes and saved articles) ─────────────────────────

type ExampleKind = 0 | 1 | 2; // upvote, downvote, saved
const UPVOTE: ExampleKind = 0;
const DOWNVOTE: ExampleKind = 1;
const SAVED: ExampleKind = 2;

interface Example {
  kind: ExampleKind;
  strength: number;
  articleId: string;
  title: string;
  titleTerms: Map<string, number>;
  /** The feed the example came from ('' when unknown). */
  sourceId: string;
  vector: Vector;
}

interface NearestEvidence {
  /** Similarities of the distinct examples that count, strongest first. */
  values: [number[], number[], number[]];
  best: [EvidenceMatch | null, EvidenceMatch | null, EvidenceMatch | null];
}

/**
 * Whether two examples are one story: nearly the same text, or (as when a
 * story is syndicated) nearly the same title in two different feeds. Within
 * one feed a shared title alone is a recurring series or a template ("Weekly
 * roundup …", "Daily deals: …"), whose issues the reader voted on one by one,
 * so there only the text decides.
 */
function sameStory(a: Example, b: Example, S: Settings): boolean {
  if (dot(a.vector, b.vector) >= S.nearDuplicateCosine) return true;
  if (a.sourceId && a.sourceId === b.sourceId) return false;
  return a.titleTerms.size >= S.nearDuplicateMinTitleTerms && b.titleTerms.size >= S.nearDuplicateMinTitleTerms
    && jaccard(a.titleTerms, b.titleTerms) >= S.nearDuplicateTitleJaccard;
}

/**
 * Inverted index over example vectors, so scoring touches only examples
 * sharing a term. For each kind it returns the strongest `nearestExamples`
 * *distinct* examples: an example that is a near duplicate of a stronger one
 * already counted (the same story syndicated or voted twice) is skipped, so
 * it does not count as independent support.
 */
function createExampleMatcher(examples: Example[], S: Settings) {
  const postings = new Map<string, Array<[number, number]>>();
  examples.forEach((example, index) => {
    for (const [term, weight] of example.vector) {
      let list = postings.get(term);
      if (!list) postings.set(term, list = []);
      list.push([index, weight]);
    }
  });
  const accumulator = new Float64Array(examples.length);
  const touched: number[] = [];
  // Spare places, so skipped duplicates do not leave the list short.
  const shortlist = S.distinctExamples ? 2 * S.nearestExamples : S.nearestExamples;
  const duplicates = new Map<number, boolean>();
  const isDuplicate = (a: number, b: number) => {
    const key = a < b ? a * examples.length + b : b * examples.length + a;
    let result = duplicates.get(key);
    if (result === undefined) {
      result = sameStory(examples[a], examples[b], S);
      duplicates.set(key, result);
    }
    return result;
  };

  return (vector: Vector): NearestEvidence => {
    for (const [term, weight] of vector) {
      const list = postings.get(term);
      if (!list) continue;
      for (const [index, exampleWeight] of list) {
        if (accumulator[index] === 0) touched.push(index);
        accumulator[index] += weight * exampleWeight;
      }
    }
    const top: [number[], number[], number[]] = [[], [], []];
    const topIndexes: [number[], number[], number[]] = [[], [], []];
    for (const index of touched) {
      const example = examples[index];
      const similarity = Math.min(1, accumulator[index]) * example.strength;
      accumulator[index] = 0;
      if (similarity <= 0) continue;
      const values = top[example.kind];
      const indexes = topIndexes[example.kind];
      // Keep the strongest few, ties resolved by example order (most recent first).
      let position = values.length;
      while (position > 0 && (values[position - 1] < similarity || (values[position - 1] === similarity && indexes[position - 1] > index))) position--;
      if (position < shortlist) {
        values.splice(position, 0, similarity);
        indexes.splice(position, 0, index);
        if (values.length > shortlist) { values.pop(); indexes.pop(); }
      }
    }
    touched.length = 0;
    const result: NearestEvidence = { values: [[], [], []], best: [null, null, null] };
    for (const kind of [UPVOTE, DOWNVOTE, SAVED]) {
      const counted: number[] = [];
      topIndexes[kind].forEach((index, position) => {
        if (counted.length >= S.nearestExamples) return;
        if (S.distinctExamples && counted.some((other) => isDuplicate(index, other))) return;
        counted.push(index);
        result.values[kind].push(top[kind][position]);
      });
      if (counted.length) {
        const example = examples[counted[0]];
        result.best[kind] = { articleId: example.articleId, title: example.title, similarity: result.values[kind][0] };
      }
    }
    return result;
  };
}

// ── Subscription evidence ───────────────────────────────────────────────

interface FeedProfile {
  id: string;
  publisher: string;
  /** Unit-length sum of the feed's recent article vectors and its metadata vector. */
  unit: Map<string, number>;
  /** Length of that sum before normalising, for the leave-one-out similarity. */
  rawNorm: number;
  /** Candidates that are part of the profile. */
  members: Set<number>;
}

/**
 * Who publishes a feed, so that several feeds of one site count as one source
 * of corroboration: the host of its site URL (`feedSiteUrl`: the feed's site
 * link, else the origin of its feed URL) without a leading "www.", or the feed
 * itself when it has no usable URL.
 */
export function feedPublisher(subscription: Pick<Subscription, 'id' | 'url' | 'htmlUrl'>): string {
  const site = feedSiteUrl(subscription);
  if (site) {
    try {
      const host = new URL(site).hostname.toLowerCase().replace(/^www\./, '');
      if (host) return `host:${host}`;
    } catch { /* not a URL */ }
  }
  return `feed:${subscription.id}`;
}

interface SubscriptionEvidence {
  /** Corroboration by other publishers' feeds, in [0, 1]. */
  values: number[];
  /** Bounded prior from the article's own subscribed feed, in [0, 1]. */
  own: number[];
  strongestFeed: Array<string | null>;
}

/**
 * Subscription interest for each candidate.
 *
 * Every subscribed feed acts as a weak, feed-level positive example: a profile
 * built from its most recent candidate articles plus its title and folder
 * labels (the sole profile while the feed has no articles, so a new
 * subscription counts immediately). A candidate's corroboration is the
 * noisy-OR of its similarity to the closest feeds of *other publishers* — each
 * publisher counted once, by its best feed. Its own feed, and other feeds of
 * the same site, are left out: every candidate comes from a subscribed feed,
 * and resembling one's own feed measures how repetitive the feed is (a deals
 * or job-board feed would vouch for itself), not how interested the reader is.
 *
 * One unit profile per feed, however prolific, and only the closest
 * `nearestFeeds` publishers count, so a niche topic is not drowned out by a
 * long subscription list. Articles from feeds the reader does not follow get
 * nothing.
 *
 * The own-feed prior (`volume`) is separate and does not depend on what the
 * article says (like every positive signal it is scaled by the article's
 * confidence): each subscribed feed has a budget of `ownFeedShare` articles'
 * worth, shared among its candidates (each gets min(1, ownFeedShare /
 * candidates)). A just-added niche feed therefore contributes from its first
 * article, while a prolific feed's volume buys it nothing. The budget is per
 * feed, not per publisher, so a channel on a platform host keeps its own; a
 * publisher that splits into several feeds gets one per feed, each still
 * bounded by `ownFeedWeight` in the score.
 *
 * Grouping by host is approximate: unrelated publishers on one shared host
 * whose site URL differs only by path (code forges, video platforms, blog
 * platforms) count as one for corroboration and so lose corroboration from
 * each other — the conservative direction; feeds without a usable URL count
 * on their own.
 */
function subscriptionEvidence(
  articles: Article[],
  vectors: Vector[],
  subscriptions: Subscription[] | undefined,
  corpus: Corpus,
  publishedTimes: number[],
  S: Settings,
): SubscriptionEvidence {
  const values = new Array<number>(articles.length).fill(0);
  const own = new Array<number>(articles.length).fill(0);
  const strongestFeed = new Array<string | null>(articles.length).fill(null);
  if (!subscriptions?.length || !articles.length) return { values, own, strongestFeed };

  const publisherById = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (!subscription?.id || publisherById.has(subscription.id)) continue;
    publisherById.set(subscription.id, S.groupFeedsByHost ? feedPublisher(subscription) : `feed:${subscription.id}`);
  }
  const byFeed = new Map<string, number[]>();
  for (const id of publisherById.keys()) byFeed.set(id, []);
  // Candidates per budget holder (a feed, or a publisher), for the prior.
  const budgetOf = (sourceId: string, publisher: string) => (S.ownFeedBudget === 'publisher' ? publisher : `feed:${sourceId}`);
  const budgetCount = new Map<string, number>();
  articles.forEach((article, index) => {
    const publisher = publisherById.get(article.sourceId);
    if (publisher === undefined) return;
    const budget = budgetOf(article.sourceId, publisher);
    budgetCount.set(budget, (budgetCount.get(budget) ?? 0) + 1);
    if (vectors[index].size) byFeed.get(article.sourceId)!.push(index);
  });

  const feeds: FeedProfile[] = [];
  const feedIndexById = new Map<string, number>();
  for (const subscription of subscriptions) {
    if (!subscription?.id || feedIndexById.has(subscription.id)) continue;
    const recent = (byFeed.get(subscription.id) ?? [])
      .sort((a, b) => publishedTimes[b] - publishedTimes[a] || a - b)
      .slice(0, S.feedRecentArticles);
    const raw = new Map<string, number>();
    const add = (vector: Vector, weight: number) => {
      for (const [term, value] of vector) raw.set(term, (raw.get(term) ?? 0) + value * weight);
    };
    for (const index of recent) add(vectors[index], 1);
    const categories = (subscription.categories ?? []).map((category) => category?.label ?? '').join(' ');
    add(weightVector(documentTerms(subscription, subscription.title, categories, ''), corpus), S.feedMetadataWeight);
    let squared = 0;
    for (const value of raw.values()) squared += value * value;
    if (squared <= 0) continue;
    const norm = Math.sqrt(squared);
    const unit = new Map<string, number>();
    for (const [term, value] of raw) unit.set(term, value / norm);
    feedIndexById.set(subscription.id, feeds.length);
    feeds.push({ id: subscription.id, publisher: publisherById.get(subscription.id)!, unit, rawNorm: norm, members: new Set(recent) });
  }

  const postings = new Map<string, Array<[number, number]>>();
  feeds.forEach((feed, index) => {
    for (const [term, value] of feed.unit) {
      let list = postings.get(term);
      if (!list) postings.set(term, list = []);
      list.push([index, value]);
    }
  });
  const perFeed = new Float64Array(feeds.length);
  const touched: number[] = [];

  articles.forEach((article, index) => {
    const ownPublisher = publisherById.get(article.sourceId);
    if (ownPublisher === undefined) return;
    if (S.ownFeedPrior === 'volume') own[index] = Math.min(1, S.ownFeedShare / budgetCount.get(budgetOf(article.sourceId, ownPublisher))!);
    const vector = vectors[index];
    if (!vector.size) return;
    const ownIndex = feedIndexById.get(article.sourceId);
    for (const [term, weight] of vector) {
      for (const [feedIndex, value] of postings.get(term) ?? []) {
        if (perFeed[feedIndex] === 0) touched.push(feedIndex);
        perFeed[feedIndex] += weight * value;
      }
    }
    if (S.ownFeedPrior === 'similarity' && ownIndex !== undefined) {
      // Similarity to the own feed without this article in it.
      const feed = feeds[ownIndex];
      const rawDot = perFeed[ownIndex] * feed.rawNorm;
      const leaveOneOut = feed.members.has(index)
        ? (rawDot - 1) / Math.sqrt(Math.max(1e-12, feed.rawNorm ** 2 - 2 * rawDot + 1))
        : perFeed[ownIndex];
      own[index] = Math.min(1, Math.max(0, leaveOneOut));
    }
    // The best feed of each other publisher.
    const bestOfPublisher = new Map<string, number>();
    for (const feedIndex of touched) {
      const feed = feeds[feedIndex];
      if (feed.publisher === ownPublisher || !(perFeed[feedIndex] > 1e-9)) continue;
      const current = bestOfPublisher.get(feed.publisher);
      if (current === undefined || perFeed[feedIndex] > perFeed[current] || (perFeed[feedIndex] === perFeed[current] && feedIndex < current)) {
        bestOfPublisher.set(feed.publisher, feedIndex);
      }
    }
    const top = [...bestOfPublisher.values()]
      .sort((a, b) => perFeed[b] - perFeed[a] || a - b)
      .slice(0, S.nearestFeeds);
    values[index] = noisyOr(top.map((feedIndex) => perFeed[feedIndex]));
    if (top.length) strongestFeed[index] = feeds[top[0]].id;
    for (const feedIndex of touched) perFeed[feedIndex] = 0;
    touched.length = 0;
  });
  return { values, own, strongestFeed };
}

// ── Scoring and ordering ────────────────────────────────────────────────

function freshnessOf(published: number, now: number, S: Settings): number {
  if (!Number.isFinite(published) || !Number.isFinite(now)) return 0;
  const ageHours = Math.max(0, (now - published) / 3_600_000);
  return 1 / (1 + ageHours / S.freshnessHalfLifeHours);
}

const hasDate = (article: Article) =>
  !article.publishedMissing && typeof article.published === 'number' && Number.isFinite(article.published);

/**
 * Publication time to rank by. An article without a date (`publishedMissing`:
 * FriRSS then shows the time it was loaded) is treated as neither new nor old:
 * it gets the median time of the dated candidates, so it gains no freshness
 * bonus and suffers no penalty. NaN when no candidate has a date — freshness is
 * then 0 for every article, which changes no order.
 */
function publicationTimes(articles: Article[]): number[] {
  const dated = articles.filter(hasDate).map((article) => article.published).sort((a, b) => a - b);
  const middle = dated.length >> 1;
  const median = !dated.length ? NaN : dated.length % 2 ? dated[middle] : (dated[middle - 1] + dated[middle]) / 2;
  return articles.map((article) => (hasDate(article) ? article.published : median));
}

function hasReadLater(article: Article): boolean {
  return Array.isArray(article.labels) && article.labels.some((label) => typeof label === 'string'
    && (label === READ_LATER_STREAM || READ_LATER_CATEGORY_PREFIXES.some((prefix) => label.startsWith(prefix))));
}

function savedStrength(starred: boolean, readLater: boolean, S: Settings): number {
  return Math.max(starred ? S.starredStrength : 0, readLater ? S.readLaterStrength : 0);
}

/**
 * Score and order articles, returning the explanation for each in ranked
 * order. `rankIntelligenceNext` is the same ordering without the details.
 */
export function explainIntelligenceNext(
  articles: Article[],
  feedback: ArticleFeedback[],
  now = Date.now(),
  context: IntelligenceContext = {},
  overrides?: IntelligenceNextOverrides,
): IntelligenceNextExplanation[] {
  if (!articles.length) return [];
  const S: Settings = overrides ? { ...P, ...overrides } : P;

  const documents = articles.map((article) => documentTerms(article, article.title, article.summary, article.content));
  const corpus = corpusStatistics(documents);
  const vectors = documents.map((doc) => weightVector(doc, corpus));

  // Explicit votes: one per article (the API returns the newest first), capped.
  const directVotes = new Map<string, 1 | -1>();
  const examples: Example[] = [];
  let explicitCount = 0;
  const usedVoteTerms = new Map<string, CachedTerms>();
  for (const row of Array.isArray(feedback) ? feedback : []) {
    if (!row || !validVote(row.vote)) continue;
    const articleId = typeof row.articleId === 'string' ? row.articleId : '';
    if (articleId) {
      if (directVotes.has(articleId)) continue;
      directVotes.set(articleId, row.vote);
    }
    if (explicitCount >= S.maxExplicitExamples) continue;
    const terms = cachedDocumentTerms(row, row.title, row.summary, row.content, articleId ? voteTermCache.get(articleId) : undefined);
    if (articleId) usedVoteTerms.set(articleId, terms);
    const vector = weightVector(terms.terms, corpus);
    if (!vector.size) continue;
    explicitCount++;
    examples.push({
      kind: row.vote === 1 ? UPVOTE : DOWNVOTE, strength: 1, articleId, title: String(row.title ?? ''), titleTerms: terms.terms.title,
      sourceId: typeof row.sourceId === 'string' ? row.sourceId : '', vector,
    });
  }
  voteTermCache = usedVoteTerms;

  // Saved articles: live candidate flags win over the snapshot; an explicit
  // vote on the same article replaces the weaker implicit signal.
  const candidateIds = new Set(articles.map((article) => article.id).filter(Boolean));
  const savedSeen = new Set<string>();
  let savedCount = 0;
  const addSaved = (source: object, id: string, sourceId: unknown, title: unknown, summary: unknown, content: unknown, strength: number, index?: number) => {
    if (strength <= 0 || savedCount >= S.maxSavedExamples) return false;
    if (id && (directVotes.has(id) || savedSeen.has(id))) return false;
    const terms = index === undefined ? documentTerms(source, title, summary, content) : documents[index];
    const exampleVector = index === undefined ? weightVector(terms, corpus) : vectors[index];
    if (!exampleVector.size) return false;
    if (id) savedSeen.add(id);
    savedCount++;
    examples.push({
      kind: SAVED, strength, articleId: id, title: String(title ?? ''), titleTerms: terms.title,
      sourceId: typeof sourceId === 'string' ? sourceId : '', vector: exampleVector,
    });
    return true;
  };
  // A candidate the reader saved is direct evidence at its full strength, as a
  // direct upvote is; it also counts as an example for the others.
  const directSaved = new Float64Array(articles.length);
  articles.forEach((article, index) => {
    const strength = savedStrength(!!article.starred, hasReadLater(article), S);
    if (addSaved(article, article.id, article.sourceId, article.title, article.summary, article.content, strength, index)) directSaved[index] = strength;
  });
  for (const item of context.savedArticles ?? []) {
    if (!item || (item.id && candidateIds.has(item.id))) continue;
    addSaved(item, item.id, item.sourceId, item.title, item.summary, item.content, savedStrength(!!item.starred, !!item.readLater, S));
  }

  const publishedTimes = publicationTimes(articles);
  const nearest = createExampleMatcher(examples, S);
  const subscriptions = subscriptionEvidence(articles, vectors, context.subscriptions, corpus, publishedTimes, S);

  const scored = articles.map((article, index) => {
    const evidence = nearest(vectors[index]);
    const directVote = (article.id && directVotes.get(article.id)) || null;
    const upvote = directVote === 1 ? 1 : aggregateSupport(evidence.values[UPVOTE], S);
    const downvote = aggregateSupport(evidence.values[DOWNVOTE], S);
    const saved = Math.max(directSaved[index], aggregateSupport(evidence.values[SAVED], S));
    const subscription = subscriptions.values[index];
    const ownFeed = subscriptions.own[index];
    const freshness = freshnessOf(publishedTimes[index], now, S);
    // Very short texts match by accident; their positive evidence counts less.
    const confidence = directVote === 1 ? 1 : Math.min(1, vectors[index].size / S.confidenceTerms);
    const positive = confidence * (S.upvoteWeight * upvote + S.savedWeight * saved
      + S.subscriptionWeight * subscription + S.ownFeedWeight * ownFeed);
    // A vote on the article itself is decisive: an upvoted article is not
    // pushed down for resembling something else the reader disliked, and a
    // downvoted one goes to the bottom tier whatever else it matches.
    const negative = directVote === 1 ? 0 : S.downvoteWeight * downvote;
    const score = positive * (1 - S.freshnessShare + S.freshnessShare * freshness)
      - negative
      + S.freshnessTieBreak * freshness;
    const tier: IntelligenceNextTier = directVote === -1 ? 'downvoted' : score < 0 ? 'net-negative' : 'normal';
    const explanation: IntelligenceNextExplanation = {
      article,
      tier,
      score: Number.isFinite(score) ? score : 0,
      directVote,
      evidence: { upvote, downvote, saved, subscription, ownFeed, freshness, confidence },
      strongestUpvote: evidence.best[UPVOTE],
      strongestDownvote: evidence.best[DOWNVOTE],
      strongestSaved: evidence.best[SAVED],
      strongestFeedId: subscriptions.strongestFeed[index],
    };
    return { index, explanation };
  });

  type Scored = (typeof scored)[number];
  const byScore = (a: Scored, b: Scored) =>
    b.explanation.score - a.explanation.score
    || (publishedTimes[b.index] || 0) - (publishedTimes[a.index] || 0)
    || a.index - b.index;
  const tier = (name: IntelligenceNextTier) => scored.filter((item) => item.explanation.tier === name).sort(byScore);
  const normal = tier('normal');

  // Maximal-marginal-relevance pass over the head of the list only: it trades
  // a little relevance for variety (vocabulary, publisher) and pushes near
  // duplicates out of the head. Only non-negative items take part, so
  // diversity can never lift an article the reader voted against.
  const pool = normal.slice(0, S.diversityPool).map((item) => ({ item, maxSimilarity: 0, nearDuplicate: false }));
  const topScore = pool.length ? pool[0].item.explanation.score : 0;
  // A source already in the head costs a fixed, bounded amount — not one step
  // per article shown — so readers whose interests sit in a few feeds still
  // see those feeds' best articles first; `diversifyBy` then breaks up runs.
  const shownSources = new Set<string>();
  const head: Scored[] = [];
  const selections = Math.min(S.diversitySelections, pool.length);
  for (let pick = 0; pick < selections; pick++) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    pool.forEach((entry, index) => {
      const relevance = topScore > 0 ? entry.item.explanation.score / topScore : 0;
      // Penalties scale the article's own relevance (at most by
      // `similarityPenalty + sourcePenalty`), so this pass only reorders
      // articles of comparable relevance; it never lifts a weak match over a
      // much stronger one (`diversifyBy` below may still move one a few places
      // to break a source run). Near duplicates leave the head outright.
      const variety = 1
        - S.similarityPenalty * entry.maxSimilarity
        - (shownSources.has(articleSource(entry.item.explanation.article)) ? S.sourcePenalty : 0);
      const value = relevance * variety - (entry.nearDuplicate ? S.nearDuplicatePenalty : 0);
      if (value > bestValue) { bestValue = value; bestIndex = index; }
    });
    const [{ item: chosen }] = pool.splice(bestIndex, 1);
    head.push(chosen);
    shownSources.add(articleSource(chosen.explanation.article));
    const chosenTitle = documents[chosen.index].title;
    for (const entry of pool) {
      const similarity = dot(vectors[entry.item.index], vectors[chosen.index]);
      entry.maxSimilarity = Math.max(entry.maxSimilarity, similarity);
      const title = documents[entry.item.index].title;
      const sameTitle = title.size >= S.nearDuplicateMinTitleTerms && chosenTitle.size >= S.nearDuplicateMinTitleTerms
        && jaccard(title, chosenTitle) >= S.nearDuplicateTitleJaccard;
      if (similarity >= S.nearDuplicateCosine || sameTitle) entry.nearDuplicate = true;
    }
  }
  const normalOrder = diversifyBy(
    [...head, ...pool.map((entry) => entry.item), ...normal.slice(S.diversityPool)],
    (item) => articleSource(item.explanation.article),
    S.maxSourceRun,
  );

  return [...normalOrder, ...tier('net-negative'), ...tier('downvoted')].map((item) => item.explanation);
}

/** Intelligence Next ordering of the given articles (a permutation of the input). */
export function rankIntelligenceNext(
  articles: Article[],
  feedback: ArticleFeedback[],
  now = Date.now(),
  context: IntelligenceContext = {},
  overrides?: IntelligenceNextOverrides,
): Article[] {
  return explainIntelligenceNext(articles, feedback, now, context, overrides).map((item) => item.article);
}
