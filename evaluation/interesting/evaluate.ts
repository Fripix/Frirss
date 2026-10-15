/**
 * Synthetic offline comparison of the Interesting rankers.
 *
 *   npm run eval:interesting                      # report on stdout
 *   npm run eval:interesting -- --out report.md   # also write it to a file
 *   npm run eval:interesting -- --skip-runtime    # without the timing table
 *
 * SYNTHETIC ONLY. No real feeds, votes, bookmarks or Raindrop data are used.
 * The "ground truth" is how the generator was built (which topics the
 * simulated reader likes, dislikes or ignores), so these numbers say whether
 * each ranker reacts to the signals it is given, not whether real readers
 * would prefer its ordering. Real-world quality is unvalidated. Seeded and
 * deterministic, except for the timing table.
 */
import { writeFileSync } from 'node:fs';
import { INTERESTING_ALGORITHMS, rankInterestingArticles, type InterestingAlgorithm, type IntelligenceContext } from '../../src/lib/intelligenceRanking';
import { explainIntelligenceNext, rankIntelligenceNext, type IntelligenceNextOverrides } from '../../src/lib/intelligenceNext';
import type { Subscription } from '../../src/types';
import type { ArticleFeedback } from '../../src/api/intelligence';
import {
  DEALS_FEEDS, DISLIKED, LIKED, NEW_FEED, history, saved, setWorld, sharedHost, sharedPlatform, snapshot, splitDealsPublisher, subscriptions, withUndated,
  type Labeled, type World,
} from './syntheticWorld';

const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const skipRuntime = args.includes('--skip-runtime');

// ── Metrics ──────────────────────────────────────────────────────────
const percentile = (ranked: Labeled[], keep: (a: Labeled) => boolean) => {
  const positions = ranked.map((a, i) => (keep(a) ? i / Math.max(1, ranked.length - 1) : -1)).filter((p) => p >= 0);
  return positions.length ? positions.reduce((s, p) => s + p, 0) / positions.length : NaN;
};
const isDeals = (a: Labeled) => DEALS_FEEDS.includes(a.sourceId);

function metrics(ranked: Labeled[]) {
  const top = ranked.slice(0, 20);
  const bySource = new Map<string, number>();
  for (const a of top) bySource.set(a.sourceId, (bySource.get(a.sourceId) ?? 0) + 1);
  const stories = new Map<string, number>();
  for (const a of top) stories.set(a.story, (stories.get(a.story) ?? 0) + 1);
  let longestRun = 1; let run = 1;
  for (let i = 1; i < top.length; i += 1) { run = top[i].sourceId === top[i - 1].sourceId ? run + 1 : 1; longestRun = Math.max(longestRun, run); }
  return {
    likedAt20: top.filter((a) => LIKED.has(a.topic)).length / top.length,
    dislikedAt20: top.filter((a) => DISLIKED.has(a.topic)).length,
    likedPct: percentile(ranked, (a) => LIKED.has(a.topic)),
    dislikedPct: percentile(ranked, (a) => DISLIKED.has(a.topic)),
    newFeedPct: percentile(ranked, (a) => a.sourceId === NEW_FEED),
    newFeedAt20: top.filter((a) => a.sourceId === NEW_FEED).length,
    dealsAt20: top.filter(isDeals).length,
    rustPct: percentile(ranked, (a) => a.topic === 'rust'),
    undatedAt20: top.filter((a) => a.publishedMissing).length,
    undatedPct: percentile(ranked, (a) => !!a.publishedMissing),
    maxSource: Math.max(...bySource.values()),
    longestRun,
    dupPairs: [...stories.values()].reduce((s, c) => s + (c * (c - 1)) / 2, 0),
  };
}
type Metrics = ReturnType<typeof metrics>;

const NOW = Date.UTC(2026, 9, 15, 6);
const N = 300;
const fmt = (x: number, digits = 2) => (Number.isNaN(x) ? '—' : x.toFixed(digits));
const algorithms = INTERESTING_ALGORITHMS.map((a) => a.value as InterestingAlgorithm);
const label = (v: InterestingAlgorithm) => INTERESTING_ALGORITHMS.find((a) => a.value === v)!.label;
const lines: string[] = [];
const out = (s = '') => { lines.push(s); console.log(s); };

// ── Scenarios ────────────────────────────────────────────────────────
interface Scenario {
  key: string;
  title: string;
  items: Labeled[];
  votes: ArticleFeedback[];
  context: IntelligenceContext;
  note: string;
}

