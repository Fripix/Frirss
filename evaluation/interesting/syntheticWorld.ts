/**
 * Seeded synthetic reader, feeds and unread snapshot for `evaluate.ts`.
 *
 * SYNTHETIC ONLY: every feed, article, vote and saved item is generated here
 * from fixed seeds. Hosts use the reserved `.example` top-level domain.
 */
import type { IntelligenceContext } from '../../src/lib/intelligenceRanking';
import type { Article, Subscription } from '../../src/types';
import type { ArticleFeedback } from '../../src/api/intelligence';

// ── Deterministic generator ──────────────────────────────────────────
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOPICS: Record<string, string[]> = {
  rust: ['compiler', 'borrow', 'checker', 'cargo', 'crate', 'rustc', 'memory', 'safety', 'async', 'tokio', 'trait', 'generics', 'toolchain', 'lifetime', 'macro'],
  ai: ['model', 'neural', 'training', 'dataset', 'transformer', 'inference', 'gradient', 'benchmark', 'learning', 'language', 'agent', 'reasoning', 'weights', 'finetuning', 'alignment'],
  astronomy: ['telescope', 'galaxy', 'nebula', 'exoplanet', 'orbit', 'supernova', 'comet', 'observatory', 'cosmic', 'spectrum', 'asteroid', 'lunar', 'eclipse', 'pulsar', 'quasar'],
  gardening: ['tomato', 'soil', 'compost', 'seedling', 'pruning', 'harvest', 'mulch', 'perennial', 'greenhouse', 'watering', 'fertilizer', 'bloom', 'balcony', 'herbs', 'bulbs'],
  markets: ['stock', 'bond', 'yield', 'inflation', 'earnings', 'investor', 'dividend', 'equity', 'trader', 'recession', 'currency', 'index', 'portfolio', 'futures', 'treasury'],
  celebrity: ['celebrity', 'actor', 'rumour', 'carpet', 'gossip', 'singer', 'breakup', 'wedding', 'scandal', 'paparazzi', 'award', 'fashion', 'influencer', 'tabloid', 'glamour'],
  deals: ['deal', 'discount', 'price', 'sale', 'coupon', 'offer', 'bargain', 'cheap', 'voucher', 'clearance', 'shop', 'gadget', 'bundle', 'promo', 'cashback'],
  cycling: ['bike', 'cycling', 'frame', 'gravel', 'tyre', 'derailleur', 'cassette', 'saddle', 'peloton', 'climb', 'ride', 'route', 'carbon', 'wheelset', 'helmet'],
  cooking: ['recipe', 'sourdough', 'bake', 'oven', 'dough', 'sauce', 'roast', 'spice', 'flour', 'butter', 'braise', 'knife', 'kitchen', 'pastry', 'ferment'],
  politics: ['election', 'parliament', 'minister', 'policy', 'campaign', 'coalition', 'senate', 'bill', 'reform', 'debate', 'poll', 'budget', 'party', 'governor', 'cabinet'],
  security: ['vulnerability', 'exploit', 'patch', 'malware', 'ransomware', 'breach', 'phishing', 'encryption', 'firewall', 'password', 'attack', 'botnet', 'audit', 'backdoor', 'spyware'],
  football: ['goal', 'striker', 'league', 'transfer', 'coach', 'match', 'penalty', 'stadium', 'midfielder', 'keeper', 'derby', 'season', 'fixture', 'injury', 'cup'],
  woodworking: ['chisel', 'dovetail', 'plane', 'lathe', 'joinery', 'oak', 'walnut', 'sanding', 'workbench', 'mortise', 'veneer', 'varnish', 'router', 'clamp', 'sawdust'],
};
const FILLER = ['today', 'new', 'report', 'week', 'update', 'says', 'first', 'big', 'look', 'inside', 'why', 'how', 'latest', 'more', 'after', 'guide', 'review', 'explained'];

export const LIKED = new Set(['rust', 'ai', 'astronomy']);
export const DISLIKED = new Set(['celebrity', 'deals']);

