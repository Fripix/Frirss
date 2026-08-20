# Relève réelle des flux — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire que le bouton « Rafraîchir » déclenche une vraie relève des flux côté FreshRSS, puis mette à jour l'affichage au fil de l'eau.

**Architecture:** Le backend FriRSS appelle l'action `c=feed&a=actualize` de FreshRSS **en POST** (jeton dans le corps, jamais dans l'URL), sans attendre la fin, et suit l'état dans un registre en mémoire. Le front sonde cet état toutes les 3 s en réutilisant `syncCounts()`, puis fait un chargement final. Sans jeton configuré, tout le chemin actuel est conservé à l'identique.

**Tech Stack:** TypeScript strict, Express + better-sqlite3 (serveur, NodeNext → imports `.js` explicites), React 18 + Zustand (front), vitest.

**Spec de référence :** `docs/superpowers/specs/2026-08-20-real-feed-refresh-design.md`

## Global Constraints

- Gates avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`
- Garde-fou fuite d'infra avant **chaque** commit, docs comprises, et **lire la sortie** (vide = propre) :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- Messages de commit neutres, style conventionnel. **Jamais** de trailer `Co-Authored-By` ni de mention d'assistant.
- Dans les tests, valeurs fictives uniquement (`https://example.com`, `10.0.0.1`).
- Toute chaîne UI va dans **les 9 locales** : `fr, en, de, es, it, nl, pl, pt, uk`. `fallbackLng: fr`.
- Le jeton maître ne doit apparaître : ni dans une URL, ni dans une réponse d'API, ni dans un message d'erreur, ni dans un journal.
- Travailler sur la branche `dev`.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `server/actualizeRequest.ts` *(créer)* | Pur : construit l'URL + le corps POST de la relève. Aucune E/S. |
| `server/actualizeRequest.test.ts` *(créer)* | Tests, dont les invariants de sécurité. |
| `server/refreshJobs.ts` *(créer)* | Registre en mémoire des relèves en cours, dédoublonnage, timeout, rédaction des erreurs. |
| `server/refreshJobs.test.ts` *(créer)* | Tests du registre. |
| `server/db.ts` *(modifier)* | Migration additive : colonne `servers.refresh_token`. |
| `server/routes/servers.ts` *(modifier)* | Expose `has_refresh_token`, accepte `refreshToken`, ajoute `POST`/`GET /:id/actualize`. |
| `src/lib/refreshPolling.ts` *(créer)* | Pur : machine d'état du sondage côté client. |
| `src/lib/refreshPolling.test.ts` *(créer)* | Tests de la machine d'état. |
| `src/api/backend.ts` *(modifier)* | `startActualize()`, `getActualizeStatus()`. |
| `src/types/index.ts` *(modifier)* | `ServerConnection.has_refresh_token`. |
| `src/stores/feedStore.ts` *(modifier)* | `refresh()` en deux temps + `refreshPhase`. |
| `src/components/RefreshBanner.tsx` *(modifier)* | États « en cours », « échec », « inachevée », invitation. |
| `src/components/Preferences/RefreshTab.tsx` *(créer)* | Onglet « Relève » — fichier séparé, `Preferences.tsx` fait déjà 3010 lignes. |
| `src/components/Preferences/Preferences.tsx` *(modifier)* | Enregistre l'onglet. |
| `src/components/ServerSwitcher/AddServerDialog.tsx` *(modifier)* | Champ jeton optionnel à la première configuration. |
| `src/locales/*.json` *(modifier, 9 fichiers)* | Chaînes UI. |

---

### Task 1 : Colonne `refresh_token` et son exposition

**Files:**
- Modify: `server/db.ts` (après le bloc `columnExists('users', 'last_active_at')`, vers la ligne 83)
- Modify: `server/routes/servers.ts:24-32` (GET), `server/routes/servers.ts:88-100` (PUT)

**Interfaces:**
- Consumes: rien.
- Produces: colonne `servers.refresh_token` (chiffrée) ; champ `has_refresh_token: boolean` dans la réponse de `GET /api/servers` ; `PUT /api/servers/:id` accepte `refreshToken?: string`.

- [ ] **Step 1 : Ajouter la migration additive**

Dans `server/db.ts`, juste après le bloc `last_active_at` :

```ts
// Master authentication token of the FreshRSS user, used to trigger a real
// feed refresh (c=feed&a=actualize). Encrypted at rest like freshrss_token.
if (!columnExists('servers', 'refresh_token')) {
  db.exec(`ALTER TABLE servers ADD COLUMN refresh_token TEXT`);
}
```

- [ ] **Step 2 : Exposer la présence du jeton, jamais sa valeur**

Dans `server/routes/servers.ts`, ajouter `refresh_token` au `SELECT` du GET et l'écarter de la réponse :

```ts
const rows = db.prepare(`
  SELECT id, name, url, freshrss_user, freshrss_token, refresh_token, is_default, created_at
  FROM servers WHERE user_id = ? ORDER BY is_default DESC, created_at ASC
`).all(req.user.id) as ServerRow[];

// Neither token ever leaves the backend — expose only their presence.
const servers = rows.map(({ freshrss_token, refresh_token, ...s }) => ({
  ...s,
  has_token: !!freshrss_token,
  has_refresh_token: !!refresh_token,
}));
```

Ajouter le champ à `ServerRow` (vers la ligne 8) :

```ts
  refresh_token: string | null;
```

- [ ] **Step 3 : Accepter `refreshToken` en écriture**

Dans le `PUT /api/servers/:id`, ajouter `refreshToken` au destructuring du body puis à l'`UPDATE` :

```ts
const { name, url, freshrssUser, freshrssToken, refreshToken } = req.body;

db.prepare(`
  UPDATE servers SET name = ?, url = ?, freshrss_user = ?, freshrss_token = ?, refresh_token = ?
  WHERE id = ? AND user_id = ?
`).run(
  name ?? server.name,
  normalizedUrl,
  freshrssUser ?? server.freshrss_user,
  freshrssToken !== undefined ? encrypt(freshrssToken) : server.freshrss_token,
  refreshToken !== undefined ? encrypt(refreshToken) : server.refresh_token,
  id,
  req.user.id
);
```

> Chaîne vide = suppression du jeton : `encrypt('')` renvoie `''`, donc `has_refresh_token` repasse à `false`. C'est le comportement voulu (« vider le champ désactive »).

- [ ] **Step 4 : Vérifier**