function scenarios(): Scenario[] {
  const items = snapshot(N, 42, NOW);
  const warm = history(60, 7);
  const sparse = history(3, 7);
  const savedItems = saved(20, 11);
  const ctx = (subs: Subscription[], withSaved: boolean): IntelligenceContext => ({ subscriptions: subs, savedArticles: withSaved ? savedItems : [] });
  const split = splitDealsPublisher(items);
  return [
    { key: 'A', title: 'A. Warm start: 60 votes, 20 saved, subscriptions', items, votes: warm, context: ctx(subscriptions, true), note: '60 votes, 20 saved, subscriptions on' },
    { key: 'B', title: 'B. Sparse feedback: 3 votes, no saved', items, votes: sparse, context: ctx(subscriptions, false), note: '3 votes, 0 saved, subscriptions on' },
    { key: 'C', title: 'C. Cold start: no votes, no saved (only subscriptions + freshness)', items, votes: [], context: ctx(subscriptions, false), note: '0 votes, 0 saved, subscriptions on' },
    { key: 'D', title: 'D. Ablation: as A but without subscriptions (only Intelligence Next reads them)', items, votes: warm, context: ctx([], true), note: '60 votes, 20 saved, subscriptions off' },
    { key: 'E', title: 'E. Cold start, the deals publisher runs three feeds on one host', items: split.items, votes: [], context: ctx(split.subscriptions, false), note: '0 votes; the deals articles are spread over three feeds of one host' },
    { key: 'F', title: 'F. Cold start, the two rust feeds are different publishers on one shared host', items, votes: [], context: ctx(sharedHost(), false), note: '0 votes; host grouping wrongly merges the two rust publishers' },
    { key: 'G', title: 'G. Warm start, 15 % of the candidates have no publication date', items: withUndated(items, 0.15, 5, NOW), votes: warm, context: ctx(subscriptions, true), note: 'as A; undated articles carry `published` = now and `publishedMissing`' },
    { key: 'H', title: 'H. Cold start, the new feed is one of eight channels on one platform host', items, votes: [], context: ctx(sharedPlatform(), false), note: '0 votes; host grouping treats the eight channels as one publisher' },
  ];
}

function describe(s: Scenario) {
  const share = (keep: (a: Labeled) => boolean) => Math.round((s.items.filter(keep).length / s.items.length) * 100);
  return `${s.items.length} unread candidates (deals ≈ ${share(isDeals)} %, liked topics ≈ ${share((a) => LIKED.has(a.topic))} %, disliked ≈ ${share((a) => DISLIKED.has(a.topic))} %${s.key === 'G' ? `, undated ≈ ${share((a) => !!a.publishedMissing)} %` : ''}); ${s.note}.`;
}

const COLUMNS: Record<string, Array<[string, (m: Metrics) => string]>> = {
  default: [
    ['liked share @20 ↑', (m) => fmt(m.likedAt20)], ['disliked @20 ↓', (m) => String(m.dislikedAt20)],
    ['liked mean pct ↓', (m) => fmt(m.likedPct)], ['disliked mean pct ↑', (m) => fmt(m.dislikedPct)],
    ['new feed mean pct ↓', (m) => fmt(m.newFeedPct)], ['new feed @20', (m) => String(m.newFeedAt20)], ['deals @20', (m) => String(m.dealsAt20)],
    ['max/source @20', (m) => String(m.maxSource)], ['longest run', (m) => String(m.longestRun)], ['dup pairs @20', (m) => String(m.dupPairs)],
  ],
  G: [
    ['liked share @20 ↑', (m) => fmt(m.likedAt20)], ['disliked @20 ↓', (m) => String(m.dislikedAt20)],
    ['undated @20 (≈ 3 expected)', (m) => String(m.undatedAt20)], ['undated mean pct', (m) => fmt(m.undatedPct)],
  ],
};

function table(s: Scenario) {
  const columns = COLUMNS[s.key] ?? COLUMNS.default;
  out(`### ${s.title}`);
  out();
  out(describe(s));
  out();
  out(`| Algorithm | ${columns.map(([name]) => name).join(' | ')} |`);
  out(`|---|${columns.map(() => '---').join('|')}|`);
  for (const algorithm of algorithms) {
    const m = metrics(rankInterestingArticles(s.items, s.votes, NOW, algorithm, s.context) as Labeled[]);
    out(`| ${label(algorithm)} | ${columns.map(([, cell]) => cell(m)).join(' | ')} |`);
  }
  out();
}

