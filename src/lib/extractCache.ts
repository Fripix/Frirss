// Two-tier cache for extracted ("full content") articles:
//   - an in-memory LRU (synchronous, instant for the render path);
//   - backed by IndexedDB (persistent across reloads, survives offline).
// Read order: memory → IndexedDB → (caller falls back to a live fetch).
import type { ExtractedContent } from '../utils/extractContent';
import { dbGet, dbPut, dbRecent, dbEvictOlderThan, dbSetPinned } from './extractStore';

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

/** Synchronous peek — memory only. Used on the instant render/swipe path. */
export function peekExtract(id: string): ExtractedContent | undefined {
  return mem.get(id);
}

/** Memory → IndexedDB. Promotes an IndexedDB hit into memory. */
export async function getExtract(id: string): Promise<ExtractedContent | undefined> {
  const inMem = mem.get(id);
  if (inMem) return inMem;
  const rec = await dbGet(id);
  if (rec) {
    const content = toContent(rec);
    memSet(id, content);
    return content;
  }
  return undefined;
}

/** Write-through: memory + IndexedDB. Preserves an existing pinned flag. */
export async function putExtract(id: string, content: ExtractedContent, opts?: { pinned?: boolean }): Promise<void> {
  memSet(id, content);
  let pinned = opts?.pinned ?? false;
  if (!pinned) {
    const existing = await dbGet(id);
    if (existing?.pinned) pinned = true;
  }
  await dbPut({ ...content, id, cachedAt: Date.now(), pinned });
}

/** App start: evict content older than the retention window, then warm the
 *  in-memory LRU with the most recent entries so reads are instant. */
export async function hydrateExtractCache(): Promise<void> {
  await dbEvictOlderThan(Date.now() - RETENTION_MS);
  const recent = await dbRecent(MEM_MAX);
  for (const rec of recent) {
    if (!mem.has(rec.id)) mem.set(rec.id, toContent(rec));
  }
}

export function pinExtract(id: string): Promise<void> {
  return dbSetPinned(id, true);
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
  if (rec && Date.now() - rec.cachedAt < REVALIDATE_AFTER_MS) return; // fresh enough
  try {
    const { extractFullContent } = await import('../utils/extractContent');
    const fresh = await extractFullContent(url);
    if (!rec || fresh.content !== rec.content) {
      memSet(id, fresh);
      await putExtract(id, fresh); // preserves the pinned flag
    } else {
      await dbPut({ ...rec, cachedAt: Date.now() }); // unchanged → just bump freshness
    }
  } catch {
    /* ignore */
  }
}
