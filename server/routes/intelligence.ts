import { Router } from 'express';
import { createHash } from 'node:crypto';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Feedback is keyed by the authenticated user and stable article ID. A vote
// replaces the previous vote; DELETE removes it (the UI's undo action).
db.exec(`
  CREATE TABLE IF NOT EXISTS intelligence_feedback (
    user_id INTEGER NOT NULL,
    article_id TEXT NOT NULL,
    article_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, article_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_intelligence_feedback_user_vote
    ON intelligence_feedback(user_id, vote);
`);

// Additive migration for databases created before article text was stored.
for (const [column, definition] of [['summary', "TEXT NOT NULL DEFAULT ''"], ['content', "TEXT NOT NULL DEFAULT ''"]] as const) {
  const columns = db.prepare('PRAGMA table_info(intelligence_feedback)').all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec('ALTER TABLE intelligence_feedback ADD COLUMN ' + column + ' ' + definition);
  }
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

router.get('/feedback', (req, res) => {
  const rows = db.prepare(`
    SELECT article_id AS articleId, article_url AS url, title, summary, content, source_id AS sourceId,
           vote, created_at AS createdAt, updated_at AS updatedAt
    FROM intelligence_feedback WHERE user_id = ?
    ORDER BY updated_at DESC LIMIT 5000
  `).all(req.user.id);
  res.json({ feedback: rows });
});

router.put('/feedback', (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!validText(body.articleId, 512) || !body.articleId.trim()
    || !validText(body.url, 4096) || !validText(body.title, 2000) || !validText(body.summary, 10000)
    || !validText(body.content, 200000) || !validText(body.sourceId, 512)
    || (body.vote !== 1 && body.vote !== -1)) {
    return res.status(400).json({ error: 'Invalid article feedback', fields: {
      articleId: typeof body.articleId === 'string' ? (body.articleId.trim().length ? 'ok' : 'empty') : 'invalid type',
      url: typeof body.url === 'string' ? (body.url.length <= 4096 ? 'ok' : 'too long') : 'invalid type',
      title: typeof body.title === 'string' ? (body.title.length <= 2000 ? 'ok' : 'too long') : 'invalid type',
      summary: typeof body.summary === 'string' ? (body.summary.length <= 10000 ? 'ok' : 'too long') : 'invalid type',
      content: typeof body.content === 'string' ? (body.content.length <= 200000 ? 'ok' : 'too long') : 'invalid type',
      sourceId: typeof body.sourceId === 'string' ? (body.sourceId.length <= 512 ? 'ok' : 'too long') : 'invalid type',
      vote: body.vote === 1 || body.vote === -1 ? 'ok' : 'invalid value',
    } });
  }

  db.prepare(`
    INSERT INTO intelligence_feedback
      (user_id, article_id, article_url, title, summary, content, source_id, vote, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, article_id) DO UPDATE SET
      article_url=excluded.article_url, title=excluded.title,
      summary=excluded.summary, content=excluded.content, source_id=excluded.source_id, vote=excluded.vote,
      updated_at=datetime('now')
  `).run(req.user.id, body.articleId.trim(), body.url, body.title, body.summary, body.content, body.sourceId, body.vote);

  res.json({ ok: true, articleId: body.articleId.trim(), vote: body.vote });
});

router.delete('/feedback/:articleId', (req, res) => {
  if (typeof req.params.articleId !== 'string' || req.params.articleId.length > 512) {
    return res.status(400).json({ error: 'Invalid article ID' });
  }
  const result = db.prepare(
    'DELETE FROM intelligence_feedback WHERE user_id = ? AND article_id = ?'
  ).run(req.user.id, req.params.articleId);
  res.json({ ok: true, removed: result.changes > 0 });
});