/** Feeds the simulated reader subscribes to. `deals` is deliberately prolific; `woodworking` was just added (no votes). */
export const FEEDS: Array<{ id: string; title: string; topics: string[]; weight: number; folder: string }> = [
  { id: 'feed/rust-blog', title: 'Rust blog', topics: ['rust'], weight: 2, folder: 'Dev' },
  { id: 'feed/this-week-rust', title: 'This week in compilers', topics: ['rust', 'security'], weight: 2, folder: 'Dev' },
  { id: 'feed/ml-papers', title: 'ML papers digest', topics: ['ai'], weight: 3, folder: 'AI' },
  { id: 'feed/ai-news', title: 'AI news', topics: ['ai', 'markets'], weight: 3, folder: 'AI' },
  { id: 'feed/research-lab', title: 'Research lab', topics: ['ai'], weight: 2, folder: 'AI' },
  { id: 'feed/sky', title: 'Sky tonight', topics: ['astronomy'], weight: 2, folder: 'Science' },
  { id: 'feed/garden', title: 'Balcony garden', topics: ['gardening'], weight: 2, folder: 'Home' },
  { id: 'feed/ft', title: 'Markets daily', topics: ['markets'], weight: 3, folder: 'News' },
  { id: 'feed/wsj', title: 'Money wire', topics: ['markets', 'politics'], weight: 3, folder: 'News' },
  { id: 'feed/stars', title: 'Celebrity wire', topics: ['celebrity'], weight: 3, folder: 'Misc' },
  { id: 'feed/deals', title: 'Hot deals', topics: ['deals'], weight: 20, folder: 'Misc' },
  { id: 'feed/cycle', title: 'Gravel weekly', topics: ['cycling'], weight: 2, folder: 'Sport' },
  { id: 'feed/velo', title: 'Velo news', topics: ['cycling'], weight: 2, folder: 'Sport' },
  { id: 'feed/kitchen', title: 'Home kitchen', topics: ['cooking'], weight: 2, folder: 'Home' },
  { id: 'feed/bake', title: 'Bread club', topics: ['cooking'], weight: 1, folder: 'Home' },
  { id: 'feed/politics', title: 'Politics desk', topics: ['politics'], weight: 4, folder: 'News' },
  { id: 'feed/general', title: 'General news', topics: ['politics', 'markets', 'football'], weight: 4, folder: 'News' },
  { id: 'feed/sec', title: 'Security week', topics: ['security'], weight: 2, folder: 'Dev' },
  { id: 'feed/football', title: 'Football live', topics: ['football'], weight: 3, folder: 'Sport' },
  { id: 'feed/wood', title: 'Woodworking shop', topics: ['woodworking'], weight: 1, folder: 'Hobbies' },
];
export const NEW_FEED = 'feed/wood';
const subscriptionOf = (id: string, title: string, folder: string, host: string): Subscription => ({
  id, title, url: `https://${host}/feed.xml`, htmlUrl: `https://${host}/`, categories: [{ id: `user/-/label/${folder}`, label: folder }],
});
/** Every feed on its own host. */
export const subscriptions: Subscription[] = FEEDS.map((f) => subscriptionOf(f.id, f.title, f.folder, `${f.id.slice(5)}.example`));

/**
 * Scenario E: the deals publisher runs three feeds on one host. Its articles
 * are spread round-robin over them; texts are unchanged.
 */
export const DEALS_FEEDS = ['feed/deals', 'feed/deals-tech', 'feed/deals-home'];
export function splitDealsPublisher(items: Labeled[]): { items: Labeled[]; subscriptions: Subscription[] } {
  let next = 0;
  const split = items.map((a) => (a.sourceId === 'feed/deals' ? { ...a, sourceId: DEALS_FEEDS[next++ % DEALS_FEEDS.length] } : a));
  const extra = DEALS_FEEDS.map((id, i) => subscriptionOf(id, ['Hot deals', 'Hot deals: tech', 'Hot deals: home'][i], 'Misc', 'hotdeals.example'));
  return { items: split, subscriptions: [...subscriptions.filter((s) => s.id !== 'feed/deals'), ...extra] };
}

