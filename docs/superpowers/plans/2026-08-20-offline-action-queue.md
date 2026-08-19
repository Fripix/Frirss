# Offline Action Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep read/star/read-later/label actions made offline, and replay them when the network returns, instead of silently rolling them back.

**Architecture:** A pure lib holds the decisions (merge by article+type, is this failure a network one, should we retry). A new `actions` store in the existing IndexedDB database persists the queue. The four article actions in `feedStore` queue on a network failure instead of rolling back; a replay runs on startup and on the `online` event. The existing offline banner reports the pending count.

**Tech Stack:** TypeScript (strict), React 18, Zustand, IndexedDB, axios, Vitest, i18next (9 locales).

## Global Constraints

- **No AI mentions anywhere** — neutral conventional commits, no `Co-Authored-By`.
- **Public repo — CI "Leak guard"**: never commit the personal domain, internal IPs, ports, volume paths or config hashes, docs included. Run the guard, **read its output**, then commit (an `if …; fi && git commit` chain does not block).
- **After every push, watch BOTH workflows**: `CI` *and* `Publish image`.
- **i18n**: every new string in all 9 locales, then run the parity audit (Task 6) — it must report full parity.
- **Gates before every commit**: `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **TDD**: pure logic in `src/lib/*.ts`, test-first.
- **Never queue a business failure**: a server that answers 4xx has refused the action; only a missing network goes to the queue.

---

### Task 1: Pure lib — merge, classify, retry policy

**Files:**
- Create: `src/lib/actionQueue.ts`
- Create: `src/lib/actionQueue.test.ts`

**Interfaces:**
- Produces:
  - `type QueuedActionType = 'read' | 'star' | 'readLater' | 'label'`
  - `interface QueuedAction { key: string; articleId: string; type: QueuedActionType; value: boolean; labelId?: string; at: number; attempts: number }`
  - `actionKey(articleId, type, labelId?): string`
  - `mergeAction(queue: QueuedAction[], action: QueuedAction): QueuedAction[]`
  - `isNetworkFailure(error: unknown): boolean`
  - `shouldRetry(attempts: number): boolean`
  - `MAX_ATTEMPTS` (3)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  actionKey, mergeAction, isNetworkFailure, shouldRetry, MAX_ATTEMPTS,
  type QueuedAction,
} from './actionQueue';

const act = (over: Partial<QueuedAction> = {}): QueuedAction => ({
  key: actionKey(over.articleId ?? 'a1', over.type ?? 'read', over.labelId),
  articleId: 'a1', type: 'read', value: true, at: 1, attempts: 0, ...over,
});

describe('actionKey', () => {
  it('separates the action types of one article', () => {
    expect(actionKey('a1', 'read')).not.toBe(actionKey('a1', 'star'));
  });
  it('separates two labels on the same article', () => {
    expect(actionKey('a1', 'label', 'l1')).not.toBe(actionKey('a1', 'label', 'l2'));
  });
});

describe('mergeAction', () => {
  it('adds an action to an empty queue', () => {
    expect(mergeAction([], act()).length).toBe(1);
  });

  it('collapses repeated toggles of the same article into the final state', () => {
    let q = mergeAction([], act({ value: true, at: 1 }));
    q = mergeAction(q, act({ value: false, at: 2 }));
    q = mergeAction(q, act({ value: true, at: 3 }));
    expect(q).toHaveLength(1);
    expect(q[0].value).toBe(true);
    expect(q[0].at).toBe(3);
  });

  it('resets the attempts when an action is superseded', () => {
    const q = mergeAction([act({ attempts: 2 })], act({ value: false, at: 5 }));
    expect(q[0].attempts).toBe(0);
  });

  it('keeps different action types side by side', () => {
    let q = mergeAction([], act({ type: 'read' }));
    q = mergeAction(q, act({ type: 'star', key: actionKey('a1', 'star') }));
    expect(q).toHaveLength(2);
  });

  it('keeps different articles side by side', () => {
    let q = mergeAction([], act({ articleId: 'a1' }));
    q = mergeAction(q, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    expect(q).toHaveLength(2);
  });

  it('preserves queue order, replacing in place', () => {
    let q = mergeAction([], act({ articleId: 'a1' }));
    q = mergeAction(q, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    q = mergeAction(q, act({ articleId: 'a1', value: false, at: 9 }));
    expect(q.map((a) => a.articleId)).toEqual(['a1', 'a2']);
    expect(q[0].value).toBe(false);
  });

  it('does not mutate the queue it is given', () => {
    const original = [act()];
    const copy = [...original];
    mergeAction(original, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    expect(original).toEqual(copy);
  });
});

describe('isNetworkFailure', () => {
  it('treats an axios error without a response as a network failure', () => {
    expect(isNetworkFailure({ message: 'Network Error', code: 'ERR_NETWORK' })).toBe(true);
  });
  it('treats a plain TypeError as a network failure', () => {
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
  });
  it('does NOT queue a server refusal', () => {
    expect(isNetworkFailure({ response: { status: 403 } })).toBe(false);
    expect(isNetworkFailure({ response: { status: 400 } })).toBe(false);
  });
  it('treats a server error as a network-ish failure worth retrying', () => {
    expect(isNetworkFailure({ response: { status: 502 } })).toBe(true);
  });
  it('handles null', () => {
    expect(isNetworkFailure(null)).toBe(true);
  });
});

describe('shouldRetry', () => {
  it('retries below the limit', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS - 1)).toBe(true);
  });
  it('gives up at the limit', () => {
    expect(shouldRetry(MAX_ATTEMPTS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

`npx vitest run src/lib/actionQueue.test.ts` → cannot find module.

- [ ] **Step 3: Implement `src/lib/actionQueue.ts`**

```ts
/** Article-level actions that survive being made offline. */
export type QueuedActionType = 'read' | 'star' | 'readLater' | 'label';