type ExternalSource = 'gdelt' | 'github' | 'hackerNews' | 'lobsters';
type ExternalSignals = Record<ExternalSource, number | null>;
interface ExternalArticleInput { url: string; title: string; summary: string; content: string }
const EXTERNAL_SOURCES = new Set<ExternalSource>(['gdelt', 'github', 'hackerNews', 'lobsters']);
const EXTERNAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS interesting_external_signal_cache (
    cache_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_interesting_external_signal_cache_checked
    ON interesting_external_signal_cache(checked_at);
`);
db.prepare('DELETE FROM interesting_external_signal_cache WHERE checked_at < ?').run(Date.now() - 30 * 86400000);

function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.protocol = 'https:';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return raw.trim();
  }
}
function cacheKey(source: ExternalSource, url: string): string {
  return source + ':' + createHash('sha256').update(canonicalUrl(url)).digest('hex');
}
function readSignalCache(source: ExternalSource, url: string): { hit: boolean; value: number | null } {
  const row = db.prepare('SELECT value_json AS valueJson, checked_at AS checkedAt FROM interesting_external_signal_cache WHERE cache_key = ?')
    .get(cacheKey(source, url)) as { valueJson: string; checkedAt: number } | undefined;
  if (!row || Date.now() - row.checkedAt > EXTERNAL_CACHE_TTL_MS) return { hit: false, value: null };
  try {
    const parsed = JSON.parse(row.valueJson) as { value: number | null };
    return { hit: true, value: parsed.value };
  } catch {
    return { hit: false, value: null };
  }
}
function writeSignalCache(source: ExternalSource, url: string, value: number | null): void {
  db.prepare(`INSERT INTO interesting_external_signal_cache (cache_key, value_json, checked_at)
    VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET value_json=excluded.value_json, checked_at=excluded.checked_at`)
    .run(cacheKey(source, url), JSON.stringify({ value }), Date.now());
}
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'FriRSS-Interesting/1.0' } });
    if (!response.ok) throw new Error('External provider returned HTTP ' + response.status);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}
async function getSignal(
  source: ExternalSource,
  article: ExternalArticleInput,
  fetcher: () => Promise<number | null>,
): Promise<number | null> {
  const cached = readSignalCache(source, article.url);
  if (cached.hit) return cached.value;
  try {
    const value = await fetcher();
    writeSignalCache(source, article.url, value);
    return value;
  } catch {
    // Do not cache transient failures; another request can retry.
    return null;
  }
}
function hostFromUrl(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function canonicalRepository(article: ExternalArticleInput): string | null {
  const text = [article.url, article.title, article.summary, article.content.slice(0, 12000)].join(' ');
  const matches = [...text.matchAll(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi)];
  for (const match of matches) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    if (!owner || !repo || ['issues', 'pull', 'pulls', 'tree', 'blob', 'commit', 'commits', 'settings', 'orgs', 'features', 'sponsors', 'topics'].includes(owner.toLowerCase())) continue;
    return owner + '/' + repo;
  }
  return null;
}
async function githubSignal(article: ExternalArticleInput): Promise<number | null> {
  const repository = canonicalRepository(article);
  if (!repository) return null; // Not applicable is neutral, not a penalty.
  const data = await fetchJson<{ stargazers_count?: number; pushed_at?: string; archived?: boolean }>(
    'https://api.github.com/repos/' + repository.split('/').map(encodeURIComponent).join('/'),
  );
  const stars = Math.max(0, data.stargazers_count ?? 0);
  const popularity = Math.min(1, Math.log1p(stars) / Math.log1p(100000));
  const pushedAt = data.pushed_at ? Date.parse(data.pushed_at) : 0;
  const daysSincePush = pushedAt > 0 ? Math.max(0, (Date.now() - pushedAt) / 86400000) : 3650;
  const activity = data.archived ? 0 : 1 / (1 + daysSincePush / 90);
  return clamp01(popularity * 0.65 + activity * 0.35);
}
async function gdeltSignal(article: ExternalArticleInput): Promise<number> {
  const stop = new Set([
    'the','and','for','with','from','that','this','into','about','after','before','over','under','how','why','what','when','where','who','are','was','were','has','have','will','its','new','says','said',
    'der','die','das','und','mit','fur','von','den','dem','des','ein','eine','einer','eines','einem','einen','ist','sind','nicht','auch','nach','vor','uber','unter','bei','aus','wie','was','wer','wird','werden','wurden','neue','neuen','laut','sagte',
    'les','des','une','pour','avec','dans','est','sont','aux','sur','par','qui','que','cette','ces','leur','leurs','mais','pas',
  ]);
  const terms = article.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g)?.filter((term) => !stop.has(term)) ?? [];
  const queryTerms = [...new Set(terms)].slice(0, 6);
  if (queryTerms.length < 2) return 0;
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000);
  const stamp = (date: Date) => date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const query = queryTerms.join(' ');
  const endpoint = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
    query, mode: 'artlist', maxrecords: '50', format: 'json', sort: 'HybridRel',
    startdatetime: stamp(start), enddatetime: stamp(end),
  }).toString();
  const data = await fetchJson<{ articles?: Array<{ url?: string; domain?: string }> }>(endpoint);
  const items = data.articles ?? [];
  const domains = new Set(items.map((item) => item.domain || hostFromUrl(item.url ?? '')).filter(Boolean));
  const breadth = Math.min(1, Math.log1p(domains.size) / Math.log1p(8));
  const volume = Math.min(1, Math.log1p(items.length) / Math.log1p(30));
  return clamp01(breadth * 0.7 + volume * 0.3);
}
async function hackerNewsSignal(article: ExternalArticleInput): Promise<number> {
  const endpoint = 'https://hn.algolia.com/api/v1/search?' + new URLSearchParams({
    query: canonicalUrl(article.url), tags: 'story', hitsPerPage: '10',
  }).toString();
  const data = await fetchJson<{ hits?: Array<{ url?: string; points?: number; num_comments?: number; created_at_i?: number }> }>(endpoint);
  const target = canonicalUrl(article.url);
  const hit = (data.hits ?? []).find((item) => item.url && canonicalUrl(item.url) === target);
  if (!hit) return 0;
  const engagement = Math.min(1, Math.log1p(Math.max(0, hit.points ?? 0) + Math.max(0, hit.num_comments ?? 0) * 0.5) / Math.log1p(500));
  const ageDays = hit.created_at_i ? Math.max(0, (Date.now() / 1000 - hit.created_at_i) / 86400) : 30;
  return clamp01(engagement * (0.6 + 0.4 / (1 + ageDays / 14)));
}
let lobstersStoriesCache: Array<{ url?: string; score?: number; comments_count?: number; created_at?: string }> | null = null;
let lobstersStoriesExpires = 0;
async function getLobstersStories(): Promise<Array<{ url?: string; score?: number; comments_count?: number; created_at?: string }>> {
  if (lobstersStoriesCache && Date.now() < lobstersStoriesExpires) return lobstersStoriesCache;
  lobstersStoriesCache = await fetchJson<Array<{ url?: string; score?: number; comments_count?: number; created_at?: string }>>('https://lobste.rs/hottest.json');
  lobstersStoriesExpires = Date.now() + 10 * 60 * 1000;
  return lobstersStoriesCache;
}
async function lobstersSignal(article: ExternalArticleInput): Promise<number> {
  const stories = await getLobstersStories();
  const target = canonicalUrl(article.url);
  const story = stories.find((item) => item.url && canonicalUrl(item.url) === target);
  if (!story) return 0;
  const engagement = Math.min(1, Math.log1p(Math.max(0, story.score ?? 0) + Math.max(0, story.comments_count ?? 0) * 0.5) / Math.log1p(200));
  const ageDays = story.created_at ? Math.max(0, (Date.now() - Date.parse(story.created_at)) / 86400000) : 30;
  return clamp01(engagement * (0.6 + 0.4 / (1 + ageDays / 14)));
}
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}

// External signals are opt-in through the five experimental ranking variants.
// Requests are bounded, cached per article/source for 24 hours, and failures
// remain null so a provider outage cannot demote articles.
router.post('/external-signals', async (req, res) => {
  const body = req.body as { articles?: unknown; sources?: unknown };
  if (!Array.isArray(body.articles) || body.articles.length > 80 || !Array.isArray(body.sources)
    || body.sources.length < 1 || body.sources.some((source) => typeof source !== 'string' || !EXTERNAL_SOURCES.has(source as ExternalSource))) {
    return res.status(400).json({ error: 'Invalid external-signal request' });
  }
  const sources = [...new Set(body.sources as ExternalSource[])];
  const articles: ExternalArticleInput[] = [];
  for (const raw of body.articles) {
    if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'Invalid article' });
    const item = raw as Record<string, unknown>;
    if (typeof item.url !== 'string' || item.url.length > 4096 || !/^https?:\/\//i.test(item.url)
      || typeof item.title !== 'string' || item.title.length > 2000
      || typeof item.summary !== 'string' || item.summary.length > 10000
      || typeof item.content !== 'string' || item.content.length > 12000) {
      return res.status(400).json({ error: 'Invalid article fields' });
    }
    articles.push({ url: item.url, title: item.title, summary: item.summary, content: item.content });
  }
  const signals = await mapWithConcurrency(articles, 4, async (article) => {
    const entries = await Promise.all(sources.map(async (source) => {
      const fetcher = source === 'gdelt' ? () => gdeltSignal(article)
        : source === 'github' ? () => githubSignal(article)
        : source === 'hackerNews' ? () => hackerNewsSignal(article)
        : () => lobstersSignal(article);
      return [source, await getSignal(source, article, fetcher)] as const;
    }));
    const result: ExternalSignals = { gdelt: null, github: null, hackerNews: null, lobsters: null };
    for (const [source, value] of entries) result[source] = value;
    return [article.url, result] as const;
  });
  res.json({ signals: Object.fromEntries(signals) });
});

export default router;