```bash
npm run typecheck && npx vitest run
```
Attendu : PASS, aucune régression.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```
Lire la sortie : elle doit être vide.

```bash
git add server/db.ts server/routes/servers.ts
git commit -m "feat(servers): store the FreshRSS master token for feed refresh"
```

---

### Task 2 : Construction de la requête de relève (pur)

**Files:**
- Create: `server/actualizeRequest.ts`
- Test: `server/actualizeRequest.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `DEFAULT_MAX_FEEDS: 1000`
  - `refreshMaxFeeds(env?: NodeJS.ProcessEnv): number`
  - `buildActualizeRequest(opts: { serverUrl: string; freshrssUser: string; token: string; maxFeeds?: number }): { url: string; body: URLSearchParams }`

- [ ] **Step 1 : Écrire le test qui échoue**

`server/actualizeRequest.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildActualizeRequest, refreshMaxFeeds, DEFAULT_MAX_FEEDS } from './actualizeRequest.js';

const OPTS = { serverUrl: 'https://example.com', freshrssUser: 'alice', token: 's3cr3t-token' };

describe('buildActualizeRequest', () => {
  it('puts only the controller and action in the URL', () => {
    const { url } = buildActualizeRequest(OPTS);
    expect(url).toBe('https://example.com/i/?c=feed&a=actualize');
  });

  it('never leaks the token or the user into the URL', () => {
    const { url } = buildActualizeRequest(OPTS);
    expect(url).not.toContain('s3cr3t-token');
    expect(url).not.toContain('alice');
    expect(url).not.toContain('token');
  });

  it('carries credentials and options in the POST body', () => {
    const { body } = buildActualizeRequest(OPTS);
    expect(body.get('user')).toBe('alice');
    expect(body.get('token')).toBe('s3cr3t-token');
    expect(body.get('ajax')).toBe('1');
    expect(body.get('maxFeeds')).toBe(String(DEFAULT_MAX_FEEDS));
  });

  it('normalises a trailing slash on the server URL', () => {
    const { url } = buildActualizeRequest({ ...OPTS, serverUrl: 'https://example.com///' });
    expect(url).toBe('https://example.com/i/?c=feed&a=actualize');
  });

  it('honours an explicit maxFeeds', () => {
    const { body } = buildActualizeRequest({ ...OPTS, maxFeeds: 1 });
    expect(body.get('maxFeeds')).toBe('1');
  });
});

describe('refreshMaxFeeds', () => {
  it('defaults to 1000', () => {
    expect(refreshMaxFeeds({})).toBe(DEFAULT_MAX_FEEDS);
  });

  it('reads FRIRSS_REFRESH_MAX_FEEDS', () => {
    expect(refreshMaxFeeds({ FRIRSS_REFRESH_MAX_FEEDS: '25' })).toBe(25);
  });

  it('falls back on junk, zero and negative values', () => {
    for (const v of ['', 'abc', '0', '-3', '2.5']) {
      expect(refreshMaxFeeds({ FRIRSS_REFRESH_MAX_FEEDS: v }), v).toBe(DEFAULT_MAX_FEEDS);
    }
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

```bash
npx vitest run server/actualizeRequest.test.ts
```
Attendu : FAIL — `Cannot find module './actualizeRequest.js'`.

- [ ] **Step 3 : Implémenter**

`server/actualizeRequest.ts` :

```ts
// Builds the request that triggers a REAL feed refresh on FreshRSS.
//
// FreshRSS documents this as a GET with the token in the query string, which
// would write the secret into every access log it crosses. It does not have to
// be: FrontController merges $_POST into the request params, tokenIsOk() reads
// them without caring about the origin, and feedController has no CSRF check.
// So credentials travel in the body — only the controller and action stay in
// the URL. Never switch this back to GET.

export const DEFAULT_MAX_FEEDS = 1000;

/** Operator-tunable batch size (FRIRSS_REFRESH_MAX_FEEDS); junk falls back to the default. */
export function refreshMaxFeeds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FRIRSS_REFRESH_MAX_FEEDS;
  if (raw == null || raw === '') return DEFAULT_MAX_FEEDS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_FEEDS;
}

export interface ActualizeRequest {
  url: string;
  body: URLSearchParams;
}

export function buildActualizeRequest(opts: {
  serverUrl: string;
  freshrssUser: string;
  token: string;
  maxFeeds?: number;
}): ActualizeRequest {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    user: opts.freshrssUser,
    token: opts.token,
    maxFeeds: String(opts.maxFeeds ?? refreshMaxFeeds()),
    ajax: '1',
  });
  return { url: `${base}/i/?c=feed&a=actualize`, body };
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

```bash
npx vitest run server/actualizeRequest.test.ts
```
Attendu : PASS, 8 tests.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add server/actualizeRequest.ts server/actualizeRequest.test.ts
git commit -m "feat(refresh): build the FreshRSS actualize request with credentials in the body"
```

---

### Task 3 : Registre des relèves en cours

**Files:**
- Create: `server/refreshJobs.ts`
- Test: `server/refreshJobs.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type RefreshStatus = 'running' | 'done' | 'failed'`
  - `interface RefreshJob { status: RefreshStatus; startedAt: number; finishedAt?: number; error?: string }`
  - `REFRESH_TIMEOUT_MS: number`
  - `sanitizeError(err: unknown, secrets: string[]): string`
  - `getJob(userId: number, serverId: string | number): RefreshJob | undefined`
  - `startJob(userId: number, serverId: string | number, run: (signal: AbortSignal) => Promise<void>, secrets?: string[]): RefreshJob`
  - `__resetJobs(): void` (tests uniquement)

- [ ] **Step 1 : Écrire le test qui échoue**

`server/refreshJobs.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startJob, getJob, sanitizeError, __resetJobs } from './refreshJobs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { __resetJobs(); });

describe('sanitizeError', () => {
  it('redacts every secret it is given', () => {
    const msg = sanitizeError(new Error('failed for token=s3cr3t-token'), ['s3cr3t-token']);
    expect(msg).not.toContain('s3cr3t-token');
    expect(msg).toContain('«redacted»');
  });

  it('handles non-Error throws and ignores empty secrets', () => {
    expect(sanitizeError('boom', [''])).toBe('boom');
  });

  it('caps the length', () => {
    expect(sanitizeError(new Error('x'.repeat(500)), []).length).toBe(200);
  });
});