export interface QueuedAction {
  /** articleId + type (+ label), so repeats collapse onto one another. */
  key: string;
  articleId: string;
  type: QueuedActionType;
  /** Target state, e.g. read = true. */
  value: boolean;
  labelId?: string;
  at: number;
  attempts: number;
}

export const MAX_ATTEMPTS = 3;

export function actionKey(articleId: string, type: QueuedActionType, labelId?: string): string {
  return labelId ? `${articleId}|${type}|${labelId}` : `${articleId}|${type}`;
}

/**
 * Add an action, collapsing it onto any pending one for the same article and
 * type: only the final state matters. Without this a long offline session would
 * replay hundreds of calls that cancel each other out.
 */
export function mergeAction(queue: QueuedAction[], action: QueuedAction): QueuedAction[] {
  const i = queue.findIndex((a) => a.key === action.key);
  if (i === -1) return [...queue, action];
  const next = [...queue];
  // Superseded: the previous attempts counted against a state we no longer want.
  next[i] = { ...action, attempts: 0 };
  return next;
}

/**
 * Did this fail for lack of network (→ queue it) or because the server refused
 * it (→ roll back)? A 4xx is a real refusal and must never be replayed; a 5xx
 * is the server having a bad moment, worth retrying.
 */
export function isNetworkFailure(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status !== 'number') return true; // no response at all = no network
  return status >= 500;
}

export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/lib/actionQueue.test.ts` (18 tests).

- [ ] **Step 5: Gates, leak guard, commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add src/lib/actionQueue.ts src/lib/actionQueue.test.ts
git commit -m "feat(offline): pure helpers for the offline action queue"
```

---

### Task 2: Persist the queue

**Files:**
- Modify: `src/lib/offlineStore.ts`

**Interfaces:**
- Consumes: `QueuedAction` (Task 1).
- Produces: `queueGet(): Promise<QueuedAction[]>`, `queuePut(actions: QueuedAction[]): Promise<void>`.

- [ ] **Step 1: Bump the database version and add the store**

In `src/lib/offlineStore.ts`:

