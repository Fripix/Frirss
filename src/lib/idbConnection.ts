// One IndexedDB connection per store module, reopened when it is lost.
//
// Both stores used to cache their connection promise forever. When the browser
// clears the site's storage (low disk space, the user clearing site data), it
// CLOSES that connection: every later read and write failed silently until a
// reload — extracts no longer kept, and the queue of offline actions lost.
// Seen on Android during a 6,600-article offline preparation (1.8.0).

export interface CachedConnection {
  get(): Promise<IDBDatabase>;
  /** Forget the connection — only `db` when given, so a failure on an old
   *  connection never drops a fresh one: the next `get()` opens a new one. */
  reset(db?: IDBDatabase): void;
}

export function cachedConnection(open: () => Promise<IDBDatabase>): CachedConnection {
  let current: Promise<IDBDatabase> | null = null;
  let currentDb: IDBDatabase | null = null;
  const conn: CachedConnection = {
    get() {
      if (current) return current;
      const mine: Promise<IDBDatabase> = open().then(
        (db) => {
          // Both references go: a stale `currentDb` would let a failure on
          // this closed connection drop the reopening already under way.
          const forget = () => {
            if (current === mine) current = null;
            if (currentDb === db) currentDb = null;
          };
          // `close`: closed by the browser (storage cleared). `versionchange`:
          // another tab wants to upgrade — step aside, or it stays blocked.
          db.addEventListener('close', forget);
          db.addEventListener('versionchange', () => { db.close(); forget(); });
          if (current === mine) currentDb = db;
          return db;
        },
        (err) => {
          // A failed open is not kept: the next call tries again.
          if (current === mine) current = null;
          throw err;
        },
      );
      current = mine;
      return mine;
    },
    reset(db) {
      if (db && db !== currentDb) return;
      current = null;
      currentDb = null;
    },
  };
  return conn;
}

/** Names under which a lost connection surfaces: `InvalidStateError`
 *  (closed), and `UnknownError` on Safari ("Connection to Indexed Database
 *  server lost", with no `close` event). */
const LOST_CONNECTION = new Set(['InvalidStateError', 'UnknownError']);

/**
 * `db.transaction(...)`, forgetting the connection when it is already closed:
 * the `close` event can arrive after the first failing call, and without this
 * that call's caller would be the only one to notice.
 */
export function transactionOn(
  conn: CachedConnection,
  db: IDBDatabase,
  names: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  try {
    return db.transaction(names, mode);
  } catch (err) {
    if (LOST_CONNECTION.has((err as { name?: string })?.name ?? '')) conn.reset(db);
    throw err;
  }
}