// ── Report ───────────────────────────────────────────────────────────
out('# Interesting rankers: synthetic comparison');
out();
out('Generated by `npm run eval:interesting` (`evaluation/interesting/evaluate.ts`; seeded and deterministic apart from the timings). **Synthetic data only; real-world quality is unvalidated.**');
out('The generator\'s reader likes rust / ai / astronomy and dislikes celebrity / deals. "pct" is the mean position as a fraction of the list (0 = top).');
out('"new feed" is a just-added Woodworking subscription (8 articles) with no votes on its topic. Heuristic weights are not tuned on this data or any other.');
out();
const worlds: World[] = ['realistic', 'homogeneous'];
for (const world of worlds) {
  setWorld(world);
  out(`## World: ${world}`);
  out();
  for (const s of scenarios()) {
    // E, F and H only change the subscriptions, which only Intelligence Next reads.
    if (s.key === 'E' || s.key === 'F' || s.key === 'H') continue;
    table(s);
  }
}

// ── Intelligence Next variants ───────────────────────────────────────
// The evidence knobs of PR #47 as first pushed (commit d844aab / d3c0750).
// They keep this version's handling of undated articles and of saved candidates.
const PR47: IntelligenceNextOverrides = { exampleAggregation: 'noisy-or', nearestExamples: 3, distinctExamples: false, ownFeedPrior: 'none', groupFeedsByHost: false };
const OLD_FEEDS: IntelligenceNextOverrides = { ownFeedPrior: 'none', groupFeedsByHost: false };
const RELEVANCE_ONLY: IntelligenceNextOverrides = { diversitySelections: 0, maxSourceRun: Number.MAX_SAFE_INTEGER };
const VARIANT_GROUPS: Array<[string, Array<[string, IntelligenceNextOverrides]>]> = [
  ['Vote and saved-article aggregation (feed evidence as in PR #47)', [
    ['PR #47 settings: noisy-OR of the 3 nearest', PR47],
    ['noisy-OR of the 8 nearest distinct', { ...PR47, nearestExamples: 8, distinctExamples: true }],
    ['noisy-OR of squared cosines, 8 distinct', { ...PR47, exampleAggregation: 'squared', nearestExamples: 8, distinctExamples: true }],
    ['shrunk mean Σs²/(1+Σs), 8 distinct', { ...PR47, exampleAggregation: 'shrunk', nearestExamples: 8, distinctExamples: true }],
    ['**best × support, 8 distinct** (final)', OLD_FEEDS],
  ]],
  ['Feed evidence (final vote aggregation)', [
    ['other feeds by id, no own-feed prior (PR #47)', OLD_FEEDS],
    ['other publishers by host, no prior', { ownFeedPrior: 'none' }],
    ['by host + own-feed prior: similarity to own feed', { ownFeedPrior: 'similarity' }],
    ['by id + own-feed prior: budget per feed', { groupFeedsByHost: false }],
    ['by host + budget per publisher (host)', { ownFeedBudget: 'publisher' }],
    ['**by host + budget per feed** (final)', {}],
  ]],
  ['Sensitivity of the final design (not tuned; one knob at a time)', [
    ['final', {}],
    ['support half-weight 0.35 (final 0.5)', { supportHalf: 0.35 }],
    ['support half-weight 0.65', { supportHalf: 0.65 }],
    ['own-feed weight 0.05 (final 0.1)', { ownFeedWeight: 0.05 }],
    ['own-feed weight 0.2', { ownFeedWeight: 0.2 }],
    ['own-feed budget 3 articles (final 5)', { ownFeedShare: 3 }],
    ['own-feed budget 10 articles', { ownFeedShare: 10 }],
  ]],
];