/**
 * Scenario F: two different publishers on one shared hosting domain (as with
 * blogs on a platform's paths) — here the two rust feeds. Host grouping then
 * wrongly treats them as one publisher.
 */
export function sharedHost(): Subscription[] {
  return subscriptions.map((s) => (s.id === 'feed/rust-blog' || s.id === 'feed/this-week-rust'
    ? { ...s, url: `https://blogs.example/${s.id.slice(5)}/feed.xml`, htmlUrl: `https://blogs.example/${s.id.slice(5)}/` }
    : s));
}

/**
 * Scenario H: the just-added niche feed is one channel among several on a
 * platform host (as on a video site or code forge): it and seven other
 * channels' site URLs differ only by path.
 */
export const PLATFORM_FEEDS = [NEW_FEED, 'feed/cycle', 'feed/velo', 'feed/kitchen', 'feed/bake', 'feed/garden', 'feed/football', 'feed/sec'];
export function sharedPlatform(): Subscription[] {
  return subscriptions.map((s) => (PLATFORM_FEEDS.includes(s.id)
    ? { ...s, url: `https://video.example/feeds/${s.id.slice(5)}.xml`, htmlUrl: `https://video.example/channel/${s.id.slice(5)}` }
    : s));
}

/**
 * Scenario G: a share of the candidates had no publication date. FriRSS then
 * shows the time they were loaded (`published` = now) and flags them.
 */
export function withUndated(items: Labeled[], share: number, seed: number, now: number): Labeled[] {
  const rand = mulberry32(seed);
  return items.map((a) => (rand() < share ? { ...a, published: now, publishedMissing: true } : a));
}

export type Labeled = Article & { topic: string; story: string };

/**
 * Two text models, to check that conclusions do not hinge on one generator:
 * - `homogeneous`: 15 words per topic, 75 % topic words — same-topic articles
 *   look almost alike (cosine ≈ 0.7), a harsh case for similarity penalties.
 * - `realistic`: Zipf-distributed vocabularies (80 words per topic, 800
 *   general words); topic words are 50 % of a title, 30 % of a body — closer
 *   to news text, where same-topic articles share only some terms.
 */
export type World = 'homogeneous' | 'realistic';
let WORLD: World = 'homogeneous';
export function setWorld(world: World) { WORLD = world; }

const SYLLABLES = ['ka', 'lo', 'mi', 'ren', 'tus', 'vor', 'zen', 'pa', 'qui', 'dor', 'lin', 'sar', 'bel', 'cor', 'fen', 'gal', 'hix', 'jor', 'mur', 'nev', 'pol', 'rak', 'sil', 'tov', 'umb', 'wex', 'yar', 'zum'];
const taken = new Set<string>(Object.values(TOPICS).flat());
function pseudoWords(count: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const out: string[] = [];
  while (out.length < count) {
    const parts = 2 + Math.floor(rand() * 2);
    let word = '';
    for (let i = 0; i < parts; i += 1) word += SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
    if (word.length >= 5 && !taken.has(word)) { taken.add(word); out.push(word); }
  }
  return out;
}
const GENERAL = pseudoWords(800, 99);
const RICH_TOPICS: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOPICS).map(([topic, words], i) => [topic, [...words, ...pseudoWords(65, 1000 + i)]]),
);
function zipf(size: number) {
  const cumulative: number[] = [];
  let total = 0;
  for (let rank = 1; rank <= size; rank += 1) cumulative.push(total += 1 / rank ** 1.05);
  return (rand: () => number) => {
    const target = rand() * total;
    let lo = 0; let hi = size - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < target) lo = mid + 1; else hi = mid; }
    return lo;
  };
}
const pickGeneral = zipf(GENERAL.length);
const pickTopic = zipf(80);

