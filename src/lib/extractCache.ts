// Two-tier cache for extracted ("full content") articles:
//   - an in-memory LRU (synchronous, instant for the render path);
//   - backed by IndexedDB (persistent across reloads, survives offline).
// Read order: memory → IndexedDB → (caller falls back to a live fetch).
import type { ExtractedContent } from '../utils/extractContent';
import { EXTRACT_VERSION } from './extractVersion';
import { dbGet, dbPut, dbRecent, dbEvictOlderThan, dbPinFor, dbUnpinExcept, pinnedFor, type ExtractRecord } from './extractStore';

const MEM_MAX = 80;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const mem = new Map<string, ExtractedContent>();

function memSet(id: string, content: ExtractedContent): void {
  mem.delete(id);
  mem.set(id, content);
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
}

function toContent(rec: { title: string; content: string; excerpt: string; byline: string; siteName: string; length: number }): ExtractedContent {
  return {
    title: rec.title,
    content: rec.content,
    excerpt: rec.excerpt,
    byline: rec.byline,
    siteName: rec.siteName,
    length: rec.length,
  };
}

/**
 * Produced by the current extraction (`EXTRACT_VERSION`)? A record from an
 * earlier one may be a truncated article that a later algorithm gets right
 * (the CERT-FR advisories before L-04/A-1) — A-2.
 */
function isCurrent(rec: ExtractRecord): boolean {
  return (rec.extractVersion ?? 1) === EXTRACT_VERSION;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Synchronous peek — memory only. Used on the instant render/swipe path. */
export function peekExtract(id: string): ExtractedContent | undefined {
  return mem.get(id);
}

/**
 * Memory → IndexedDB. Promotes an IndexedDB hit into memory.
 *
 * A record from an earlier extraction is not served online: the caller
 * extracts again, and `putExtract` replaces it keeping its pin. It is NOT
 * deleted meanwhile — offline, it is still served (an older extract beats no
 * article), but never promoted into memory, whence it would be served again
 * once back online. Online, if extracting again fails, the caller falls back
 * to it through `getOutdatedExtract` (M-03).
 */
export async function getExtract(id: string): Promise<ExtractedContent | undefined> {
  const inMem = mem.get(id);
  if (inMem) return inMem;
  const rec = await dbGet(id);
  if (!rec) return undefined;
  if (!isCurrent(rec)) return isOffline() ? toContent(rec) : undefined;
  const content = toContent(rec);
  memSet(id, content);
  return content;
}

/**
 * The extract an EARLIER extraction left in IndexedDB — whatever its version,
 * as long as it is not the current one — or nothing. Never promoted into
 * memory. The fallback when extracting again fails online (M-03): a pinned
 * favorite whose page no longer extracts keeps the article it opens offline,
 * instead of an error over the feed's content.
 */
export async function getOutdatedExtract(id: string): Promise<ExtractedContent | undefined> {
  const rec = await dbGet(id);
  return rec && !isCurrent(rec) ? toContent(rec) : undefined;
}

/** Write-through: memory + IndexedDB. Preserves an existing pin and the
 *  scopes that hold it; `pinned` with a `scope` adds that scope. */
export async function putExtract(
  id: string,
  content: ExtractedContent,
  opts?: { pinned?: boolean; scope?: string },
): Promise<void> {
  memSet(id, content);
  const existing = await dbGet(id);
  const base: ExtractRecord = {
    ...content, id, cachedAt: Date.now(), extractVersion: EXTRACT_VERSION,
    pinned: existing?.pinned ?? false,
    ...(existing?.pinScopes ? { pinScopes: existing.pinScopes } : {}),
  };
  const pinned = opts?.pinned && opts.scope
    ? pinnedFor(base, opts.scope) ?? base
    : { ...base, pinned: base.pinned || !!opts?.pinned };
  await dbPut(pinned);
}

/** App start: evict content older than the retention window, then warm the
 *  in-memory LRU with the most recent entries so reads are instant. */
export async function hydrateExtractCache(): Promise<void> {
  await dbEvictOlderThan(Date.now() - RETENTION_MS);
  const recent = await dbRecent(MEM_MAX);
  for (const rec of recent) {
    if (!mem.has(rec.id) && isCurrent(rec)) mem.set(rec.id, toContent(rec));
  }
}

/** Pinned for this account and server (`user@server`). */
export function pinExtract(id: string, scope: string): Promise<void> {
  return dbPinFor(id, scope);
}

/** Articles no longer starred nor read-later for `scope` lose its pin: once
 *  no scope pins them, their extract ages out like any other. Another
 *  scope's favorites are left alone — the store is shared by all of them. */
export function unpinExtractsExcept(ids: ReadonlySet<string>, scope: string): Promise<void> {
  return dbUnpinExcept(ids, scope);
}

const REVALIDATE_AFTER_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Stale-while-revalidate: if the cached extraction is older than the window
 * (and we're online), re-extract in the background and silently refresh the
 * cache — so the *next* open shows the updated article. The current view is
 * not swapped (avoids a jarring reflow while reading). Best-effort.
 */
export async function revalidateIfStale(id: string, url: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const rec = await dbGet(id);
  // Fresh enough — unless an earlier extraction produced it (A-2).
  if (rec && isCurrent(rec) && Date.now() - rec.cachedAt < REVALIDATE_AFTER_MS) return;
  try {
    const { extractFullContent } = await import('../utils/extractContent');
    const fresh = await extractFullContent(url);
    if (!rec || fresh.content !== rec.content) {
      memSet(id, fresh);
      await putExtract(id, fresh); // preserves the pinned flag
    } else {
      // Unchanged → just bump freshness, and the stamp: it was just re-extracted.
      await dbPut({ ...rec, cachedAt: Date.now(), extractVersion: EXTRACT_VERSION });
    }
  } catch {
    /* ignore */
  }
}