out('## Intelligence Next: variants compared');
out();
out('Same seeds and scenarios. "liked / disliked" = liked share @20 / disliked count @20. "A relevance only" = scenario A ranked by score without the diversity pass.');
out('"new" = the new feed\'s mean pct (A / B / C). "E deals" = deals articles @20 when the deals publisher runs three feeds on one host. "F rust" = the rust articles\' mean pct when the two rust publishers share a host. "G undated" = undated articles @20 (≈ 3 at the base rate). "H new" = the new feed\'s mean pct when it is one of eight channels on a platform host.');
out('The "PR #47 settings" rows reproduce its evidence knobs; they keep this version\'s neutral handling of undated articles and full strength for saved candidates.');
out();
for (const world of worlds) {
  setWorld(world);
  const all = scenarios();
  const at = (key: string) => all.find((s) => s.key === key)!;
  const run = (key: string, overrides: IntelligenceNextOverrides) => {
    const s = at(key);
    return metrics(rankIntelligenceNext(s.items, s.votes, NOW, s.context, overrides) as Labeled[]);
  };
  out(`### World: ${world}`);
  out();
  for (const [group, variants] of VARIANT_GROUPS) {
    out(`**${group}**`);
    out();
    out('| Variant | A liked / disliked | A relevance only | B liked / disliked | C liked / disliked | new (A / B / C) | E deals @20 | F rust pct | G undated @20 | H new pct |');
    out('|---|---|---|---|---|---|---|---|---|---|');
    for (const [name, overrides] of variants) {
      const [a, b, c, e, f, g, h] = ['A', 'B', 'C', 'E', 'F', 'G', 'H'].map((key) => run(key, overrides));
      const relevance = run('A', { ...overrides, ...RELEVANCE_ONLY });
      out(`| ${name} | ${fmt(a.likedAt20)} / ${a.dislikedAt20} | ${fmt(relevance.likedAt20)} | ${fmt(b.likedAt20)} / ${b.dislikedAt20} | ${fmt(c.likedAt20)} / ${c.dislikedAt20} | ${fmt(a.newFeedPct)} / ${fmt(b.newFeedPct)} / ${fmt(c.newFeedPct)} | ${e.dealsAt20} | ${fmt(f.rustPct)} | ${g.undatedAt20} | ${fmt(h.newFeedPct)} |`);
    }
    out();
  }
}

// ── Subscription evidence per feed ───────────────────────────────────
out('## Intelligence Next: subscription evidence per feed (cold start)');
out();
out('Mean corroboration by other publishers (`subscription`) and own-feed prior (`ownFeed`) over each feed\'s articles; article counts in brackets.');
out();
const FEED_GROUPS: Array<[string, string[]]> = [
  ['deals (prolific)', ['feed/deals']], ['wood (new)', [NEW_FEED]], ['sky', ['feed/sky']], ['garden', ['feed/garden']], ['stars (celebrity)', ['feed/stars']],
  ['rust (2 feeds)', ['feed/rust-blog', 'feed/this-week-rust']], ['AI (3 feeds)', ['feed/ml-papers', 'feed/ai-news', 'feed/research-lab']],
];
out(`| World | ${FEED_GROUPS.map(([name]) => name).join(' | ')} |`);
out(`|---|${FEED_GROUPS.map(() => '---').join('|')}|`);
for (const world of worlds) {
  setWorld(world);
  const s = scenarios().find((x) => x.key === 'C')!;
  const explained = explainIntelligenceNext(s.items, [], NOW, s.context);
  const cells = FEED_GROUPS.map(([, ids]) => {
    const of = explained.filter((x) => ids.includes(x.article.sourceId));
    const mean = (pick: (x: (typeof of)[number]) => number) => of.reduce((sum, x) => sum + pick(x), 0) / Math.max(1, of.length);
    return `${fmt(mean((x) => x.evidence.subscription))} / ${fmt(mean((x) => x.evidence.ownFeed))} (${of.length})`;
  });
  out(`| ${world} | ${cells.join(' | ')} |`);
}
out();

// ── Runtime ──────────────────────────────────────────────────────────
if (!skipRuntime) {
  setWorld('realistic');
  out('## Runtime (realistic world; ms, median of 5 cold-cache runs, 200 votes, 100 saved)');
  out();
  out('| Algorithm | n=50 | n=300 | n=1000 |');
  out('|---|---|---|---|');
  const votes200 = history(200, 7);
  const timingContext: IntelligenceContext = { subscriptions, savedArticles: saved(100, 11) };
  const bases = [50, 300, 1000].map((n) => snapshot(n, 42, NOW));
  for (const algorithm of algorithms) {
    const cells = bases.map((base) => {
      const times: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const items = base.map((a) => ({ ...a })); // fresh objects → cold tokenisation cache
        const started = performance.now();
        rankInterestingArticles(items, votes200, NOW, algorithm, timingContext);
        times.push(performance.now() - started);
      }
      return times.sort((a, b) => a - b)[2];
    });
    out(`| ${label(algorithm)} | ${cells.map((c) => fmt(c, 1)).join(' | ')} |`);
  }
  out();
  out(`Node ${process.version}, ${process.platform}/${process.arch}. Timings are indicative only (single machine, no isolation).`);
}

if (outPath) writeFileSync(outPath, `${lines.join('\n')}\n`);