```ts
import type { QueuedAction } from './actionQueue';
```

Change `const VERSION = 1;` to `const VERSION = 2;` and add `const ACTIONS = 'actions';` next to `LISTS`/`SUBS`.

In `onupgradeneeded`, after the existing two blocks (the migration is additive — existing stores are untouched):

```ts
      if (!db.objectStoreNames.contains(ACTIONS)) {
        db.createObjectStore(ACTIONS, { keyPath: 'key' });
      }
```

- [ ] **Step 2: Add the accessors**

At the end of the file, following the style of `subsGet`/`subsPut`:

```ts
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
```

- [ ] **Step 2b: Verify the existing stores survive the migration**

Run the app once (Task 7 verification) and confirm the sidebar and article lists still render offline. A version bump re-runs `onupgradeneeded`; the guards mean nothing is dropped.

- [ ] **Step 3: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/lib/offlineStore.ts
git commit -m "feat(offline): persist the action queue in IndexedDB"
```

---

### Task 3: Queue instead of rolling back

**Files:**
- Modify: `src/stores/feedStore.ts`

**Interfaces:**
- Consumes: Task 1 + Task 2.
- Produces on the store: `pendingActions: number`, `failedActions: number`, `replayQueue(): Promise<void>`.

- [ ] **Step 1: Imports and state**

```ts
import { actionKey, mergeAction, isNetworkFailure, shouldRetry, type QueuedAction, type QueuedActionType } from '../lib/actionQueue';
import { queueGet, queuePut } from '../lib/offlineStore';
```

Add to the `FeedState` interface, next to `refreshResult`:

```ts
  /** Actions made offline, waiting for the network. */
  pendingActions: number;
  /** Actions given up on after repeated failures, since the last replay. */
  failedActions: number;
  replayQueue: () => Promise<void>;
```

and to the initial state: `pendingActions: 0, failedActions: 0,`.

- [ ] **Step 2: One helper, used by all four actions**

Add near the other module-level helpers:

```ts
// The queue lives in IndexedDB; this mirror avoids a read on every toggle.
let actionQueue: QueuedAction[] = [];
let queueLoaded = false;

async function loadQueue(): Promise<QueuedAction[]> {
  if (!queueLoaded) { actionQueue = await queueGet(); queueLoaded = true; }
  return actionQueue;
}

/**
 * Remember an action that failed for lack of network, so it can be replayed.
 * Business refusals never come here — see isNetworkFailure.
 */
async function enqueueAction(
  set: (partial: Partial<FeedState>) => void,
  articleId: string,
  type: QueuedActionType,
  value: boolean,
  labelId?: string,
): Promise<void> {
  await loadQueue();
  actionQueue = mergeAction(actionQueue, {
    key: actionKey(articleId, type, labelId),
    articleId, type, value, labelId, at: Date.now(), attempts: 0,
  });
  await queuePut(actionQueue);
  set({ pendingActions: actionQueue.length });
}
```

- [ ] **Step 3: Rewrite the four catch blocks**

For **`toggleRead`**, replace the whole `catch { … }` (the block introduced by `// Rollback on failure`) with:

```ts
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, article.id, 'read', newRead);
        return;
      }
      set((state) => ({
        articles: state.articles.map((a) =>
          a.id === article.id ? { ...a, read: !newRead } : a
        ),
        selectedArticle:
          state.selectedArticle?.id === article.id
            ? { ...state.selectedArticle, read: !newRead }
            : state.selectedArticle,
        unreadCounts: updateCount(state.unreadCounts, article, newRead ? 1 : -1),
      }));
      memMarkRead(article.id, !newRead);
      persistCurrentView(get);
```

Apply the same shape to **`toggleStar`** (`'star'`, the new starred value), **`toggleReadLater`** (`'readLater'`) and **`toggleArticleLabel`** (`'label'`, passing the label id): guard the existing rollback with `if (isNetworkFailure(err)) { await enqueueAction(…); return; }`, leaving the rollback untouched below it.

