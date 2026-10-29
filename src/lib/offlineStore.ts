// Offline persistence for the feed data the UI needs to render without a
// network: the subscriptions snapshot (sidebar) and per-view article lists.
// Separate IndexedDB database from the extract cache (no migration coupling).
// Every method degrades gracefully (no-op / undefined) if IndexedDB is absent.
import type { Article, Subscription } from '../types';
import type { QueuedAction } from './actionQueue';
import { cachedConnection, transactionOn } from './idbConnection';

const DB_NAME = 'frirss-offline';
const VERSION = 2;
const LISTS = 'lists';
const SUBS = 'subs';
const ACTIONS = 'actions';

export interface ListRecord {
  key: string; // viewKey (feedId + filter)
  articles: Article[];
  continuation: string | null;
  cachedAt: number;
}

// Reopened when the browser closes it (see `idbConnection.ts`).
const conn = cachedConnection(() => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB unavailable'));
    return;
  }
  const req = indexedDB.open(DB_NAME, VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(LISTS)) {
      db.createObjectStore(LISTS, { keyPath: 'key' }).createIndex('cachedAt', 'cachedAt');
    }
    if (!db.objectStoreNames.contains(SUBS)) {
      db.createObjectStore(SUBS, { keyPath: 'key' });
    }
    // Additive migration: the guards leave the existing stores untouched.
    if (!db.objectStoreNames.contains(ACTIONS)) {
      db.createObjectStore(ACTIONS, { keyPath: 'key' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));

function openDB(): Promise<IDBDatabase> {
  return conn.get();
}

function tx(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return transactionOn(conn, db, name, mode).objectStore(name);
}

export async function listGet(key: string): Promise<ListRecord | undefined> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const r = tx(db, LISTS, 'readonly').get(key);
      r.onsuccess = () => resolve(r.result as ListRecord | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function listPut(key: string, articles: Article[], continuation: string | null): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const r = tx(db, LISTS, 'readwrite').put({ key, articles, continuation, cachedAt: Date.now() });
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

export async function listEvictOlderThan(ts: number): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const store = tx(db, LISTS, 'readwrite');
      const cur = store.index('cachedAt').openCursor(IDBKeyRange.upperBound(ts, true));
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          store.delete(c.primaryKey);
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

/** `key` carries the account and server (`feedStore`): one browser, several of each. */
export async function subsGet(key: string): Promise<Subscription[] | undefined> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const r = tx(db, SUBS, 'readonly').get(key);
      r.onsuccess = () => resolve((r.result as { subscriptions: Subscription[] } | undefined)?.subscriptions);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function subsPut(key: string, subscriptions: Subscription[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const r = tx(db, SUBS, 'readwrite').put({ key, subscriptions, cachedAt: Date.now() });
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

/**
 * Forget every cached list and subscriptions snapshot — on logout, so the next
 * account on this browser never sees the previous one's feeds and articles.
 * The action queue stays: each action names its account and server, and is
 * replayed only under them.
 */
export async function clearOfflineViews(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const t = transactionOn(conn, db, [LISTS, SUBS], 'readwrite');
      t.objectStore(LISTS).clear();
      t.objectStore(SUBS).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    });
  } catch { /* storage unavailable */ }
}

/** Actions made offline, waiting to be replayed. Empty when unavailable. */
export async function queueGet(): Promise<QueuedAction[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = tx(db, ACTIONS, 'readonly').getAll();
      req.onsuccess = () => resolve((req.result as QueuedAction[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Replace the whole queue (it is small — merging keeps it that way). */
export async function queuePut(actions: QueuedAction[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const store = tx(db, ACTIONS, 'readwrite');
      const clear = store.clear();
      clear.onsuccess = () => {
        for (const a of actions) store.put(a);
        resolve();
      };
      clear.onerror = () => reject(clear.error);
    });
  } catch { /* storage unavailable — the in-memory queue still serves */ }
}