describe('startJob', () => {
  it('marks the job running, then done', async () => {
    startJob(1, 7, async () => {});
    expect(getJob(1, 7)?.status).toBe('running');
    await tick();
    expect(getJob(1, 7)?.status).toBe('done');
    expect(getJob(1, 7)?.finishedAt).toBeTypeOf('number');
  });

  it('records a failure with a redacted message', async () => {
    startJob(1, 7, async () => { throw new Error('upstream said token=s3cr3t-token'); }, ['s3cr3t-token']);
    await tick();
    const job = getJob(1, 7);
    expect(job?.status).toBe('failed');
    expect(job?.error).not.toContain('s3cr3t-token');
  });

  it('does not start a second job while one is running', async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); };
    const first = startJob(1, 7, slow);
    const second = startJob(1, 7, slow);
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('allows a new job once the previous one finished', async () => {
    let calls = 0;
    startJob(1, 7, async () => { calls++; });
    await tick();
    startJob(1, 7, async () => { calls++; });
    expect(calls).toBe(2);
  });

  it('keeps jobs of different users and servers apart', async () => {
    startJob(1, 7, async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getJob(2, 7)).toBeUndefined();
    expect(getJob(1, 8)).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

```bash
npx vitest run server/refreshJobs.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`server/refreshJobs.ts` :

```ts
// In-memory registry of in-flight feed refreshes, keyed by user + server.
// Deliberately not persisted: a job that outlived a restart would be
// meaningless — the HTTP request it tracks died with the process.

export type RefreshStatus = 'running' | 'done' | 'failed';

export interface RefreshJob {
  status: RefreshStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** Outgoing request budget. The client polling cap is aligned on this. */
export const REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

const jobs = new Map<string, RefreshJob>();

const keyOf = (userId: number, serverId: string | number) => `${userId}:${serverId}`;

/** Error message with every known secret removed, capped for storage. */
export function sanitizeError(err: unknown, secrets: string[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) {
    if (s) msg = msg.split(s).join('«redacted»');
  }
  return msg.slice(0, 200);
}

export function getJob(userId: number, serverId: string | number): RefreshJob | undefined {
  return jobs.get(keyOf(userId, serverId));
}

/**
 * Start a refresh unless one is already running for this (user, server).
 * `run` is fired and NOT awaited — the caller answers immediately.
 */
export function startJob(
  userId: number,
  serverId: string | number,
  run: (signal: AbortSignal) => Promise<void>,
  secrets: string[] = [],
): RefreshJob {
  const key = keyOf(userId, serverId);
  const existing = jobs.get(key);
  if (existing?.status === 'running') return existing;

  const job: RefreshJob = { status: 'running', startedAt: Date.now() };
  jobs.set(key, job);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REFRESH_TIMEOUT_MS);
  timer.unref?.();

  run(ac.signal).then(
    () => { job.status = 'done'; },
    (err) => { job.status = 'failed'; job.error = sanitizeError(err, secrets); },
  ).finally(() => {
    clearTimeout(timer);
    job.finishedAt = Date.now();
  });

  return job;
}

/** Test-only: clear the registry between cases. */
export function __resetJobs(): void {
  jobs.clear();
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

```bash
npx vitest run server/refreshJobs.test.ts
```
Attendu : PASS, 9 tests.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add server/refreshJobs.ts server/refreshJobs.test.ts
git commit -m "feat(refresh): track in-flight feed refreshes in memory"
```

---

### Task 4 : Les routes `actualize`

**Files:**
- Modify: `server/routes/servers.ts` (ajouter avant `export default router;`)

**Interfaces:**
- Consumes: `buildActualizeRequest`, `refreshMaxFeeds` (Task 2) ; `startJob`, `getJob`, `RefreshJob` (Task 3) ; `decrypt` de `../crypto.js`.
- Produces:
  - `POST /api/servers/:id/actualize` → `202 { job: RefreshJob }` | `409 { error: 'no_refresh_token' }` | `404`
  - `GET /api/servers/:id/actualize` → `200 { job: RefreshJob | null }`
  - Body optionnel du POST : `{ maxFeeds?: number }` (utilisé par le bouton « Tester »).

- [ ] **Step 1 : Compléter les imports**

En tête de `server/routes/servers.ts` :

```ts
import { encrypt, decrypt } from '../crypto.js';
import { buildActualizeRequest } from '../actualizeRequest.js';
import { startJob, getJob } from '../refreshJobs.js';
```

- [ ] **Step 2 : Ajouter les deux routes**

Avant `export default router;` :

```ts
// ── POST /api/servers/:id/actualize ─────────────────────────────────
// Triggers a REAL feed refresh on FreshRSS and returns immediately. The
// request is fired but not awaited: refreshing hundreds of feeds takes
// minutes, and any proxy in between would time out the client long before
// FreshRSS is done — while FreshRSS keeps working regardless.
router.post('/:id/actualize', (req, res) => {
  const { id } = req.params;
  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND user_id = ?')
    .get(id, req.user.id) as ServerRow | undefined;
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const token = decrypt(server.refresh_token);
  if (!token) return res.status(409).json({ error: 'no_refresh_token' });

  const maxFeeds = Number.isInteger(req.body?.maxFeeds) && req.body.maxFeeds >= 1
    ? req.body.maxFeeds as number
    : undefined;

  const { url, body } = buildActualizeRequest({
    serverUrl: server.url,
    freshrssUser: server.freshrss_user,
    token,
    maxFeeds,
  });

  const job = startJob(req.user.id, server.id, async (signal) => {
    const r = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',   // a redirect would replay this as a GET, exposing the body
      signal,
    });
    if (!r.ok) throw new Error(`FreshRSS answered ${r.status}`);
  }, [token]);

  res.status(202).json({ job });
});

// ── GET /api/servers/:id/actualize ──────────────────────────────────
router.get('/:id/actualize', (req, res) => {
  const { id } = req.params;
  const server = db.prepare('SELECT id FROM servers WHERE id = ? AND user_id = ?')
    .get(id, req.user.id) as { id: number } | undefined;
  if (!server) return res.status(404).json({ error: 'Server not found' });

  res.json({ job: getJob(req.user.id, server.id) ?? null });
});
```

> `redirect: 'manual'` est un invariant de sécurité, pas une préférence : suivre une redirection rejouerait la requête en GET et remettrait le jeton dans une URL.

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Attendu : PASS.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add server/routes/servers.ts
git commit -m "feat(servers): add the actualize endpoints"
```

---

### Task 5 : Machine d'état du sondage (pur, front)

**Files:**
- Create: `src/lib/refreshPolling.ts`
- Test: `src/lib/refreshPolling.test.ts`

**Interfaces:**
- Consumes: rien (le type `RefreshStatus` est redéclaré côté front — le front ne peut pas importer du serveur).
- Produces:
  - `type RefreshPhase = 'idle' | 'running' | 'done' | 'failed' | 'timeout'`
  - `POLL_INTERVAL_MS: 3000`, `POLL_CAP_MS: 600000`
  - `nextPhase(job: 'running' | 'done' | 'failed' | undefined, startedAt: number, now: number): RefreshPhase`
  - `shouldTriggerRealRefresh(hasRefreshToken: boolean, activeServerId: string | number | null | undefined): boolean`

- [ ] **Step 1 : Écrire le test qui échoue**

`src/lib/refreshPolling.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { nextPhase, shouldTriggerRealRefresh, POLL_CAP_MS } from './refreshPolling';

const T0 = 1_000_000;

describe('nextPhase', () => {
  it('stays running while the job runs', () => {
    expect(nextPhase('running', T0, T0 + 5_000)).toBe('running');
  });

  it('keeps polling when the job is not visible yet', () => {
    expect(nextPhase(undefined, T0, T0 + 1_000)).toBe('running');
  });

  it('reports the terminal states of the job', () => {
    expect(nextPhase('done', T0, T0 + 1_000)).toBe('done');
    expect(nextPhase('failed', T0, T0 + 1_000)).toBe('failed');
  });

  it('gives up as "timeout" past the cap, never as "done"', () => {
    expect(nextPhase('running', T0, T0 + POLL_CAP_MS)).toBe('timeout');
    expect(nextPhase(undefined, T0, T0 + POLL_CAP_MS + 1)).toBe('timeout');
  });

  it('lets a job that finished on the cap boundary report its real result', () => {
    expect(nextPhase('done', T0, T0 + POLL_CAP_MS + 1)).toBe('done');
  });
});

describe('shouldTriggerRealRefresh', () => {
  it('needs both a token and an active server', () => {
    expect(shouldTriggerRealRefresh(true, 3)).toBe(true);
    expect(shouldTriggerRealRefresh(true, '3')).toBe(true);
  });

  it('refuses without a token', () => {
    expect(shouldTriggerRealRefresh(false, 3)).toBe(false);
  });

  it('refuses without an active server', () => {
    expect(shouldTriggerRealRefresh(true, null)).toBe(false);
    expect(shouldTriggerRealRefresh(true, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue**

```bash
npx vitest run src/lib/refreshPolling.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

`src/lib/refreshPolling.ts` :

```ts
// State machine for the client side of a real feed refresh.
// Pure on purpose: the polling loop lives in the store, the decisions live here.

export type RefreshPhase = 'idle' | 'running' | 'done' | 'failed' | 'timeout';

export const POLL_INTERVAL_MS = 3_000;

/** Aligned on the backend's outgoing timeout: never give up before the job resolves. */
export const POLL_CAP_MS = 10 * 60 * 1000;

/**
 * Next phase from the job status reported by the backend.
 *
 * Past the cap we return 'timeout', never 'done': claiming a refresh finished
 * when we simply stopped watching is exactly the dishonesty this feature exists
 * to remove.
 */
export function nextPhase(
  job: 'running' | 'done' | 'failed' | undefined,
  startedAt: number,
  now: number,
): RefreshPhase {
  if (job === 'done') return 'done';
  if (job === 'failed') return 'failed';
  if (now - startedAt >= POLL_CAP_MS) return 'timeout';
  return 'running';
}

/**
 * Whether a refresh should go the real (server-side) route rather than the
 * read-only sync. Extracted so the branching is testable without mocking the
 * whole API layer.
 */
export function shouldTriggerRealRefresh(
  hasRefreshToken: boolean,
  activeServerId: string | number | null | undefined,
): boolean {
  return hasRefreshToken && activeServerId != null;
}
```

- [ ] **Step 4 : Lancer le test et vérifier qu'il passe**

```bash
npx vitest run src/lib/refreshPolling.test.ts
```
Attendu : PASS, 8 tests.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/lib/refreshPolling.ts src/lib/refreshPolling.test.ts
git commit -m "feat(refresh): add the client-side polling state machine"
```

---

### Task 6 : Client API et types

**Files:**
- Modify: `src/types/index.ts:107-114`
- Modify: `src/api/backend.ts` (section « Servers », après `setDefaultServer`)

**Interfaces:**
- Consumes: routes de la Task 4.
- Produces:
  - `ServerConnection.has_refresh_token?: boolean`
  - `interface ActualizeJob { status: 'running' | 'done' | 'failed'; startedAt: number; finishedAt?: number; error?: string }`
  - `startActualize(id: number, maxFeeds?: number): Promise<ActualizeJob | null>` — `null` si le serveur n'a pas de jeton (409)
  - `getActualizeStatus(id: number): Promise<ActualizeJob | null>`

- [ ] **Step 1 : Étendre le type**

Dans `src/types/index.ts`, ajouter à `ServerConnection` :

```ts
  has_refresh_token?: boolean;
```

- [ ] **Step 2 : Ajouter les appels**

Dans `src/api/backend.ts`, après `setDefaultServer` :

```ts
export interface ActualizeJob {
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** Trigger a real feed refresh. Returns null when no master token is configured. */
export async function startActualize(id: number, maxFeeds?: number): Promise<ActualizeJob | null> {
  try {
    const { data } = await backend.post<{ job: ActualizeJob }>(
      `/servers/${id}/actualize`,
      maxFeeds === undefined ? {} : { maxFeeds },
    );
    return data.job;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 409) return null;
    throw err;
  }
}

export async function getActualizeStatus(id: number): Promise<ActualizeJob | null> {
  const { data } = await backend.get<{ job: ActualizeJob | null }>(`/servers/${id}/actualize`);
  return data.job;
}
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint
```
Attendu : PASS.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/types/index.ts src/api/backend.ts
git commit -m "feat(api): expose the actualize endpoints to the client"
```

---

### Task 7 : `refresh()` en deux temps

**Files:**
- Modify: `src/stores/feedStore.ts` — interface vers la ligne 314-321, implémentation `refresh` vers la ligne 1263
- Test: `src/stores/feedStore.test.ts` (fichier existant, ajouter un `describe`)

**Interfaces:**
- Consumes: `nextPhase`, `POLL_INTERVAL_MS` (Task 5) ; `startActualize`, `getActualizeStatus` (Task 6) ; `useAuthStore.getState().activeServerId`.
- Produces: `FeedState.refreshPhase: RefreshPhase` — lu par `RefreshBanner` (Task 8).

> **La non-régression est couverte par `shouldTriggerRealRefresh` (Task 5)**, testé
> à part. Ne pas tenter de la retester ici en simulant `src/api/backend` :
> `refresh()` appelle `loadSubscriptions()` et `loadArticles()`, dont la
> simulation ferait de ce test un test du harnais, pas du comportement. Le store
> se contente d'appeler le prédicat.

- [ ] **Step 1 : Ajouter l'état au store**

Dans l'interface `FeedState`, à côté de `refreshResult` :

```ts
  /** Phase of a real (server-side) feed refresh; 'idle' when none is running. */
  refreshPhase: RefreshPhase;
  /** Whether the active server has a master token configured. */
  hasRefreshToken: boolean;
  setHasRefreshToken: (v: boolean) => void;
```

Dans l'état initial, à côté de `refreshResult: null` :

```ts
  refreshPhase: 'idle',
  hasRefreshToken: false,
```

Et l'import en tête de fichier :

```ts
import { nextPhase, shouldTriggerRealRefresh, POLL_INTERVAL_MS, type RefreshPhase } from '../lib/refreshPolling';
import { startActualize, getActualizeStatus } from '../api/backend';
```

- [ ] **Step 2 : Réécrire `refresh()`**

Remplacer l'implémentation actuelle de `refresh` (vers la ligne 1263) par :

```ts
  setHasRefreshToken: (v: boolean) => set({ hasRefreshToken: v }),

  refresh: async () => {
    // Snapshot per-feed unread counts before the reload, so we can report how
    // many new articles arrived and in which feeds (see RefreshBanner + pulse).
    const before = { ...get().unreadCounts };

    const serverId = useAuthStore.getState().activeServerId;
    const wantsReal = shouldTriggerRealRefresh(get().hasRefreshToken, serverId);

    if (!wantsReal) {
      // Read-only sync: exactly the pre-existing behaviour.
      await get().loadSubscriptions();
      await get().loadArticles();
      const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
      set({ refreshResult: { totalNew, newByFeed, at: Date.now() } });
      return;
    }

    const job = await startActualize(Number(serverId)).catch(() => null);
    if (!job) {
      // No token after all (409) or the call failed — fall back to a plain sync
      // rather than leaving the user with nothing.
      set({ hasRefreshToken: false });
      await get().loadSubscriptions();
      await get().loadArticles();
      const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
      set({ refreshResult: { totalNew, newByFeed, at: Date.now() } });
      return;
    }

    const startedAt = Date.now();
    set({ refreshPhase: 'running' });

    let phase: RefreshPhase = 'running';
    while (phase === 'running') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      // Counters first: this is what makes articles appear as they arrive.
      await get().syncCounts();
      const status = await getActualizeStatus(Number(serverId)).catch(() => null);
      phase = nextPhase(status?.status, startedAt, Date.now());
      set({
        refreshPhase: phase,
        refreshResult: {
          ...computeRefreshDelta(before, get().unreadCounts),
          at: Date.now(),
        },
      });
    }

    // Final load once the job resolved, so the visible list matches the counters.
    await get().loadSubscriptions();
    await get().loadArticles();
    const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
    set({ refreshResult: { totalNew, newByFeed, at: Date.now() }, refreshPhase: phase });
  },
```

- [ ] **Step 3 : Renseigner `hasRefreshToken` au chargement des serveurs**

Dans `src/components/ServerSwitcher/ServerSwitcher.tsx`, là où `getServers()` est déjà appelé, propager la valeur pour le serveur actif :

```ts
const active = servers.find((s) => String(s.id) === String(useAuthStore.getState().activeServerId));
useFeedStore.getState().setHasRefreshToken(!!active?.has_refresh_token);
```

- [ ] **Step 4 : Lancer les tests**

```bash
npm run typecheck && npx vitest run
```
Attendu : PASS, aucune régression.

- [ ] **Step 5 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/stores/feedStore.ts src/components/ServerSwitcher/ServerSwitcher.tsx
git commit -m "feat(refresh): trigger a real refresh and poll it from the store"
```

---

### Task 8 : Les chaînes, dans les 9 locales

**Files:**
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`

**Interfaces:**
- Produces les clés : `refresh.inProgress`, `refresh.failed`, `refresh.incomplete`, `refresh.enable`, `preferences.tabs.refresh`, `preferences.refresh.tokenLabel`, `preferences.refresh.tokenHelp`, `preferences.refresh.scopeWarning`, `preferences.refresh.test`, `preferences.refresh.testOk`, `preferences.refresh.testFail`, `preferences.refresh.save`.

> Pas de clé au pluriel : le décompte réutilise `refresh.newArticles`, qui existe déjà avec ses formes `_one`/`_other` (+ `_few`/`_many` pour `pl` et `uk`). C'est délibéré — cela évite d'ajouter 4 formes par langue.

- [ ] **Step 1 : Écrire le script d'insertion**

Créer `/tmp/add-refresh-i18n.mjs` (fichier jetable, hors dépôt) :

```js
import fs from 'fs';

const S = {
  fr: { inProgress: 'Relève en cours…', failed: 'La relève a échoué', incomplete: 'Relève inachevée', enable: 'Activer la relève des flux', tab: 'Relève', tokenLabel: 'Jeton d’identification maître', tokenHelp: 'À créer dans FreshRSS, page Profil, champ « Jeton d’identification maître ». Laisser vide pour désactiver.', scopeWarning: 'Ce jeton permet aussi de lire tous vos articles et d’exporter votre liste d’abonnements sans mot de passe. Il est stocké chiffré et ne quitte jamais le serveur.', test: 'Tester', testOk: 'Le jeton fonctionne.', testFail: 'Le jeton a été refusé.', save: 'Enregistrer' },
  en: { inProgress: 'Refreshing feeds…', failed: 'The refresh failed', incomplete: 'Refresh unfinished', enable: 'Enable feed refreshing', tab: 'Refresh', tokenLabel: 'Master authentication token', tokenHelp: 'Create it in FreshRSS, Profile page, “Master authentication token” field. Leave empty to disable.', scopeWarning: 'This token also grants password-free access to all your articles and to your subscription list. It is stored encrypted and never leaves the server.', test: 'Test', testOk: 'The token works.', testFail: 'The token was rejected.', save: 'Save' },
  de: { inProgress: 'Feeds werden abgerufen…', failed: 'Abruf fehlgeschlagen', incomplete: 'Abruf unvollständig', enable: 'Feed-Abruf aktivieren', tab: 'Abruf', tokenLabel: 'Master-Authentifizierungs-Token', tokenHelp: 'In FreshRSS unter Profil im Feld „Master-Authentifizierungs-Token“ anlegen. Leer lassen zum Deaktivieren.', scopeWarning: 'Dieses Token erlaubt außerdem den passwortfreien Zugriff auf alle Ihre Artikel und Ihre Abonnementliste. Es wird verschlüsselt gespeichert und verlässt den Server nie.', test: 'Testen', testOk: 'Das Token funktioniert.', testFail: 'Das Token wurde abgelehnt.', save: 'Speichern' },
  es: { inProgress: 'Actualizando fuentes…', failed: 'La actualización falló', incomplete: 'Actualización incompleta', enable: 'Activar la actualización de fuentes', tab: 'Actualización', tokenLabel: 'Token de autenticación maestro', tokenHelp: 'Créalo en FreshRSS, página Perfil, campo «Token de autenticación maestro». Déjalo vacío para desactivarlo.', scopeWarning: 'Este token también permite leer todos tus artículos y exportar tu lista de suscripciones sin contraseña. Se guarda cifrado y nunca sale del servidor.', test: 'Probar', testOk: 'El token funciona.', testFail: 'El token fue rechazado.', save: 'Guardar' },
  it: { inProgress: 'Aggiornamento dei feed…', failed: 'Aggiornamento non riuscito', incomplete: 'Aggiornamento incompleto', enable: 'Attiva l’aggiornamento dei feed', tab: 'Aggiornamento', tokenLabel: 'Token di autenticazione principale', tokenHelp: 'Crealo in FreshRSS, pagina Profilo, campo «Token di autenticazione principale». Lascia vuoto per disattivarlo.', scopeWarning: 'Questo token consente anche di leggere tutti i tuoi articoli e di esportare l’elenco delle sottoscrizioni senza password. È memorizzato cifrato e non lascia mai il server.', test: 'Prova', testOk: 'Il token funziona.', testFail: 'Il token è stato rifiutato.', save: 'Salva' },
  nl: { inProgress: 'Feeds worden opgehaald…', failed: 'Het ophalen is mislukt', incomplete: 'Ophalen onvoltooid', enable: 'Feeds ophalen inschakelen', tab: 'Ophalen', tokenLabel: 'Hoofdauthenticatietoken', tokenHelp: 'Maak het aan in FreshRSS, pagina Profiel, veld “Hoofdauthenticatietoken”. Laat leeg om uit te schakelen.', scopeWarning: 'Dit token geeft ook zonder wachtwoord toegang tot al je artikelen en je abonnementenlijst. Het wordt versleuteld opgeslagen en verlaat de server nooit.', test: 'Testen', testOk: 'Het token werkt.', testFail: 'Het token is geweigerd.', save: 'Opslaan' },
  pl: { inProgress: 'Odświeżanie kanałów…', failed: 'Odświeżanie nie powiodło się', incomplete: 'Odświeżanie niedokończone', enable: 'Włącz odświeżanie kanałów', tab: 'Odświeżanie', tokenLabel: 'Główny token uwierzytelniający', tokenHelp: 'Utwórz go w FreshRSS, na stronie Profil, w polu „Główny token uwierzytelniający”. Puste pole wyłącza funkcję.', scopeWarning: 'Ten token daje też dostęp bez hasła do wszystkich Twoich artykułów i listy subskrypcji. Jest przechowywany w postaci zaszyfrowanej i nigdy nie opuszcza serwera.', test: 'Testuj', testOk: 'Token działa.', testFail: 'Token został odrzucony.', save: 'Zapisz' },
  pt: { inProgress: 'A atualizar as fontes…', failed: 'A atualização falhou', incomplete: 'Atualização incompleta', enable: 'Ativar a atualização das fontes', tab: 'Atualização', tokenLabel: 'Token de autenticação principal', tokenHelp: 'Crie-o no FreshRSS, página Perfil, campo «Token de autenticação principal». Deixe vazio para desativar.', scopeWarning: 'Este token também permite ler todos os seus artigos e exportar a sua lista de subscrições sem palavra-passe. É guardado cifrado e nunca sai do servidor.', test: 'Testar', testOk: 'O token funciona.', testFail: 'O token foi recusado.', save: 'Guardar' },
  uk: { inProgress: 'Оновлення стрічок…', failed: 'Не вдалося оновити', incomplete: 'Оновлення незавершене', enable: 'Увімкнути оновлення стрічок', tab: 'Оновлення', tokenLabel: 'Головний токен автентифікації', tokenHelp: 'Створіть його у FreshRSS, сторінка «Профіль», поле «Головний токен автентифікації». Порожнє поле вимикає функцію.', scopeWarning: 'Цей токен також дає доступ без пароля до всіх ваших статей і списку підписок. Він зберігається зашифрованим і ніколи не залишає сервер.', test: 'Перевірити', testOk: 'Токен працює.', testFail: 'Токен відхилено.', save: 'Зберегти' },
};

for (const [loc, s] of Object.entries(S)) {
  const path = `src/locales/${loc}.json`;
  const j = JSON.parse(fs.readFileSync(path, 'utf8'));
  j.refresh = { ...j.refresh, inProgress: s.inProgress, failed: s.failed, incomplete: s.incomplete, enable: s.enable };
  j.preferences = j.preferences || {};
  j.preferences.tabs = { ...j.preferences.tabs, refresh: s.tab };
  j.preferences.refresh = {
    tokenLabel: s.tokenLabel, tokenHelp: s.tokenHelp, scopeWarning: s.scopeWarning,
    test: s.test, testOk: s.testOk, testFail: s.testFail, save: s.save,
  };
  fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  console.log('ok', loc);
}
```

- [ ] **Step 2 : Exécuter puis vérifier la parité**

```bash
node /tmp/add-refresh-i18n.mjs
```

Puis la commande de parité du `CLAUDE.md` :

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk"];const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":"parité ok")'
```
Attendu : `parité ok`.

- [ ] **Step 3 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/locales
git commit -m "i18n: add the feed refresh strings"
```

---

### Task 9 : Le bandeau

**Files:**
- Modify: `src/components/RefreshBanner.tsx`
- Modify: `src/stores/uiStore.ts` (état + `jsonKeys` vers la ligne 533, `UI_SYNC_KEYS` vers la ligne 557)
- Modify: `src/styles/index.css` (après `.refresh-banner__icon`, vers la ligne 688)

**Interfaces:**
- Consumes: `refreshPhase`, `refreshResult`, `hasRefreshToken` du store ; `openPreferences(tab)` de `themeStore`.
- Produces: `UiState.refreshHintDismissed: boolean` et `dismissRefreshHint(): void`.

- [ ] **Step 0 : Persister le rejet de l'invitation**

Dans `src/stores/uiStore.ts`, ajouter à l'interface `UiState` :

```ts
  /** The "enable feed refreshing" hint is offered once, then never again. */
  refreshHintDismissed: boolean;
  dismissRefreshHint: () => void;
```

À l'état initial, à côté des autres `loadJson` :

```ts
  refreshHintDismissed: loadJson('frirss_refreshHintDismissed', false),
```

L'action, à côté des autres :

```ts
  dismissRefreshHint: () => {
    localStorage.setItem('frirss_refreshHintDismissed', JSON.stringify(true));
    set({ refreshHintDismissed: true });
  },
```

Puis ajouter `'refreshHintDismissed'` **aux deux listes** : `jsonKeys` (vers la
ligne 533) et `UI_SYNC_KEYS` (vers la ligne 557). Les deux sont nécessaires :
la première applique la préférence reçue du serveur, la seconde la fait remonter.
N'en oublier aucune — le symptôme serait une invitation qui revient sur l'autre
appareil.

- [ ] **Step 1 : Réécrire le composant**

`src/components/RefreshBanner.tsx` — remplacer le corps par :

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';
import { useThemeStore } from '../stores/themeStore';
import { useUiStore } from '../stores/uiStore';

const SHOW_MS = 5000;

/**
 * Transient banner shown after a refresh. While a real (server-side) refresh is
 * running it stays up and counts articles as they land; once the job resolves it
 * behaves like before and auto-clears.
 */
export default function RefreshBanner() {
  const { t } = useTranslation();
  const refreshResult = useFeedStore((s) => s.refreshResult);
  const refreshPhase = useFeedStore((s) => s.refreshPhase);
  const hasRefreshToken = useFeedStore((s) => s.hasRefreshToken);
  const clearRefreshResult = useFeedStore((s) => s.clearRefreshResult);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const refreshHintDismissed = useUiStore((s) => s.refreshHintDismissed);
  const dismissRefreshHint = useUiStore((s) => s.dismissRefreshHint);

  const running = refreshPhase === 'running';
  // Offered once: no token, nothing in flight, and not already waved away.
  const showHint = !hasRefreshToken && !running && !refreshHintDismissed;

  useEffect(() => {
    if (!refreshResult || running) return;   // don't dismiss a refresh in progress
    const id = setTimeout(clearRefreshResult, SHOW_MS);
    return () => clearTimeout(id);
  }, [refreshResult, running, clearRefreshResult]);

  if (!refreshResult) return null;

  const hasNew = refreshResult.totalNew > 0;
  const count = t('refresh.newArticles', { count: refreshResult.totalNew });

  let label: string;
  if (running) label = hasNew ? `${t('refresh.inProgress')} ${count}` : t('refresh.inProgress');
  else if (refreshPhase === 'failed') label = t('refresh.failed');
  else if (refreshPhase === 'timeout') label = hasNew ? count : t('refresh.incomplete');
  else label = hasNew ? count : t('refresh.upToDate');

  return (
    <div
      className={`refresh-banner${running ? ' refresh-banner--running' : ''}`}
      role="status"
      aria-live="polite"
    >
      <svg
        className={`refresh-banner__icon${running ? ' refresh-banner__icon--spin' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {running ? (
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        ) : hasNew ? (
          <path d="M12 3v18M3 12h18" />
        ) : (
          <path d="M5 13l4 4L19 7" />
        )}
      </svg>
      <span>{label}</span>
      {showHint && (
        <>
          <button
            type="button"
            className="refresh-banner__action"
            onClick={() => openPreferences('refresh')}
          >
            {t('refresh.enable')}
          </button>
          <button
            type="button"
            className="refresh-banner__action"
            aria-label={t('app.close')}
            onClick={dismissRefreshHint}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Corriger le CSS — deux pièges du style existant**

Dans `src/styles/index.css`, après la règle `.refresh-banner__icon` (vers la
ligne 688), ajouter :

```css
/* A real refresh runs for minutes; the default rule fades the banner out at
   4.55s, which would hide it mid-refresh. Keep it up until the job resolves. */
.refresh-banner--running {
  animation: refresh-banner-in 0.42s cubic-bezier(0.18, 1.25, 0.4, 1);
}
.refresh-banner__icon--spin {
  animation: spin 1s linear infinite;
}
/* .refresh-banner sets pointer-events: none so it never blocks the list;
   the action link is the one part that has to stay clickable. */
.refresh-banner__action {
  pointer-events: auto;
  margin-left: 8px;
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-size: 0.85em;
  font-weight: 600;
  background: none;
  border: 0;
  cursor: pointer;
}
```

Vérifier au passage qu'une animation `spin` existe déjà dans la feuille ; sinon
l'ajouter :

```css
@keyframes spin { to { transform: rotate(360deg); } }
```

> Ces deux points ne sont pas cosmétiques. Sans la première règle le bandeau
> s'efface au bout de 4,5 s alors que la relève continue ; sans la seconde le
> bouton d'invitation est incliquable, car `.refresh-banner` porte
> `pointer-events: none`.

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Attendu : PASS.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/RefreshBanner.tsx src/stores/uiStore.ts src/styles/index.css
git commit -m "feat(refresh): show refresh progress and offer to enable it once"
```

> **L'invitation est bien ponctuelle** : une fois fermée, elle ne revient plus.
> C'est ce que la spec annonce (« Mémorisé dans les préférences utilisateur pour
> ne pas revenir ») — arbitrage confirmé le 2026-08-21.

---

### Task 10 : L'onglet « Relève » des préférences

**Files:**
- Create: `src/components/Preferences/RefreshTab.tsx`
- Modify: `src/components/Preferences/Preferences.tsx:225-226` (liste des onglets) et le bloc de rendu (vers la ligne 383)

**Interfaces:**
- Consumes: `getServers`, `updateServer`, `startActualize` (Task 6) ; `setHasRefreshToken` (Task 7).
- Produces: rien.

> Fichier **séparé** : `Preferences.tsx` fait déjà 3010 lignes et sa refonte est au backlog. Ne rien ajouter à son corps au-delà de l'enregistrement de l'onglet.

- [ ] **Step 1 : Créer l'onglet**

`src/components/Preferences/RefreshTab.tsx` :

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getServers, updateServer, startActualize } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useFeedStore } from '../../stores/feedStore';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

/**
 * Master-token configuration for the active FreshRSS server. The token is
 * write-only from here: the backend never sends its value back, only whether
 * one is set.
 */
export default function RefreshTab() {
  const { t } = useTranslation();
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const setHasRefreshToken = useFeedStore((s) => s.setHasRefreshToken);

  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState>('idle');

  useEffect(() => {
    getServers()
      .then((servers) => {
        const active = servers.find((s) => String(s.id) === String(activeServerId));
        setConfigured(!!active?.has_refresh_token);
      })
      .catch(() => { /* leave it unconfigured */ });
  }, [activeServerId]);

  async function save() {
    if (activeServerId == null) return;
    setSaving(true);
    setTest('idle');
    try {
      await updateServer(Number(activeServerId), { refreshToken: token });
      setConfigured(token !== '');
      setHasRefreshToken(token !== '');
      setToken('');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (activeServerId == null) return;
    setTest('testing');
    try {
      // maxFeeds=1: proves the token is accepted without starting a full sweep.
      const job = await startActualize(Number(activeServerId), 1);
      setTest(job ? 'ok' : 'fail');
    } catch {
      setTest('fail');
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="block mb-1" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.refresh.tokenLabel')}
        </span>
        <input
          type="password"
          value={token}
          autoComplete="new-password"
          placeholder={configured ? '••••••••' : ''}
          onChange={(e) => setToken(e.target.value)}
          className="w-full px-2 py-1 rounded"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--panel-border)' }}
        />
      </label>

      <p className="text-sm" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.refresh.tokenHelp')}
      </p>

      <p className="text-sm" style={{ color: 'var(--accent)' }}>
        {t('preferences.refresh.scopeWarning')}
      </p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving || activeServerId == null}>
          {t('preferences.refresh.save')}
        </button>
        <button type="button" onClick={runTest} disabled={!configured || test === 'testing'}>
          {t('preferences.refresh.test')}
        </button>
        {test === 'ok' && <span style={{ color: 'var(--teal)' }}>{t('preferences.refresh.testOk')}</span>}
        {test === 'fail' && <span style={{ color: 'var(--accent)' }}>{t('preferences.refresh.testFail')}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Enregistrer l'onglet**

Dans `src/components/Preferences/Preferences.tsx`, importer en tête :

```ts
import RefreshTab from './RefreshTab';
```

Ajouter `'refresh'` à `baseTabIds` (ligne 225), après `'general'` :

```ts
  const baseTabIds = ['general', 'refresh', 'branding', 'colors', 'fonts', 'labels', 'themes', 'shortcuts', 'offline'];
```

Et le rendu, à côté de `{tab === 'general' && <GeneralTab />}` :

```tsx
          {tab === 'refresh' && <RefreshTab />}
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/Preferences/RefreshTab.tsx src/components/Preferences/Preferences.tsx
git commit -m "feat(preferences): configure the feed refresh token"
```

---

### Task 11 : Le champ optionnel à la première configuration

**Files:**
- Modify: `src/components/ServerSwitcher/AddServerDialog.tsx`

**Interfaces:**
- Consumes: `updateServer` (Task 6).
- Produces: rien.

> `POST /api/servers` n'accepte volontairement pas `refreshToken` : le jeton est enregistré juste après la création, par un `PUT`. Cela évite d'élargir la surface de la route de création et garde un seul chemin d'écriture pour ce secret.

- [ ] **Step 1 : Ajouter le champ**

Dans `AddServerDialog.tsx`, ajouter un état à côté des champs existants :

```ts
const [refreshToken, setRefreshToken] = useState('');
```

Et, sous les champs URL / utilisateur / mot de passe, un bloc facultatif :

```tsx
<details className="mt-3">
  <summary className="cursor-pointer text-sm" style={{ color: 'var(--list-summary)' }}>
    {t('preferences.tabs.refresh')}
  </summary>
  <div className="mt-2 space-y-2">
    <input
      type="password"
      value={refreshToken}
      autoComplete="new-password"
      placeholder={t('preferences.refresh.tokenLabel')}
      onChange={(e) => setRefreshToken(e.target.value)}
      className="w-full px-2 py-1 rounded"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--panel-border)' }}
    />
    <p className="text-xs" style={{ color: 'var(--list-summary)' }}>
      {t('preferences.refresh.tokenHelp')}
    </p>
    <p className="text-xs" style={{ color: 'var(--accent)' }}>
      {t('preferences.refresh.scopeWarning')}
    </p>
  </div>
</details>
```

- [ ] **Step 2 : Enregistrer le jeton après la création**

Le fichier importe déjà `addServer as apiAddServer` et lie son résultat à
`server` (ligne 31). Insérer juste après cet appel, **avant** le `onAdded(...)`
de la ligne 39 :

```ts
      if (refreshToken) {
        await updateServer(server.id, { refreshToken });
        useFeedStore.getState().setHasRefreshToken(true);
      }
```

Et compléter l'import existant de `../../api/backend` plutôt que d'en ajouter un
second :

```ts
import { addServer as apiAddServer, updateServer } from '../../api/backend';
import { useFeedStore } from '../../stores/feedStore';
```

- [ ] **Step 3 : Vérifier**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : PASS.

- [ ] **Step 4 : Garde-fou puis commit**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add src/components/ServerSwitcher/AddServerDialog.tsx
git commit -m "feat(setup): offer the refresh token when adding a server"
```

---

### Task 12 : Documentation et vérification de bout en bout

**Files:**
- Modify: `README.md` (tableau des variables d'environnement)
- Modify: `CLAUDE.md` (même tableau) — **attention, `CLAUDE.md` est gitignoré** : l'éditer quand même pour les sessions futures, mais ne pas s'attendre à le voir dans `git status`.

- [ ] **Step 1 : Documenter la variable**

Ajouter la ligne au tableau des variables d'environnement :

| Variable | Rôle | Défaut |
|----------|------|--------|
| `FRIRSS_REFRESH_MAX_FEEDS` | Nombre de flux relevés par déclenchement du bouton « Rafraîchir » (relève réelle côté FreshRSS). Valeur non entière ou < 1 → défaut. | 1000 |

- [ ] **Step 2 : Gates complets**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
```
Attendu : tout vert.

- [ ] **Step 3 : Garde-fou, commit, push**

```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
git add README.md
git commit -m "docs: document FRIRSS_REFRESH_MAX_FEEDS"
git push
```

- [ ] **Step 4 : Vérifier les DEUX workflows**

```bash
gh run list --branch dev --limit 4
```
`CI` **et** `Publish image` doivent être verts. Le garde-fou tourne dans `CI` avant lint/typecheck/tests : un `CI` rouge ne signifie pas forcément que le code est cassé.

- [ ] **Step 5 : Contrôle fonctionnel sur l'instance de développement**

Recréer le conteneur de développement en réutilisant à l'identique son environnement et ses libellés — les valeurs concrètes vivent dans les notes d'exploitation, hors dépôt. Puis, sur l'URL de développement :

1. Configurer le jeton dans *Préférences → Relève*, cliquer **Tester** → succès attendu.
2. Cliquer **Rafraîchir** → le bandeau doit afficher « Relève en cours… », le compteur monter, et des articles apparaître **sans** rechargement manuel.
3. Vider le champ jeton, enregistrer, cliquer **Rafraîchir** → comportement identique à avant la fonctionnalité (contrôle négatif).

- [ ] **Step 6 : Contrôle de fuite**

Après une relève, inspecter les journaux d'accès du serveur placé devant FreshRSS : le jeton ne doit y apparaître **nulle part**. C'est la vérification qui justifie tout le choix du POST — ne pas la sauter.

---

## Notes pour l'implémenteur

- **Le POST au lieu du GET est un invariant, pas une optimisation.** Il repose sur trois faits vérifiés dans le code de FreshRSS : `FrontController` fusionne `$_POST` dans les paramètres, `tokenIsOk()` ne distingue pas l'origine, `feedController` n'a aucun contrôle CSRF. Si la Task 4 échoue en pratique (relève non déclenchée), **vérifier ces trois points sur la version de FreshRSS ciblée avant de basculer en GET** — et si le GET devient nécessaire, cela invalide l'analyse de sécurité de la spec, donc revenir vers l'auteur plutôt que de le décider seul.
- **FreshRSS refuse de relever un flux plus d'une fois toutes les 20 minutes.** Un second essai immédiat ne ramènera rien : ce n'est pas un bug.
- Les cinq sites d'écriture de `feedStore` mentionnés dans les notes du projet ne sont pas touchés ici — cette fonctionnalité n'est qu'en lecture côté FriRSS.
