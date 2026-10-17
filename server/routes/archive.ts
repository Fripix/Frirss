import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertTargetSafe, fetchUpstream, proxyRateLimiter } from './proxy.js';
import { cacheEnabled, cacheGet, cacheSet, cacheKey } from '../cache.js';

const router = Router();
router.use(requireAuth);
if (proxyRateLimiter) router.use(proxyRateLimiter);

const DEFAULT_DOMAINS = [
  'wsj.com', 'ft.com', 'bloomberg.com', 'economist.com',
  'nytimes.com', 'spiegel.de', 'washingtonpost.com', 'sueddeutsche.de',
];
const ARCHIVE_HOSTS = new Set([
  'archive.is', 'archive.today', 'archive.ph', 'archive.md', 'archive.li',
  'archive.fo', 'archive.vn', 'archive.st', 'archive.gs',
]);
const REDIRECT_WRAPPERS = new Set(['apple.news']);
const MAX_REDIRECTS = 5;
const MAX_TIMEMAP_BYTES = 64 * 1024;
const MAX_PROBE_BYTES = 32 * 1024;
const MAX_SNAPSHOT_CHECKS = 5;
const TIMEMAP_TIMEOUT_MS = 7_000;
const TIMEMAP_BODY_TIMEOUT_MS = 2_000;
const SNAPSHOT_TIMEOUT_MS = 4_000;
const PROBE_BODY_TIMEOUT_MS = 2_000;

export type ArchiveResolveResult =
  | { status: 'ok'; url: string; timestamp: string }
  | { status: 'no_snapshot' | 'no_good_snapshot' | 'soft_block' | 'error' | 'not_allowed' };

interface Memento { url: string; timestamp: string; datetimeIso: string }

function normaliseDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.length > 253 || domain.includes('://') || /[/:?#@\s*]/.test(domain)) return null;
  if (!domain.includes('.') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(domain) || domain.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return domain;
}

function normaliseDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_DOMAINS];
  const domains: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const domain = normaliseDomain(entry);
    if (domain && !domains.includes(domain) && domains.length < 100) domains.push(domain);
  }
  return domains;
}

function savedDomains(userId: number): string[] {
  try {
    const row = db.prepare('SELECT value FROM preferences WHERE user_id = ? AND key = ?')
      .get(userId, 'archiveDomains') as { value: string } | undefined;
    if (!row) return [...DEFAULT_DOMAINS];
    // A saved empty array is an explicit opt-out, not a missing preference.
    return normaliseDomains(JSON.parse(row.value));
  } catch {
    return [...DEFAULT_DOMAINS];
  }
}

function hostMatches(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => host === domain || host.endsWith('.' + domain));
}

function isArchiveHost(hostname: string): boolean {
  return ARCHIVE_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''));
}

export function normalizeArticleUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || k === 'mod') url.searchParams.delete(key);
  }
  return url.toString();
}

function timeMapUrl(originalUrl: string): string {
  // TimeMap expects the original URL appended to the endpoint, including its query.
  return `https://archive.is/timemap/${originalUrl}`;
}

/** Parse RFC 7089 link-format; rel values can contain several whitespace-separated tokens. */
export function parseTimeMap(body: string): Memento[] {
  const found = new Map<string, Memento>();
  const pattern = /<([^>]+)>\s*;\s*rel="([^"]+)"([^<]*)/g;
  for (const match of body.matchAll(pattern)) {
    const rawUrl = match[1];
    const rel = match[2].toLowerCase().split(/\s+/);
    if (!rel.includes('memento') || !rawUrl) continue;
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (!isArchiveHost(url.hostname)) continue;
    const timestampMatch = url.pathname.match(/^\/(\d{14})\//);
    if (!timestampMatch) continue;
    const timestamp = timestampMatch[1];
    const dateValue = match[3]?.match(/datetime="([^"]+)"/)?.[1];
    const parsedTime = dateValue ? Date.parse(dateValue) : Date.UTC(
      Number(timestamp.slice(0, 4)), Number(timestamp.slice(4, 6)) - 1,
      Number(timestamp.slice(6, 8)), Number(timestamp.slice(8, 10)),
      Number(timestamp.slice(10, 12)), Number(timestamp.slice(12, 14)),
    );
    if (!Number.isFinite(parsedTime)) continue;
    // Mirrors share the same identity: timestamp + publisher URL.
    url.protocol = 'https:';
    url.hostname = 'archive.is';
    url.port = '';
    found.set(timestamp, { url: url.toString(), timestamp, datetimeIso: new Date(parsedTime).toISOString() });
  }
  return [...found.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

/**
 * Fetch known Archive.today hosts only. Redirects are manual so every new
 * destination is restricted to the same explicit archive-host list; fetchUpstream
 * independently repeats FriRSS's DNS-resolving SSRF check on every hop.
 */
async function fetchArchive(
  rawUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ response: Response; url: string } | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return null; }
    if (parsed.protocol !== 'https:' || !isArchiveHost(parsed.hostname)) return null;
    const response = await fetchUpstream(current, { headers, timeoutMs, followRedirects: false });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location || hop === MAX_REDIRECTS) return null;
      let next: URL;
      try { next = new URL(location, current); } catch { return null; }
      if (next.protocol === 'http:') next.protocol = 'https:';
      if (next.protocol !== 'https:' || !isArchiveHost(next.hostname)) return null;
      current = next.toString();
      continue;
    }
    return { response, url: current };
  }
  return null;
}

