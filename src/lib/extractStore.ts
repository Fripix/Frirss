// Persistent store (IndexedDB) for extracted ("full content") articles.
// Lets the reading pane serve full content instantly and across reloads,
// instead of re-fetching + re-parsing every time. All methods degrade
// gracefully (resolve to no-op / undefined) if IndexedDB is unavailable.
import type { ExtractedContent } from '../utils/extractContent';

export interface ExtractRecord extends ExtractedContent {
  id: string; // article id (primary key)
  cachedAt: number; // epoch ms — used for retention/eviction
  pinned: boolean; // favorites / read-later — never auto-evicted (used later)
}

const DB_NAME = 'frirss';
const STORE = 'extracts';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
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
  });
  return dbPromise;
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
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

export async function dbSetPinned(id: string, pinned: boolean): Promise<void> {
  const rec = await dbGet(id);
  if (rec && rec.pinned !== pinned) {
    rec.pinned = pinned;
    await dbPut(rec);
  }
}