> Read each of those three catch blocks before editing — their rollback bodies
> differ, and only the guard is being added.

- [ ] **Step 4: The replay**

```ts
  replayQueue: async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const queue = await loadQueue();
    if (!queue.length) return;

    const remaining: QueuedAction[] = [];
    let failed = 0;
    for (const action of queue) {
      try {
        if (action.type === 'read') {
          await (action.value ? markAsRead(action.articleId) : markAsUnread(action.articleId));
        } else if (action.type === 'star') {
          await (action.value ? markAsStarred(action.articleId) : removeStarred(action.articleId));
        } else if (action.type === 'readLater') {
          await setArticleLabel(action.articleId, READ_LATER_LABEL, action.value);
        } else if (action.type === 'label' && action.labelId) {
          await setArticleLabel(action.articleId, action.labelId, action.value);
        }
      } catch (err) {
        const attempts = action.attempts + 1;
        // A refusal will never succeed; only keep what is worth retrying.
        if (isNetworkFailure(err) && shouldRetry(attempts)) remaining.push({ ...action, attempts });
        else failed++;
      }
    }

    actionQueue = remaining;
    await queuePut(remaining);
    set({ pendingActions: remaining.length, failedActions: failed });
  },
```

> `setArticleLabel(itemIds, labelId, add = true)` takes a single id or an array,
> so the two calls above are correct as written. The other four API functions are
> already imported by `feedStore`.

- [ ] **Step 5: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/stores/feedStore.ts
git commit -m "feat(offline): queue article actions instead of rolling them back"
```

---

### Task 4: Trigger the replay

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replay on startup and whenever the network returns**

Add an effect alongside the existing ones:

```tsx
  // Replay what was done offline: on startup (a session may have been closed
  // with actions pending) and whenever the network comes back.
  useEffect(() => {
    const replay = () => { useFeedStore.getState().replayQueue(); };
    replay();
    window.addEventListener('online', replay);
    return () => window.removeEventListener('online', replay);
  }, []);
```

- [ ] **Step 2: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/App.tsx
git commit -m "feat(offline): replay queued actions on startup and reconnection"
```

---

### Task 5: Report it in the offline banner

**Files:**
- Modify: `src/components/OfflineBanner.tsx`

- [ ] **Step 1: Read the counts and extend the messages**

Add to the component:

```tsx
  const pending = useFeedStore((s) => s.pendingActions);
  const failed = useFeedStore((s) => s.failedActions);
```

(with `import { useFeedStore } from '../stores/feedStore';`)

Replace the final message expression:

```tsx
      {online ? t('connection.backOnline') : t('connection.offline')}
```

with:

```tsx
      {online
        ? (failed
            ? t('connection.syncFailed', { count: failed })
            : t('connection.backOnline'))
        : (pending
            ? `${t('connection.offline')} — ${t('connection.pending', { count: pending })}`
            : t('connection.offline'))}
```

and widen the early return so the banner also shows when there is something to report:

```tsx
  if (online && !showBackOnline && !failed) return null;
```

- [ ] **Step 2: Add the strings to all 9 locales**