async function readPrefixText(response: Response, maxBytes: number, timeoutMs: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let size = 0;
  let text = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const decoder = new TextDecoder();
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      size += slice.byteLength;
      text += decoder.decode(slice, { stream: true });
      if (slice.byteLength < value.byteLength) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    if (size >= maxBytes) await reader.cancel().catch(() => {});
    text += decoder.decode();
    return timedOut ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

async function readLimitedText(response: Response, maxBytes: number, timeoutMs: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  let size = 0;
  let text = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return timedOut ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

function normaliseVisibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deliberately do not match the word "captcha" by itself: working articles can contain it. */
export function looksLikeChallengePage(html: string, publisherHostname: string): boolean {
  const titleRaw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '';
  const title = normaliseVisibleText(titleRaw).toLowerCase();
  const host = publisherHostname.toLowerCase().replace(/^www\./, '');
  const body = normaliseVisibleText(html).toLowerCase();
  if (!title || title === host || title === publisherHostname.toLowerCase()) return true;
  if (body.includes('please enable js and disable any ad blocker')
    || body.includes('please enable javascript and disable any ad blocker')
    || body.includes('are you a robot?')
    || body.includes('security verification')
    || body.includes('access denied')
    || /^(?:please wait|just a moment|loading|access denied|error)$/i.test(title)) return true;
  // Do not use a generic short-body threshold: the first 32 KB of a legitimate
  // archived page can mostly contain scripts/styles or an article shell.
  return false;
}

async function snapshotLooksUsable(snapshotUrl: string, publisherHostname: string): Promise<boolean> {
  try {
    const result = await fetchArchive(snapshotUrl, {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
    }, SNAPSHOT_TIMEOUT_MS);
    if (!result) return false;
    const { response, url } = result;
    if (!isArchiveHost(new URL(url).hostname) || !response.ok) {
      await cancelBody(response);
      return false;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) {
      await cancelBody(response);
      return false;
    }
    const html = await readPrefixText(response, MAX_PROBE_BYTES, PROBE_BODY_TIMEOUT_MS);
    return html !== null && !looksLikeChallengePage(html, publisherHostname);
  } catch {
    return false;
  }
}

const memoryCache = new Map<string, { expiresAt: number; value: ArchiveResolveResult }>();
const inFlight = new Map<string, Promise<ArchiveResolveResult>>();
function resultTtlSeconds(result: ArchiveResolveResult): number {
  if (result.status === 'ok') return 60;
  if (result.status === 'no_snapshot' || result.status === 'no_good_snapshot') return 60;
  if (result.status === 'soft_block') return 20;
  return 10;
}
function memoryCacheSet(key: string, value: ArchiveResolveResult, ttlSeconds: number): void {
  memoryCache.delete(key);
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  while (memoryCache.size > 500) memoryCache.delete(memoryCache.keys().next().value as string);
}

function memoryCacheGet(key: string): ArchiveResolveResult | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { memoryCache.delete(key); return null; }
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value;
}
async function readCache(userId: number, key: string): Promise<ArchiveResolveResult | null> {
  const memory = memoryCacheGet(key);
  if (memory) return memory;
  if (!cacheEnabled) return null;
  try {
    const raw = await cacheGet(cacheKey(userId, key));
    if (!raw) return null;
    const value = JSON.parse(raw) as ArchiveResolveResult;
    if (value && typeof value.status === 'string') {
      memoryCacheSet(key, value, resultTtlSeconds(value));
      return value;
    }
  } catch { /* cache failure → fresh lookup */ }
  return null;
}
async function writeCache(userId: number, key: string, value: ArchiveResolveResult): Promise<void> {
  const ttl = resultTtlSeconds(value);
  memoryCacheSet(key, value, ttl);
  if (cacheEnabled) {
    try { await cacheSet(cacheKey(userId, key), JSON.stringify(value), ttl); } catch { /* memory cache still works */ }
  }
}

async function resolvePublisherUrl(originalUrl: string, domains: string[]): Promise<string | null> {
  const parsed = new URL(originalUrl);
  if (hostMatches(parsed.hostname, domains)) return originalUrl;
  if (![...REDIRECT_WRAPPERS].some((wrapper) => parsed.hostname === wrapper || parsed.hostname.endsWith('.' + wrapper))) return null;
  try {
    const response = await fetchUpstream(originalUrl, { headers: { Accept: 'text/html' }, timeoutMs: 5_000 });
    const finalUrl = response.url;
    await cancelBody(response);
    if (!finalUrl) return null;
    const final = new URL(finalUrl);
    return (final.protocol === 'http:' || final.protocol === 'https:') && hostMatches(final.hostname, domains)
      ? normalizeArticleUrl(finalUrl)
      : null;
  } catch { return null; }
}

async function resolveForUser(userId: number, rawUrl: string, domains: string[]): Promise<ArchiveResolveResult> {
  const normalisedUrl = normalizeArticleUrl(rawUrl);
  if (!normalisedUrl) return { status: 'error' };
  const parsedOriginal = new URL(normalisedUrl);
  if (!hostMatches(parsedOriginal.hostname, domains)
    && ![...REDIRECT_WRAPPERS].some((wrapper) => parsedOriginal.hostname === wrapper || parsedOriginal.hostname.endsWith('.' + wrapper))) {
    return { status: 'not_allowed' };
  }

  try { await assertTargetSafe(normalisedUrl); }
  catch { return { status: 'error' }; }

  const key = `archive-resolve:${normalisedUrl}:${[...domains].sort().join(',')}`;
  const cached = await readCache(userId, key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;
  if (inFlight.size >= 64) return { status: 'error' };

  const work = (async (): Promise<ArchiveResolveResult> => {
    const publisherUrl = await resolvePublisherUrl(normalisedUrl, domains);
    if (!publisherUrl) return { status: 'not_allowed' };
    // The original target was already DNS-checked before this cache lookup.
    // Re-check only when a wrapper resolved to a different publisher URL.
    if (publisherUrl !== normalisedUrl) {
      try { await assertTargetSafe(publisherUrl); } catch { return { status: 'error' }; }
    }
    const publisher = new URL(publisherUrl);

    const lookup = await fetchArchive(timeMapUrl(publisherUrl), {
      Accept: 'application/link-format',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    }, TIMEMAP_TIMEOUT_MS);
    if (!lookup) return { status: 'soft_block' };
    const { response } = lookup;
    if (!response.ok) { await cancelBody(response); return { status: 'error' }; }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/link-format')) {
      await cancelBody(response);
      return { status: 'soft_block' };
    }
    const timeMap = await readLimitedText(response, MAX_TIMEMAP_BYTES, TIMEMAP_BODY_TIMEOUT_MS);
    if (timeMap === null) return { status: 'soft_block' };
    const snapshots = parseTimeMap(timeMap).slice(0, 100);
    if (!snapshots.length) return { status: 'no_snapshot' };

    // Probe a small fixed number concurrently so one broken snapshot does not
    // leave the new tab blank for a long serial chain of timeouts. Preserve the
    // TimeMap's newest-first order when selecting the winner.
    const candidates = snapshots.slice(0, MAX_SNAPSHOT_CHECKS);
    const usable = await Promise.all(candidates.map((candidate) =>
      snapshotLooksUsable(candidate.url, publisher.hostname)));
    const winner = candidates.find((candidate, index) => usable[index]);
    return winner
      ? { status: 'ok', url: winner.url, timestamp: winner.timestamp }
      : { status: 'no_good_snapshot' };
  })();

  inFlight.set(key, work);
  try {
    const result = await work;
    await writeCache(userId, key, result);
    return result;
  } finally {
    if (inFlight.get(key) === work) inFlight.delete(key);
  }
}

router.get('/resolve', async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!rawUrl || rawUrl.length > 4096) return res.status(400).json({ status: 'error' });
  try {
    const result = await resolveForUser(req.user.id, rawUrl, savedDomains(req.user.id));
    return res.json(result);
  } catch {
    // Archive.is is optional; lookup failures must never break external opening.
    return res.json({ status: 'error' } satisfies ArchiveResolveResult);
  }
});

export default router;
