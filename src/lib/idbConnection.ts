// One IndexedDB connection per store module, reopened when it is lost.
//
// Both stores used to cache their connection promise forever. When the browser
// clears the site's storage (low disk space, the user clearing site data), it
// CLOSES that connection: every later read and write failed silently until a
// reload — extracts no longer kept, and the queue of offline actions lost.
// Seen on Android during a 6,600-article offline preparation (1.8.0).

export interface CachedConnection {
  get(): Promise<IDBDatabase>;
  /** Forget the connection: the next `get()` opens a new one. */
  reset(): void;
}

export function cachedConnection(open: () => Promise<IDBDatabase>): CachedConnection {
  let current: Promise<IDBDatabase> | null = null;
  const conn: CachedConnection = {
    get() {
      if (current) return current;
      const mine: Promise<IDBDatabase> = open().then(
        (db) => {
          const forget = () => { if (current === mine) current = null; };
          // `close`: closed by the browser (storage cleared). `versionchange`:
          // another tab wants to upgrade — step aside, or it stays blocked.
          db.addEventListener('close', forget);
          db.addEventListener('versionchange', () => { db.close(); forget(); });
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
    reset() { current = null; },
  };
  return conn;
}

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
    if ((err as { name?: string })?.name === 'InvalidStateError') conn.reset();
    throw err;
  }
}