```bash
node -e '
const fs=require("fs");
const pending_one={fr:"1 action en attente",en:"1 action pending",de:"1 Aktion ausstehend",es:"1 acción pendiente",it:"1 azione in attesa",nl:"1 actie in wachtrij",pl:"1 akcja oczekuje",pt:"1 ação pendente",uk:"1 дія очікує"};
const pending_other={fr:"{{count}} actions en attente",en:"{{count}} actions pending",de:"{{count}} Aktionen ausstehend",es:"{{count}} acciones pendientes",it:"{{count}} azioni in attesa",nl:"{{count}} acties in wachtrij",pl:"{{count}} akcji oczekuje",pt:"{{count}} ações pendentes",uk:"{{count}} дій очікує"};
const failed_one={fr:"1 action n’a pas pu être synchronisée",en:"1 action could not be synced",de:"1 Aktion konnte nicht synchronisiert werden",es:"No se pudo sincronizar 1 acción",it:"1 azione non è stata sincronizzata",nl:"1 actie kon niet worden gesynchroniseerd",pl:"Nie udało się zsynchronizować 1 akcji",pt:"Não foi possível sincronizar 1 ação",uk:"Не вдалося синхронізувати 1 дію"};
const failed_other={fr:"{{count}} actions n’ont pas pu être synchronisées",en:"{{count}} actions could not be synced",de:"{{count}} Aktionen konnten nicht synchronisiert werden",es:"No se pudieron sincronizar {{count}} acciones",it:"{{count}} azioni non sono state sincronizzate",nl:"{{count}} acties konden niet worden gesynchroniseerd",pl:"Nie udało się zsynchronizować {{count}} akcji",pt:"Não foi possível sincronizar {{count}} ações",uk:"Не вдалося синхронізувати {{count}} дій"};
for(const lng of ["fr","en","de","es","it","nl","pl","pt","uk"]){
  const p=`src/locales/${lng}.json`;
  const o=JSON.parse(fs.readFileSync(p,"utf8"));
  o.connection.pending_one=pending_one[lng];
  o.connection.pending_other=pending_other[lng];
  o.connection.syncFailed_one=failed_one[lng];
  o.connection.syncFailed_other=failed_other[lng];
  if(lng==="pl"||lng==="uk"){ o.connection.pending_few=pending_other[lng]; o.connection.pending_many=pending_other[lng]; o.connection.syncFailed_few=failed_other[lng]; o.connection.syncFailed_many=failed_other[lng]; }
  fs.writeFileSync(p, JSON.stringify(o,null,2)+"\n");
}
console.log("locales updated");
'
```

- [ ] **Step 3: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/components/OfflineBanner.tsx src/locales
git commit -m "feat(offline): report pending and failed actions in the banner"
```

---

### Task 6: i18n parity audit

**Files:** none (verification).

- [ ] **Step 1: Run the audit**

```bash
node -e '
const fs=require("fs");
const langs=["fr","en","de","es","it","nl","pl","pt","uk"];
const flat=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?flat(v,p+k+"."):[p+k]);
const keys={}; for(const l of langs) keys[l]=new Set(flat(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8"))));
let bad=0;
for(const l of langs){ if(l==="fr")continue; const m=[...keys.fr].filter(k=>!keys[l].has(k)&&!/_(few|many)$/.test(k)); if(m.length){bad++;console.log(l,m)} }
console.log(bad? "PARITY BROKEN" : "parity ok");
'
```

Expected: `parity ok`. Any missing key must be translated, never left to fall back.

---

### Task 7: Verify and deploy

- [ ] **Step 1: Full gates** — `npm run typecheck && npm run lint && npx vitest run && npm run build`

- [ ] **Step 2: Browser verification**

With the preview running, exercise the pure logic through the real modules (merge collapsing, a 403 classified as non-network, a network error classified as queueable), and confirm `read_console_messages` shows no new errors. The IndexedDB migration is verified by the app still loading.

- [ ] **Step 3: Leak guard, then push** — run the grep, read it, then `git push origin dev`.

- [ ] **Step 4: Watch BOTH workflows** — `CI` and `Publish image` to success.

- [ ] **Step 5: Deploy the dev instance** — recreate the container from the fresh image, reusing its exact env and all compose labels (specifics live outside this repo). Allow ~12 s before the health check.

- [ ] **Step 6: Hand off**

Tell the user how to test: go offline, read several articles / star / read-later, watch the banner count rise, come back online, and confirm the states stuck (reload to check they came from the server, not just local state).

---

## Notes for the implementer

- **The distinction is the whole feature**: only a failure without a server response (or a 5xx) goes to the queue. A 4xx is a refusal — rolling back is correct.
- **Merging is what keeps the queue small**: toggling one article ten times must leave one entry.
- The replay is deliberately **not** made to "repair" local state on give-up: the next load from the server realigns it without an article visibly jumping under the user.