function text(rand: () => number, topic: string, words: number, title = false) {
  const out: string[] = [];
  if (WORLD === 'homogeneous') {
    const vocab = TOPICS[topic];
    for (let i = 0; i < words; i += 1) out.push(rand() < 0.75 ? vocab[Math.floor(rand() * vocab.length)] : FILLER[Math.floor(rand() * FILLER.length)]);
  } else {
    const share = title ? 0.5 : 0.3;
    for (let i = 0; i < words; i += 1) out.push(rand() < share ? RICH_TOPICS[topic][pickTopic(rand)] : GENERAL[pickGeneral(rand)]);
  }
  return out.join(' ');
}
const lengths = () => (WORLD === 'homogeneous' ? { title: 5, body: 40, voteBody: 25 } : { title: 8, body: 120, voteBody: 60 });

export function snapshot(n: number, seed: number, now: number): Labeled[] {
  const rand = mulberry32(seed);
  const totalWeight = FEEDS.reduce((sum, f) => sum + f.weight, 0);
  const pickFeed = () => {
    let r = rand() * totalWeight;
    for (const f of FEEDS) { r -= f.weight; if (r <= 0) return f; }
    return FEEDS[FEEDS.length - 1];
  };
  const items: Labeled[] = [];
  let id = 0;
  while (items.length < n) {
    const feed = items.length < 4 ? FEEDS.find((f) => f.id === NEW_FEED)! : pickFeed(); // the new feed's first 4 articles
    const topic = feed.topics[Math.floor(rand() * feed.topics.length)];
    const title = text(rand, topic, lengths().title, true).replace(/^./, (c) => c.toUpperCase());
    const body = text(rand, topic, lengths().body);
    const published = now - Math.floor(rand() * 7 * 24 * 3_600_000);
    const story = `s${id}`;
    items.push({
      id: `a${id++}`, title, summary: body.slice(0, 200), content: `<p>${body}</p>`, author: '', url: `https://example.test/${id}`,
      source: feed.title, sourceId: feed.id, published, read: false, starred: false, labels: [], tags: [], topic, story,
    });
    // ~8% of stories are syndicated: the same story, lightly reworded, in a second feed of the same topic.
    const sibling = FEEDS.find((f) => f.id !== feed.id && f.topics.includes(topic));
    if (sibling && rand() < 0.08 && items.length < n) {
      items.push({
        ...items[items.length - 1], id: `a${id++}`, url: `https://example.test/${id}`, title: `${title} ${FILLER[Math.floor(rand() * FILLER.length)]}`,
        source: sibling.title, sourceId: sibling.id, published: published - Math.floor(rand() * 3_600_000),
      });
    }
  }
  return items;
}

export function history(count: number, seed: number): ArticleFeedback[] {
  const rand = mulberry32(seed);
  const liked = [...LIKED];
  const disliked = [...DISLIKED];
  const neutral = Object.keys(TOPICS).filter((t) => !LIKED.has(t) && !DISLIKED.has(t) && t !== 'woodworking');
  return Array.from({ length: count }, (_, i) => {
    const r = rand();
    // 60 % upvotes on liked topics, 30 % downvotes on disliked ones, 10 % noise (an upvote on a neutral topic).
    const [topic, vote]: [string, 1 | -1] = r < 0.6 ? [liked[i % liked.length], 1] : r < 0.9 ? [disliked[i % disliked.length], -1] : [neutral[i % neutral.length], 1];
    return { articleId: `h${i}`, url: '', title: text(rand, topic, lengths().title, true), summary: text(rand, topic, lengths().voteBody), content: '', sourceId: `feed/${topic}`, vote };
  });
}

export function saved(count: number, seed: number): NonNullable<IntelligenceContext['savedArticles']> {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `saved${i}`, title: text(rand, i % 2 ? 'astronomy' : 'rust', lengths().title, true), summary: text(rand, i % 2 ? 'astronomy' : 'rust', lengths().voteBody), content: '',
    sourceId: i % 2 ? 'feed/sky' : 'feed/rust-blog', starred: i % 3 !== 0, readLater: i % 3 === 0,
  }));
}

