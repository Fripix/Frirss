// Persistent store (IndexedDB) for extracted ("full content") articles.
// Lets the reading pane serve full content instantly and across reloads,
// instead of re-fetching + re-parsing every time. All methods degrade
// gracefully (resolve to no-op / undefined) if IndexedDB is unavailable.
import type { ExtractedContent } from '../utils/extractContent';
import { cachedConnection, transactionOn } from './idbConnection';

export interface ExtractRecord extends ExtractedContent {
  id: string; // article id (primary key)
  cachedAt: number; // epoch ms — used for retention/eviction
  pinned: boolean; // favorites / read-later — never auto-evicted (used later)
  /** Accounts and servers (`user@server`) that pinned it. The store is shared
   *  by all of them and keyed by article id only: without this, warming one
   *  server unpinned every other one's favorites. Absent on a record pinned
   *  before 1.8.0 — never unpinned, adopted by the next scope to pin it. */
  pinScopes?: string[];
}

/** `rec` pinned for `scope` too, or `null` when it already is. */
export function pinnedFor(rec: ExtractRecord, scope: string): ExtractRecord | null {
  const scopes = rec.pinScopes ?? [];
  if (rec.pinned && scopes.includes(scope)) return null;
  return { ...rec, pinned: true, pinScopes: [...scopes, scope] };
}

/**
 * `rec` once `scope` no longer wants it (not in `keep`), or `null` when this
 * changes nothing: another scope's pin, or one from before 1.8.0 — it is
 * unknown whose it is, and unpinning it lets the next start evict it.
 */
export function unpinnedFor(rec: ExtractRecord, keep: ReadonlySet<string>, scope: string): ExtractRecord | null {
  if (!rec.pinned || keep.has(rec.id) || !rec.pinScopes?.includes(scope)) return null;
  const rest = rec.pinScopes.filter((s) => s !== scope);
  return { ...rec, pinned: rest.length > 0, pinScopes: rest };
}

const DB_NAME = 'frirss';
const STORE = 'extracts';
const VERSION = 1;

// Reopened when the browser closes it (see `idbConnection.ts`).
const conn = cachedConnection(() => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB unavailable'));
    return;
  }
  const req = indexedDB.open(DB_NAME, VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const os = db.createObjectStore(STORE, { keyPath: 'id' });
      os.createIndex('cachedAt', 'cachedAt'); // (booleans aren't valid keys → no pinned index)
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));

function openDB(): Promise<IDBDatabase> {
  return conn.get();
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return transactionOn(conn, db, STORE, mode).objectStore(STORE);
}

export async function dbGet(id: string): Promise<ExtractRecord | undefined> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const r = store(db, 'readonly').get(id);
      r.onsuccess = () => resolve(r.result as ExtractRecord | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function dbPut(record: ExtractRecord): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const r = store(db, 'readwrite').put(record);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/** Most recently cached records, newest first. */
export async function dbRecent(limit: number): Promise<ExtractRecord[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const out: ExtractRecord[] = [];
      const cur = store(db, 'readonly').index('cachedAt').openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (c && out.length < limit) {
          out.push(c.value as ExtractRecord);
          c.continue();
        } else {
          resolve(out);
        }
      };
      cur.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}

/** Release `scope`'s pin on every record whose id is not in `keep`: once no
 *  scope pins it, it falls back under the normal retention
 *  (`dbEvictOlderThan`). Nothing ever unpinned before. */
export async function dbUnpinExcept(keep: ReadonlySet<string>, scope: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const os = store(db, 'readwrite');
      const cur = os.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          const next = unpinnedFor(c.value as ExtractRecord, keep, scope);
          if (next) c.update(next);
          c.continue();
        } else {
          resolve();
        }
      };
      cur.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/** Delete non-pinned records cached before `ts`. */
export async function dbEvictOlderThan(ts: number): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const os = store(db, 'readwrite');
      const cur = os.index('cachedAt').openCursor(IDBKeyRange.upperBound(ts, true));
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          const rec = c.value as ExtractRecord;
          if (!rec.pinned) os.delete(rec.id);
          c.continue();
        } else {
          resolve();
        }
      };
      cur.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/** Pin an existing record for `scope` (no-op when absent or already so). */
export async function dbPinFor(id: string, scope: string): Promise<void> {
  const rec = await dbGet(id);
  const next = rec && pinnedFor(rec, scope);
  if (next) await dbPut(next);
}
