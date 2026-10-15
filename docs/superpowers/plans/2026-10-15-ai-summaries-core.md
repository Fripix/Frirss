# Résumés IA — plan 1 : socle serveur, bloc admin, pastille du volet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer la tranche verticale minimale de la spec : l'admin déclare un fournisseur et allume la fonctionnalité, un lecteur clique « Résumé IA » dans le volet et lit un résumé, avec cache, plafond et repli côté serveur.

**Architecture:** un module `server/ai/` (deux adaptateurs HTTP bruts derrière `fetchUpstream`, résolution pure du fournisseur, orchestration résumé/repli/plafond/cache), deux routeurs (`/api/ai`, `/api/admin/ai/*`), un petit store client `aiStore`, un composant `AiSummary` branché dans `ReadingPane`, un bloc admin dans une nouvelle section « IA » des Préférences. Les plans 2 (panneau utilisateur, par flux, clés personnelles, résumé automatique) et 3 (traduction) s'appuient dessus.

**Tech Stack:** TypeScript strict, Express 5, better-sqlite3, vitest + supertest (serveur), React 18 + jsdom + testing-library (client), i18next (10 locales).

**Spec:** `docs/superpowers/specs/2026-10-15-ai-summaries-design.md` (§1-6, §9, §10 bloc Fournisseurs, §11, §12-14).

## Global Constraints

- Branche `ai-summaries` ; jamais de push sur `dev` depuis ce plan. Commits neutres, **sans trailer d'IA**.
- Avant chaque commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`, puis le garde-fou : `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` doit être vide.
- **Zéro dépendance nouvelle** (`package.json` inchangé).
- **Deux adaptateurs**, `anthropic` et `openai`, jamais un troisième.
- Une clé n'est **jamais** renvoyée par une route ; les réponses portent `hasAdminKey` / `hasUserKey`.
- Appels sortants uniquement par `fetchUpstream(url, { trustedHosts: [hôte], timeoutMs: 60_000, followRedirects: false })`.
- Rien de visible côté client quand `ai_enabled` est `'false'` (sauf la section « IA » pour l'admin).
- Toute chaîne d'interface dans les **10 locales** (`fr en de es it nl pl pt uk zh`), famille `ai` + `preferences.sections.ai`.
- `docs/FEATURES.md` mis à jour dans le même commit que la fonctionnalité (routes, famille `ai`, nouvelle famille de fonctionnalités) ; `docs/RELEASE-NEXT.md` et `SECURITY.md` aussi.
- Trois formats vérifiés (desktop, tablette, 320 px) avant de déclarer le volet fini.

## Review Focus

1. **Un fournisseur dont `base_url` redirige** (301 vers https) : `followRedirects: false` rend un 3xx → classé `technical`, repli sur le suivant, jamais de secret envoyé à l'hôte de redirection. Test dans la tâche 4.
2. **Réponse 200 sans texte** (modèle qui refuse, `stop_reason: refusal`, `finish_reason: content_filter`) : classée `refused`, pas de repli, message clair. Test dans la tâche 4.
3. **Article vide ou minuscule** (< 40 mots après nettoyage) : 400 `article_too_short`, aucun appel payant. Tests dans les tâches 6 et 7.
4. **Fournisseur par défaut supprimé par l'admin** : la résolution l'ignore et prend le premier disponible ; la route ne lève pas. Test dans la tâche 6.
5. **Deux clics rapides sur la pastille** : une seule requête en vol par article côté client, et le cache serveur absorbe la seconde si elle part quand même. Tests dans les tâches 7 (cache) et 11 (client).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `server/ai/text.ts` (+ test) | HTML → texte borné pour le prompt |
| `server/ai/errors.ts` (+ test) | `AiError` et la classification `auth` / `quota` / `technical` / `refused` |
| `server/ai/prompts.ts` | consignes système, `PROMPT_VERSION` |
| `server/ai/lang.ts` (+ test) | extraction de la ligne `lang:` |
| `server/ai/providers.ts` (+ test) | les deux adaptateurs, `callProvider()` |
| `server/ai/store.ts` (+ test) | tables `ai_*`, CRUD fournisseurs, clés, usage, cache |
| `server/ai/resolve.ts` (+ test) | résolution pure du fournisseur et de la clé, ordre de repli |
| `server/ai/summarize.ts` (+ test) | orchestration : plafond, cache, appel, repli, usage |
| `server/routes/ai.ts` | `GET /api/ai/config`, `POST /api/ai/summary` |
| `server/routes/adminAi.ts` | CRUD fournisseurs, réglages, test de connexion |
| `server/db.ts` | 4 tables, 4 réglages par défaut |
| `server/index.ts` | montage des deux routeurs |
| `server/test/ai.test.ts` | routes de bout en bout (supertest, `fetch` simulé) |
| `src/api/backend.ts` | fonctions client |
| `src/stores/aiStore.ts` (+ test) | config IA côté client, chargée après connexion |
| `src/components/ReadingPane/AiSummary.tsx` (+ test) | pastille + bloc résumé |
| `src/components/ReadingPane/ReadingPane.tsx` | branchement |
| `src/components/Preferences/AiTab.tsx` (+ test) | section « IA », bloc admin « Fournisseurs » |
| `src/components/Preferences/Preferences.tsx` | section dans la navigation |
| `src/locales/*.json` | famille `ai`, `preferences.sections.ai` |
| `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`, `SECURITY.md` | inventaire, journal, sécurité |

---

### Task 1: HTML → texte, erreurs, ligne `lang:`

**Files:**
- Create: `server/ai/text.ts`, `server/ai/text.test.ts`, `server/ai/errors.ts`, `server/ai/errors.test.ts`, `server/ai/lang.ts`, `server/ai/lang.test.ts`

**Interfaces:**
- Produces: `htmlToText(html: string, maxChars = 200_000): string` ; `class AiError extends Error { kind: AiErrorKind; status?: number }` ; `type AiErrorKind = 'auth' | 'quota' | 'technical' | 'refused'` ; `classifyStatus(status: number): AiErrorKind` ; `splitLangLine(text: string): { lang: string | null; text: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/ai/text.test.ts
import { describe, it, expect } from 'vitest';
import { htmlToText } from './text.js';

describe('htmlToText', () => {
  it('drops tags, scripts and styles, keeps paragraph breaks', () => {
    const html = '<h1>Titre</h1><script>x()</script><style>p{}</style><p>Un <b>mot</b>.</p><p>Deux.</p>';
    expect(htmlToText(html)).toBe('Titre\n\nUn mot.\n\nDeux.');
  });
  it('decodes the common entities and collapses whitespace', () => {
    expect(htmlToText('<p>a &amp; b&nbsp;c &lt;d&gt;   e\n\n\n f</p>')).toBe('a & b c <d> e f');
  });
  it('caps the output at maxChars', () => {
    expect(htmlToText('<p>' + 'x'.repeat(50) + '</p>', 10)).toHaveLength(10);
  });
});
```

```ts
// server/ai/errors.test.ts
import { describe, it, expect } from 'vitest';
import { AiError, classifyStatus } from './errors.js';

describe('classifyStatus', () => {
  it('maps HTTP status to an error kind', () => {
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(403)).toBe('auth');
    expect(classifyStatus(402)).toBe('quota');
    expect(classifyStatus(429)).toBe('quota');
    expect(classifyStatus(500)).toBe('technical');
    expect(classifyStatus(302)).toBe('technical');
  });
  it('AiError carries kind and status', () => {
    const e = new AiError('quota', 'rate limited', 429);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('quota');
    expect(e.status).toBe(429);
  });
});
```

```ts
// server/ai/lang.test.ts
import { describe, it, expect } from 'vitest';
import { splitLangLine } from './lang.js';

describe('splitLangLine', () => {
  it('takes the lang line off the top of the text', () => {
    expect(splitLangLine('lang: en\n\nSummary here.')).toEqual({ lang: 'en', text: 'Summary here.' });
  });
  it('accepts BCP 47 tags and lower-cases the language part', () => {
    expect(splitLangLine('Lang: zh-Hant\nTexte')).toEqual({ lang: 'zh-Hant', text: 'Texte' });
  });
  it('returns null when the model forgot the line', () => {
    expect(splitLangLine('Just text')).toEqual({ lang: null, text: 'Just text' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/ai/`
Expected: 3 suites fail with "Failed to load url ./text.js" (and errors.js, lang.js).

- [ ] **Step 3: Implement**

```ts
// server/ai/text.ts
/**
 * HTML nettoyé → texte brut pour le prompt. Pas de DOM : une passe de regex
 * suffit pour un contenu déjà passé par le sanitiseur, et c'est synchrone.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
};

export function htmlToText(html: string, maxChars = 200_000): string {
  const text = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
```

```ts
// server/ai/errors.ts
export type AiErrorKind = 'auth' | 'quota' | 'technical' | 'refused';

/** Une erreur d'appel à un fournisseur, classée pour que le repli sache quoi faire. */
export class AiError extends Error {
  constructor(public readonly kind: AiErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = 'AiError';
  }
}

/** 401/403 → clé ; 402/429 → quota ; tout le reste (3xx compris : on ne suit pas) → technique. */
export function classifyStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 429) return 'quota';
  return 'technical';
}
```

```ts
// server/ai/lang.ts
/**
 * Le résumé commence par `lang: <code>` (consigne de `prompts.ts`). On retire
 * la ligne et on garde le code : il décide si « Traduire » a un sens.
 */
export function splitLangLine(text: string): { lang: string | null; text: string } {
  const m = text.match(/^\s*lang:\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\s*\n+/i);
  if (!m) return { lang: null, text: text.trim() };
  const [base, ...rest] = m[1].split('-');
  const lang = [base.toLowerCase(), ...rest].join('-');
  return { lang, text: text.slice(m[0].length).trim() };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/ai/`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ai/text.ts server/ai/text.test.ts server/ai/errors.ts server/ai/errors.test.ts server/ai/lang.ts server/ai/lang.test.ts
git commit -m "feat(ai): text, error and language helpers for the summary pipeline"
```

---

### Task 2: Schéma et réglages par défaut

**Files:**
- Modify: `server/db.ts` (après le bloc `CREATE TABLE IF NOT EXISTS settings`, et après `initSetting.run('registration_enabled', 'false');`)
- Test: `server/test/ai.test.ts` (créé ici, enrichi par les tâches suivantes)

**Interfaces:**
- Produces: tables `ai_providers`, `ai_user_keys`, `ai_usage`, `ai_cache` ; réglages `ai_enabled='false'`, `ai_user_keys_allowed='false'`, `ai_daily_cap='50'`, `ai_default_provider=''`.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ai.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { getSetting } from '../db.js';

let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const reg = await request(app).post('/api/auth/register')
    .send({ username: 'root', password: 'secret123', email: 'root@example.com', displayName: 'Root' });
  adminToken = reg.body.token;
  await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
    .send({ username: 'alice', password: 'secret123', email: 'alice@example.com', role: 'user' });
  const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'secret123' });
  userToken = login.body.token;
});

describe('ai schema', () => {
  it('creates the four ai_ tables', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(['ai_cache', 'ai_providers', 'ai_usage', 'ai_user_keys']);
  });
  it('ships disabled, keys admin-only, cap 50', () => {
    expect(getSetting('ai_enabled')).toBe('false');
    expect(getSetting('ai_user_keys_allowed')).toBe('false');
    expect(getSetting('ai_daily_cap')).toBe('50');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/test/ai.test.ts`
Expected: FAIL — `[]` au lieu des quatre tables ; `null` au lieu de `'false'`.

- [ ] **Step 3: Add the schema and defaults**

Dans `server/db.ts`, ajouter à la fin du `db.exec(\`…\`)` du schéma, après la table `settings` :

```sql
  CREATE TABLE IF NOT EXISTS ai_providers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('anthropic', 'openai')),
    base_url   TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    admin_key  TEXT,
    shared     INTEGER DEFAULT 0,
    position   INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_user_keys (
    user_id     INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    key         TEXT    NOT NULL,
    PRIMARY KEY (user_id, provider_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INTEGER NOT NULL,
    day     TEXT    NOT NULL,
    count   INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_cache (
    key        TEXT PRIMARY KEY,
    text       TEXT NOT NULL,
    lang       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
```

Après `initSetting.run('registration_enabled', 'false');` :

```ts
// Résumés IA (spec docs/superpowers/specs/2026-10-15-ai-summaries-design.md) :
// éteints d'origine — rien n'est visible tant que l'admin n'allume pas.
initSetting.run('ai_enabled', 'false');
initSetting.run('ai_user_keys_allowed', 'false');
initSetting.run('ai_daily_cap', '50');
initSetting.run('ai_default_provider', '');
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/test/ai.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/test/ai.test.ts
git commit -m "feat(ai): schema and default settings"
```

---

### Task 3: Consignes et store (fournisseurs, clés, usage, cache)

**Files:**
- Create: `server/ai/prompts.ts`, `server/ai/store.ts`, `server/ai/store.test.ts`

**Interfaces:**
- Produces:
  - `PROMPT_VERSION = 1`, `SUMMARY_SYSTEM: string`.
  - `interface AiProvider { id: number; name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; hasAdminKey: boolean; shared: boolean; position: number }`
  - `listProviders(): AiProvider[]` (ordre `position`), `getProvider(id): AiProvider | null`, `createProvider(input: ProviderInput): AiProvider`, `updateProvider(id, input: Partial<ProviderInput>): AiProvider | null`, `deleteProvider(id): boolean`, `reorderProviders(ids: number[]): void`, avec `interface ProviderInput { name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; adminKey?: string | null; shared?: boolean }` (`adminKey: ''` efface, `undefined` ne touche pas).
  - `adminKeyFor(providerId): string | null` (déchiffrée), `userKeyFor(userId, providerId): string | null`, `setUserKey(userId, providerId, key: string | null)`, `hasUserKey(userId, providerId): boolean`.
  - `usageToday(userId): number`, `bumpUsage(userId): number` (jour civil local `YYYY-MM-DD`).
  - `aiCacheKey(parts: { articleId: string; op: 'summary' | 'translate'; providerId: number; lang?: string }): string`, `aiCacheGet(key): Promise<{ text: string; lang: string | null } | null>`, `aiCacheSet(key, value): Promise<void>` — Redis via `cacheGet`/`cacheSet` de `server/cache.ts` quand `cacheEnabled`, sinon `ai_cache` avec purge au-delà de 10 000 lignes.
  - `isAiEnabled(): boolean`, `userKeysAllowed(): boolean`, `dailyCap(): number`, `defaultProviderId(): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// server/ai/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import {
  listProviders, createProvider, updateProvider, deleteProvider, reorderProviders,
  adminKeyFor, setUserKey, userKeyFor, hasUserKey, usageToday, bumpUsage,
  aiCacheKey, aiCacheGet, aiCacheSet,
} from './store.js';

beforeEach(() => {
  db.exec('DELETE FROM ai_user_keys; DELETE FROM ai_providers; DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (41, 'store-user', 'user')").run();
});

describe('providers', () => {
  it('creates with an encrypted admin key and never lists it', () => {
    const p = createProvider({ name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', adminKey: 'sk-ant-1', shared: true });
    expect(p.hasAdminKey).toBe(true);
    expect(JSON.stringify(listProviders())).not.toContain('sk-ant-1');
    const raw = db.prepare('SELECT admin_key FROM ai_providers WHERE id = ?').get(p.id) as { admin_key: string };
    expect(raw.admin_key.startsWith('enc:v1:')).toBe(true);
    expect(adminKeyFor(p.id)).toBe('sk-ant-1');
  });
  it('update: undefined keeps the key, empty string clears it', () => {
    const p = createProvider({ name: 'X', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3', adminKey: 'k' });
    expect(updateProvider(p.id, { name: 'Y' })!.hasAdminKey).toBe(true);
    expect(updateProvider(p.id, { adminKey: '' })!.hasAdminKey).toBe(false);
  });
  it('orders by position and reorders', () => {
    const a = createProvider({ name: 'A', type: 'openai', baseUrl: 'http://a', model: 'm' });
    const b = createProvider({ name: 'B', type: 'openai', baseUrl: 'http://b', model: 'm' });
    reorderProviders([b.id, a.id]);
    expect(listProviders().map((p) => p.name)).toEqual(['B', 'A']);
    expect(deleteProvider(a.id)).toBe(true);
    expect(listProviders().map((p) => p.name)).toEqual(['B']);
  });
});

describe('user keys', () => {
  it('stores encrypted, reads back, clears with null', () => {
    const p = createProvider({ name: 'A', type: 'openai', baseUrl: 'http://a', model: 'm' });
    setUserKey(41, p.id, 'user-key');
    expect(hasUserKey(41, p.id)).toBe(true);
    expect(userKeyFor(41, p.id)).toBe('user-key');
    const raw = db.prepare('SELECT key FROM ai_user_keys WHERE user_id = 41').get() as { key: string };
    expect(raw.key.startsWith('enc:v1:')).toBe(true);
    setUserKey(41, p.id, null);
    expect(hasUserKey(41, p.id)).toBe(false);
  });
});

describe('usage', () => {
  it('counts per user per day', () => {
    expect(usageToday(41)).toBe(0);
    expect(bumpUsage(41)).toBe(1);
    expect(bumpUsage(41)).toBe(2);
    expect(usageToday(41)).toBe(2);
  });
});

describe('cache', () => {
  it('keys by article, op, provider, lang and prompt version', () => {
    const k1 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 3 });
    const k2 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 4 });
    expect(k1).not.toBe(k2);
    expect(k1).toContain(':v1:');
  });
  it('round-trips through SQLite when Redis is off', async () => {
    const k = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1 });
    expect(await aiCacheGet(k)).toBeNull();
    await aiCacheSet(k, { text: 'résumé', lang: 'fr' });
    expect(await aiCacheGet(k)).toEqual({ text: 'résumé', lang: 'fr' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/ai/store.test.ts`
Expected: FAIL — "Failed to load url ./store.js".

- [ ] **Step 3: Implement prompts and store**

```ts
// server/ai/prompts.ts
/** Bump when a prompt changes: the version is part of the cache key. */
export const PROMPT_VERSION = 1;

export const SUMMARY_SYSTEM = [
  'You summarise articles for a feed reader.',
  'Write the summary in the SAME language as the article.',
  'First line, exactly: "lang: <BCP 47 code of the article language>", then a blank line, then the summary.',
  'Be faithful to the article; proportion the length to the article, never fewer than three sentences, no upper word limit.',
  'Use paragraphs; use bullet points only if the article itself is a list.',
  'Do not open with phrases like "This article is about"; do not add opinions or a title.',
].join('\n');
```

```ts
// server/ai/store.ts
import db, { getSetting } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { cacheEnabled, cacheGet, cacheSet } from '../cache.js';
import { PROMPT_VERSION } from './prompts.js';

export type ProviderType = 'anthropic' | 'openai';
export interface AiProvider {
  id: number; name: string; type: ProviderType; baseUrl: string; model: string;
  hasAdminKey: boolean; shared: boolean; position: number;
}
export interface ProviderInput {
  name: string; type: ProviderType; baseUrl: string; model: string;
  adminKey?: string | null; shared?: boolean;
}
interface Row { id: number; name: string; type: ProviderType; base_url: string; model: string; admin_key: string | null; shared: number; position: number }

const toProvider = (r: Row): AiProvider => ({
  id: r.id, name: r.name, type: r.type, baseUrl: r.base_url, model: r.model,
  hasAdminKey: !!r.admin_key, shared: r.shared === 1, position: r.position,
});

export function listProviders(): AiProvider[] {
  return (db.prepare('SELECT * FROM ai_providers ORDER BY position, id').all() as Row[]).map(toProvider);
}
export function getProvider(id: number): AiProvider | null {
  const r = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Row | undefined;
  return r ? toProvider(r) : null;
}
export function createProvider(input: ProviderInput): AiProvider {
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ai_providers').get() as { p: number }).p;
  const res = db.prepare(
    'INSERT INTO ai_providers (name, type, base_url, model, admin_key, shared, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.name, input.type, input.baseUrl.replace(/\/$/, ''), input.model,
    input.adminKey ? encrypt(input.adminKey) : null, input.shared ? 1 : 0, pos);
  return getProvider(Number(res.lastInsertRowid))!;
}
export function updateProvider(id: number, input: Partial<ProviderInput>): AiProvider | null {
  const cur = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return null;
  const adminKey = input.adminKey === undefined ? cur.admin_key
    : input.adminKey === '' || input.adminKey === null ? null : encrypt(input.adminKey);
  db.prepare('UPDATE ai_providers SET name = ?, type = ?, base_url = ?, model = ?, admin_key = ?, shared = ? WHERE id = ?').run(
    input.name ?? cur.name, input.type ?? cur.type, (input.baseUrl ?? cur.base_url).replace(/\/$/, ''),
    input.model ?? cur.model, adminKey, input.shared === undefined ? cur.shared : (input.shared ? 1 : 0), id,
  );
  return getProvider(id);
}
export function deleteProvider(id: number): boolean {
  return db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id).changes > 0;
}
export function reorderProviders(ids: number[]): void {
  const upd = db.prepare('UPDATE ai_providers SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
}

export function adminKeyFor(providerId: number): string | null {
  const r = db.prepare('SELECT admin_key FROM ai_providers WHERE id = ?').get(providerId) as { admin_key: string | null } | undefined;
  return r?.admin_key ? decrypt(r.admin_key) : null;
}
export function userKeyFor(userId: number, providerId: number): string | null {
  const r = db.prepare('SELECT key FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').get(userId, providerId) as { key: string } | undefined;
  return r ? decrypt(r.key) : null;
}
export function hasUserKey(userId: number, providerId: number): boolean {
  return !!db.prepare('SELECT 1 FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').get(userId, providerId);
}
export function setUserKey(userId: number, providerId: number, key: string | null): void {
  if (!key) { db.prepare('DELETE FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').run(userId, providerId); return; }
  db.prepare('INSERT OR REPLACE INTO ai_user_keys (user_id, provider_id, key) VALUES (?, ?, ?)').run(userId, providerId, encrypt(key));
}

/** Jour civil local du serveur, `YYYY-MM-DD`. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function usageToday(userId: number): number {
  const r = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, today()) as { count: number } | undefined;
  return r?.count ?? 0;
}
export function bumpUsage(userId: number): number {
  db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1').run(userId, today());
  return usageToday(userId);
}

export interface AiCacheValue { text: string; lang: string | null }
const AI_CACHE_MAX_ROWS = 10_000;
const AI_CACHE_TTL = 30 * 24 * 3600;

export function aiCacheKey(p: { articleId: string; op: 'summary' | 'translate'; providerId: number; lang?: string }): string {
  return `frirss:ai:v${PROMPT_VERSION}:${p.op}:${p.providerId}:${p.lang ?? '-'}:${p.articleId}`;
}
export async function aiCacheGet(key: string): Promise<AiCacheValue | null> {
  if (cacheEnabled) {
    const raw = await cacheGet(key);
    return raw ? (JSON.parse(raw) as AiCacheValue) : null;
  }
  const r = db.prepare('SELECT text, lang FROM ai_cache WHERE key = ?').get(key) as AiCacheValue | undefined;
  return r ?? null;
}
export async function aiCacheSet(key: string, value: AiCacheValue): Promise<void> {
  if (cacheEnabled) { await cacheSet(key, JSON.stringify(value), AI_CACHE_TTL); return; }
  db.prepare('INSERT OR REPLACE INTO ai_cache (key, text, lang) VALUES (?, ?, ?)').run(key, value.text, value.lang);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM ai_cache').get() as { n: number }).n;
  if (n > AI_CACHE_MAX_ROWS) {
    db.prepare('DELETE FROM ai_cache WHERE key IN (SELECT key FROM ai_cache ORDER BY created_at LIMIT ?)').run(n - AI_CACHE_MAX_ROWS);
  }
}

export const isAiEnabled = (): boolean => getSetting('ai_enabled') === 'true';
export const userKeysAllowed = (): boolean => getSetting('ai_user_keys_allowed') === 'true';
export const dailyCap = (): number => Math.max(0, parseInt(getSetting('ai_daily_cap') ?? '50', 10) || 0);
export function defaultProviderId(): number | null {
  const v = parseInt(getSetting('ai_default_provider') ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/ai/store.test.ts server/test/ai.test.ts`
Expected: all pass (the `users` insert in `beforeEach` satisfies the foreign key of `ai_user_keys` / `ai_usage`).

- [ ] **Step 5: Commit**

```bash
git add server/ai/prompts.ts server/ai/store.ts server/ai/store.test.ts
git commit -m "feat(ai): provider, key, usage and cache store"
```

---

### Task 4: Les deux adaptateurs

**Files:**
- Create: `server/ai/providers.ts`, `server/ai/providers.test.ts`

**Interfaces:**
- Consumes: `AiProvider` (tâche 3), `AiError`, `classifyStatus` (tâche 1), `fetchUpstream` + `FetchUpstreamOpts` (`server/routes/proxy.ts`).
- Produces: `interface AiCall { system: string; user: string; maxTokens?: number }` ; `interface AiResult { text: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }` ; `callProvider(provider: AiProvider, key: string | null, call: AiCall): Promise<AiResult>` — lève `AiError`.

- [ ] **Step 1: Write the failing test**

```ts
// server/ai/providers.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import type { AiProvider } from './store.js';

vi.mock('dns', () => {
  const promises = { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) };
  return { default: { promises }, promises };
});

const anthropic: AiProvider = { id: 1, name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', hasAdminKey: true, shared: true, position: 0 };
const openai: AiProvider = { id: 2, name: 'Ollama', type: 'openai', baseUrl: 'https://ollama.example.com', model: 'llama3', hasAdminKey: false, shared: false, position: 1 };
const call = { system: 'sys', user: 'texte' };

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    text: async () => JSON.stringify(body), json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('anthropic adapter', () => {
  it('posts to /v1/messages with the key header and reads the text block', async () => {
    const fetchMock = stub(200, { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'lang: fr\n\nRésumé' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
    const r = await callProvider(anthropic, 'sk-ant', call);
    expect(r.text).toBe('lang: fr\n\nRésumé');
    expect(r.inputTokens).toBe(10);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'texte' }]);
    expect(init.redirect).toBe('manual');
  });
  it('classifies a refusal as refused, never as technical', async () => {
    stub(200, { content: [], stop_reason: 'refusal', usage: {} });
    await expect(callProvider(anthropic, 'k', call)).rejects.toMatchObject({ kind: 'refused' });
  });
});

describe('openai adapter', () => {
  it('posts to /v1/chat/completions with a bearer, no header without a key', async () => {
    const fetchMock = stub(200, { model: 'llama3', choices: [{ message: { content: 'lang: en\n\nSummary' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    const r = await callProvider(openai, null, call);
    expect(r.text).toBe('lang: en\n\nSummary');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ollama.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
  });
  it('maps 401 to auth and 429 to quota', async () => {
    stub(401, { error: 'bad key' });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'auth', status: 401 });
    stub(429, { error: 'slow down' });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'quota' });
  });
  it('treats a redirect as technical and never follows it', async () => {
    const fetchMock = stub(301, {}, { location: 'https://elsewhere.example.com/' });
    await expect(callProvider(openai, 'k', call)).rejects.toBeInstanceOf(AiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('content_filter is refused', async () => {
    stub(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'refused' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/ai/providers.test.ts`
Expected: FAIL — "Failed to load url ./providers.js".

- [ ] **Step 3: Implement**

```ts
// server/ai/providers.ts
import { fetchUpstream } from '../routes/proxy.js';
import { AiError, classifyStatus } from './errors.js';
import type { AiProvider } from './store.js';

export interface AiCall { system: string; user: string; maxTokens?: number }
export interface AiResult { text: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }

const TIMEOUT_MS = 60_000;      // un modèle local sur un long article dépasse les 30 s du proxy
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Un appel = un POST JSON, par `fetchUpstream` (garde anti-SSRF à chaque
 * saut) avec l'hôte du fournisseur de confiance : l'URL est fixée par
 * l'admin, pas par un client. `followRedirects: false` : un 3xx est une
 * erreur technique, jamais un secret envoyé ailleurs. Deux adaptateurs, et
 * pas un troisième (spec §3) — tout « compatible OpenAI » passe par `openai`.
 */
export async function callProvider(provider: AiProvider, key: string | null, call: AiCall): Promise<AiResult> {
  const started = Date.now();
  const host = new URL(provider.baseUrl).hostname.toLowerCase();
  const { url, headers, body } = provider.type === 'anthropic'
    ? anthropicRequest(provider, key, call)
    : openaiRequest(provider, key, call);

  let resp: Response;
  try {
    resp = await fetchUpstream(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      timeoutMs: TIMEOUT_MS, followRedirects: false, trustedHosts: [host],
    });
  } catch (err) {
    throw new AiError('technical', (err as Error).message);
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300);
    throw new AiError(classifyStatus(resp.status), `${provider.name}: HTTP ${resp.status} ${detail}`, resp.status);
  }
  let json: unknown;
  try { json = await resp.json(); } catch { throw new AiError('technical', `${provider.name}: non-JSON response`); }
  const parsed = provider.type === 'anthropic' ? parseAnthropic(json) : parseOpenai(json);
  if (parsed.refused) throw new AiError('refused', `${provider.name} declined the content`);
  if (!parsed.text.trim()) throw new AiError('technical', `${provider.name}: empty answer`);
  return { text: parsed.text, model: parsed.model || provider.model, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, durationMs: Date.now() - started };
}

function anthropicRequest(p: AiProvider, key: string | null, c: AiCall) {
  return {
    url: `${p.baseUrl}/v1/messages`,
    headers: { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' },
    body: { model: p.model, max_tokens: c.maxTokens ?? DEFAULT_MAX_TOKENS, system: c.system, messages: [{ role: 'user', content: c.user }] },
  };
}
function openaiRequest(p: AiProvider, key: string | null, c: AiCall) {
  return {
    url: `${p.baseUrl}/v1/chat/completions`,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: { model: p.model, max_tokens: c.maxTokens ?? DEFAULT_MAX_TOKENS, messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }] },
  };
}

interface Parsed { text: string; model: string; inputTokens: number; outputTokens: number; refused: boolean }
function parseAnthropic(j: unknown): Parsed {
  const o = j as { model?: string; content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (o.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  return { text, model: o.model ?? '', inputTokens: o.usage?.input_tokens ?? 0, outputTokens: o.usage?.output_tokens ?? 0, refused: o.stop_reason === 'refusal' };
}
function parseOpenai(j: unknown): Parsed {
  const o = j as { model?: string; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const choice = o.choices?.[0];
  return { text: choice?.message?.content ?? '', model: o.model ?? '', inputTokens: o.usage?.prompt_tokens ?? 0, outputTokens: o.usage?.completion_tokens ?? 0, refused: choice?.finish_reason === 'content_filter' };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/ai/providers.test.ts`
Expected: 6 tests pass. If `fetchUpstream` rejects the stubbed 301 before returning it, read `server/routes/proxy.ts` around `followRedirects` — with `false` it returns the raw 3xx, which `!resp.ok` then classifies.

- [ ] **Step 5: Commit**

```bash
git add server/ai/providers.ts server/ai/providers.test.ts
git commit -m "feat(ai): anthropic and openai-compatible adapters behind the SSRF guard"
```

---

### Task 5: Résolution du fournisseur et de la clé

**Files:**
- Create: `server/ai/resolve.ts`, `server/ai/resolve.test.ts`

**Interfaces:**
- Consumes: `AiProvider`.
- Produces:
  - `interface Availability { provider: AiProvider; key: string | null; paidByAdmin: boolean }` — un fournisseur utilisable par CET utilisateur, avec la clé retenue.
  - `availableFor(providers: AiProvider[], keys: { user: (id: number) => string | null; admin: (id: number) => string | null }): Availability[]` — règle : clé personnelle sinon clé admin si `shared` ; un fournisseur `openai` sans aucune clé est disponible sans clé (Ollama) ; un fournisseur `anthropic` sans clé est indisponible.
  - `resolveProvider(input: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null }, available: Availability[]): Availability | null` — premier étage dont l'id est disponible, sinon le premier disponible.
  - `fallbackOrder(first: Availability, available: Availability[]): Availability[]` — `first` puis les autres dans l'ordre `position`, sans doublon.

- [ ] **Step 1: Write the failing test**

```ts
// server/ai/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { availableFor, resolveProvider, fallbackOrder } from './resolve.js';
import type { AiProvider } from './store.js';

const P = (id: number, type: 'anthropic' | 'openai', hasAdminKey: boolean, shared: boolean): AiProvider =>
  ({ id, name: `P${id}`, type, baseUrl: 'https://x', model: 'm', hasAdminKey, shared, position: id });

describe('availableFor', () => {
  it('personal key beats the admin key; shared admin key serves everyone; none → unavailable', () => {
    const providers = [P(1, 'anthropic', true, true), P(2, 'anthropic', true, false), P(3, 'anthropic', false, false)];
    const avail = availableFor(providers, { user: (id) => (id === 2 ? 'mine' : null), admin: (id) => (id === 3 ? null : `admin${id}`) });
    expect(avail.map((a) => [a.provider.id, a.key, a.paidByAdmin])).toEqual([[1, 'admin1', true], [2, 'mine', false]]);
  });
  it('an openai provider without any key (Ollama) is available to all, unpaid', () => {
    const avail = availableFor([P(9, 'openai', false, false)], { user: () => null, admin: () => null });
    expect(avail).toHaveLength(1);
    expect(avail[0].key).toBeNull();
    expect(avail[0].paidByAdmin).toBe(false);
  });
});

describe('resolveProvider', () => {
  const avail = availableFor([P(1, 'openai', false, false), P(2, 'openai', false, false), P(3, 'openai', false, false)], { user: () => null, admin: () => null });
  it('force > feed > category > preferred > admin default', () => {
    expect(resolveProvider({ force: 3, feed: 2, category: 1, preferred: 1, adminDefault: 1 }, avail)!.provider.id).toBe(3);
    expect(resolveProvider({ feed: 2, category: 1, preferred: 1, adminDefault: 1 }, avail)!.provider.id).toBe(2);
    expect(resolveProvider({ category: 1, preferred: 2, adminDefault: 3 }, avail)!.provider.id).toBe(1);
    expect(resolveProvider({ preferred: 2, adminDefault: 3 }, avail)!.provider.id).toBe(2);
    expect(resolveProvider({ adminDefault: 3 }, avail)!.provider.id).toBe(3);
  });
  it('skips a stage naming a provider that is gone or unavailable, then takes the first available', () => {
    expect(resolveProvider({ feed: 42, adminDefault: 99 }, avail)!.provider.id).toBe(1);
    expect(resolveProvider({}, [])).toBeNull();
  });
});

describe('fallbackOrder', () => {
  it('first, then the others by position, no duplicate', () => {
    const avail = availableFor([P(1, 'openai', false, false), P(2, 'openai', false, false), P(3, 'openai', false, false)], { user: () => null, admin: () => null });
    expect(fallbackOrder(avail[1], avail).map((a) => a.provider.id)).toEqual([2, 1, 3]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/ai/resolve.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implement**

```ts
// server/ai/resolve.ts
import type { AiProvider } from './store.js';

export interface Availability { provider: AiProvider; key: string | null; paidByAdmin: boolean }

/** Clé personnelle, sinon clé admin partagée ; `openai` sans clé reste utilisable (Ollama). */
export function availableFor(
  providers: AiProvider[],
  keys: { user: (id: number) => string | null; admin: (id: number) => string | null },
): Availability[] {
  const out: Availability[] = [];
  for (const provider of providers) {
    const mine = keys.user(provider.id);
    if (mine) { out.push({ provider, key: mine, paidByAdmin: false }); continue; }
    const admin = provider.shared ? keys.admin(provider.id) : null;
    if (admin) { out.push({ provider, key: admin, paidByAdmin: true }); continue; }
    if (provider.type === 'openai' && !provider.hasAdminKey) out.push({ provider, key: null, paidByAdmin: false });
  }
  return out;
}

/** Spec §6 : forçage > flux > catégorie > préféré > défaut admin ; un étage muet ou indisponible est sauté. */
export function resolveProvider(
  input: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null },
  available: Availability[],
): Availability | null {
  for (const id of [input.force, input.feed, input.category, input.preferred, input.adminDefault]) {
    if (!id) continue;
    const hit = available.find((a) => a.provider.id === id);
    if (hit) return hit;
  }
  return available[0] ?? null;
}

export function fallbackOrder(first: Availability, available: Availability[]): Availability[] {
  return [first, ...available.filter((a) => a.provider.id !== first.provider.id)];
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/ai/resolve.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ai/resolve.ts server/ai/resolve.test.ts
git commit -m "feat(ai): provider and key resolution"
```

---

### Task 6: Orchestration du résumé (plafond, cache, repli, usage)

**Files:**
- Create: `server/ai/summarize.ts`, `server/ai/summarize.test.ts`

**Interfaces:**
- Consumes: `callProvider`, `AiCall` (tâche 4) ; `Availability`, `resolveProvider`, `fallbackOrder` (tâche 5) ; `aiCacheKey/Get/Set`, `usageToday`, `bumpUsage`, `dailyCap` (tâche 3) ; `SUMMARY_SYSTEM` ; `splitLangLine`, `htmlToText`, `AiError`.
- Produces:
  - `interface SummaryRequest { userId: number; articleId: string; title: string; html: string; resolution: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null }; available: Availability[]; fallback: boolean }`
  - `interface SummaryResponse { text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }`
  - `summarize(req: SummaryRequest, deps?: { call?: typeof callProvider }): Promise<SummaryResponse>` — lève `AiError('technical', 'article_too_short')` sous 40 mots, `AiError('quota', 'ai_daily_cap')` au plafond (seulement quand `paidByAdmin`), `AiError('technical', 'no_provider')` sans fournisseur disponible.
  - `MIN_WORDS = 40`.

- [ ] **Step 1: Write the failing test**

```ts
// server/ai/summarize.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db, { setSetting } from '../db.js';
import { summarize } from './summarize.js';
import { AiError } from './errors.js';
import type { Availability } from './resolve.js';
import type { AiProvider } from './store.js';

const P = (id: number, name: string): AiProvider => ({ id, name, type: 'openai', baseUrl: 'https://x', model: 'm', hasAdminKey: false, shared: false, position: id });
const A = (id: number, name: string, paidByAdmin = false): Availability => ({ provider: P(id, name), key: paidByAdmin ? 'admin' : null, paidByAdmin });
const html = '<p>' + 'mot '.repeat(60) + '</p>';
const base = { userId: 41, articleId: 'art-1', title: 'T', html, resolution: { adminDefault: 1 }, fallback: true };

beforeEach(() => {
  db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (41, 'sum-user', 'user')").run();
  setSetting('ai_daily_cap', '2');
});

describe('summarize', () => {
  it('calls the resolved provider with the article text and strips the lang line', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nRésumé.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    const r = await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(r).toMatchObject({ text: 'Résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', fromCache: false });
    expect(call.mock.calls[0][2].user).toContain('mot mot');
    expect(call.mock.calls[0][2].user).toContain('T');
  });
  it('serves the cache on the second call without calling the provider', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nRésumé.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    const again = await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(again.fromCache).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('falls back on a technical error and reports where it came from', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new AiError('technical', 'down'))
      .mockResolvedValueOnce({ text: 'lang: en\n\nOk.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    const r = await summarize({ ...base, available: [A(1, 'Claude'), A(2, 'Ollama')] }, { call });
    expect(r.providerName).toBe('Ollama');
    expect(r.fellBackFrom).toBe('Claude');
  });
  it('never falls back after a refusal, nor when fallback is off', async () => {
    const refusing = vi.fn().mockRejectedValue(new AiError('refused', 'no'));
    await expect(summarize({ ...base, available: [A(1, 'A'), A(2, 'B')] }, { call: refusing })).rejects.toMatchObject({ kind: 'refused' });
    expect(refusing).toHaveBeenCalledTimes(1);
    const failing = vi.fn().mockRejectedValue(new AiError('technical', 'down'));
    await expect(summarize({ ...base, fallback: false, available: [A(1, 'A'), A(2, 'B')] }, { call: failing })).rejects.toMatchObject({ kind: 'technical' });
    expect(failing).toHaveBeenCalledTimes(1);
  });
  it('counts the daily cap only when the admin key pays', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nR.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
    for (const id of ['x1', 'x2']) await summarize({ ...base, articleId: id, available: [A(1, 'Paid', true)] }, { call });
    await expect(summarize({ ...base, articleId: 'x3', available: [A(1, 'Paid', true)] }, { call })).rejects.toMatchObject({ kind: 'quota', message: 'ai_daily_cap' });
    await expect(summarize({ ...base, articleId: 'x4', available: [A(2, 'Free')] }, { call })).resolves.toBeTruthy();
  });
  it('refuses a too-short article before any call', async () => {
    const call = vi.fn();
    await expect(summarize({ ...base, html: '<p>trop court</p>', available: [A(1, 'A')] }, { call })).rejects.toMatchObject({ message: 'article_too_short' });
    expect(call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/ai/summarize.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implement**

```ts
// server/ai/summarize.ts
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import { resolveProvider, fallbackOrder, type Availability } from './resolve.js';
import { aiCacheKey, aiCacheGet, aiCacheSet, usageToday, bumpUsage, dailyCap } from './store.js';
import { SUMMARY_SYSTEM } from './prompts.js';
import { splitLangLine } from './lang.js';
import { htmlToText } from './text.js';

export const MIN_WORDS = 40;

export interface SummaryRequest {
  userId: number; articleId: string; title: string; html: string;
  resolution: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null };
  available: Availability[];
  fallback: boolean;
}
export interface SummaryResponse {
  text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string;
}

/**
 * Spec §6 et §9. Ordre : taille de l'article, résolution, cache, plafond
 * (clé admin seulement), appel, repli (jamais sur `refused`, un seul tour),
 * usage, cache.
 */
export async function summarize(req: SummaryRequest, deps: { call?: typeof callProvider } = {}): Promise<SummaryResponse> {
  const call = deps.call ?? callProvider;
  const text = htmlToText(req.html);
  if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) throw new AiError('technical', 'article_too_short');

  const first = resolveProvider(req.resolution, req.available);
  if (!first) throw new AiError('technical', 'no_provider');
  const candidates = req.fallback ? fallbackOrder(first, req.available) : [first];

  let fellBackFrom: string | undefined;
  let lastError: AiError | null = null;
  for (const cand of candidates) {
    const key = aiCacheKey({ articleId: req.articleId, op: 'summary', providerId: cand.provider.id });
    const cached = await aiCacheGet(key);
    if (cached) return { ...cached, providerId: cand.provider.id, providerName: cand.provider.name, model: cand.provider.model, fromCache: true, fellBackFrom };

    const cap = dailyCap();
    if (cand.paidByAdmin && cap > 0 && usageToday(req.userId) >= cap) throw new AiError('quota', 'ai_daily_cap');

    try {
      const result = await call(cand.provider, cand.key, { system: SUMMARY_SYSTEM, user: `Title: ${req.title}\n\n${text}` });
      if (cand.paidByAdmin) bumpUsage(req.userId);
      const { lang, text: body } = splitLangLine(result.text);
      await aiCacheSet(key, { text: body, lang });
      return { text: body, lang, providerId: cand.provider.id, providerName: cand.provider.name, model: result.model, fromCache: false, fellBackFrom };
    } catch (err) {
      if (!(err instanceof AiError)) throw new AiError('technical', (err as Error).message);
      if (err.kind === 'refused' || !req.fallback) throw err;
      lastError = err;
      fellBackFrom = fellBackFrom ?? cand.provider.name;
    }
  }
  throw lastError ?? new AiError('technical', 'no_provider');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/ai/summarize.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ai/summarize.ts server/ai/summarize.test.ts
git commit -m "feat(ai): summary orchestration with cap, cache and fallback"
```

---

### Task 7: Routes utilisateur et admin

**Files:**
- Create: `server/routes/ai.ts`, `server/routes/adminAi.ts`
- Modify: `server/index.ts` (imports lignes 8-14, montage lignes 64-71)
- Test: `server/test/ai.test.ts` (ajouter les blocs ci-dessous)

**Interfaces:**
- Consumes: tout `server/ai/*`, `requireAuth`, `requireAdmin`, `proxyRateLimiter`.
- Produces (contrat client, repris tel quel par la tâche 9) :
  - `GET /api/ai/config` → `{ enabled: boolean, providers: { id, name, type, hasAdminKey, shared, hasUserKey, available }[], userKeysAllowed, dailyCap, usageToday, defaultProvider: number | null }`. Quand `enabled` est faux : `{ enabled: false, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null }` — pas de 404, le client a besoin de savoir.
  - `POST /api/ai/summary` `{ articleId, title, html, provider?, feedProvider?, categoryProvider?, preferredProvider?, fallback? }` → `SummaryResponse` ; 404 `{ error: 'ai_disabled' }` ; 400 `{ error: 'article_too_short' | 'invalid_body' }` ; 429 `{ error: 'ai_daily_cap' }` ; 502 `{ error: 'ai_failed', kind, provider }` ; 422 `{ error: 'ai_refused', provider }`.
  - Admin : `GET /api/admin/ai/providers` → `{ providers: AiProvider[], settings: { enabled, userKeysAllowed, dailyCap, defaultProvider } }` ; `POST /api/admin/ai/providers` (ProviderInput) → `{ provider }` ; `PUT /api/admin/ai/providers/:id` → `{ provider }` ; `DELETE /api/admin/ai/providers/:id` → `{ ok }` ; `PUT /api/admin/ai/providers/order` `{ ids }` → `{ ok }` ; `PUT /api/admin/ai/settings` `{ enabled?, userKeysAllowed?, dailyCap?, defaultProvider? }` → `{ ok }` ; `POST /api/admin/ai/providers/:id/test` → `{ ok: true, model, durationMs }` ou `{ ok: false, kind, message }` (200 dans les deux cas : c'est un diagnostic).

- [ ] **Step 1: Write the failing tests** (ajouter à `server/test/ai.test.ts`, sous les imports : `import { vi, afterEach } from 'vitest';` est à fusionner avec l'import existant)

```ts
function stubProvider(text = 'lang: fr\n\nRésumé long.') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    text: async () => '', json: async () => ({ model: 'm', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
const longHtml = '<p>' + 'mot '.repeat(80) + '</p>';

describe('ai routes while disabled', () => {
  it('config says disabled and summary is 404', async () => {
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body).toMatchObject({ enabled: false, providers: [] });
    const sum = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'a', title: 't', html: longHtml });
    expect(sum.status).toBe(404);
    expect(sum.body.error).toBe('ai_disabled');
  });
  it('admin routes refuse a plain user', async () => {
    const res = await request(app).get('/api/admin/ai/providers').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

describe('ai admin + summary', () => {
  let providerId: number;
  it('admin creates a provider, the key never comes back', async () => {
    const res = await request(app).post('/api/admin/ai/providers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ollama', type: 'openai', baseUrl: 'https://ollama.example.com/', model: 'llama3', adminKey: 'secret-k', shared: true });
    expect(res.status).toBe(201);
    providerId = res.body.provider.id;
    expect(res.body.provider.hasAdminKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('secret-k');
    expect(res.body.provider.baseUrl).toBe('https://ollama.example.com');
  });
  it('admin enables the feature and sets the default', async () => {
    const res = await request(app).put('/api/admin/ai/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, defaultProvider: providerId, dailyCap: 5 });
    expect(res.status).toBe(200);
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body.enabled).toBe(true);
    expect(cfg.body.providers[0]).toMatchObject({ id: providerId, name: 'Ollama', available: true, hasUserKey: false });
    expect(JSON.stringify(cfg.body)).not.toContain('secret-k');
  });
  it('user gets a summary, then the cached one', async () => {
    const fetchMock = stubProvider();
    const first = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'art-route-1', title: 'Titre', html: longHtml });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ text: 'Résumé long.', lang: 'fr', providerName: 'Ollama', fromCache: false });
    const second = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'art-route-1', title: 'Titre', html: longHtml });
    expect(second.body.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cfgUsage(userToken)).resolves.toBe(1);
  });
  it('rejects a short article with 400 and a bad body with 400', async () => {
    const short = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'a2', title: 't', html: '<p>court</p>' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('article_too_short');
    const bad = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`).send({ title: 't' });
    expect(bad.status).toBe(400);
  });
  it('the test route reports a failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => 'nope', json: async () => ({}) }));
    const res = await request(app).post(`/api/admin/ai/providers/${providerId}/test`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, kind: 'auth' });
  });
  it('deleting the default provider leaves config consistent', async () => {
    const del = await request(app).delete(`/api/admin/ai/providers/${providerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body.providers).toEqual([]);
    expect(cfg.body.defaultProvider).toBeNull();
  });
});

async function cfgUsage(token: string): Promise<number> {
  const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${token}`);
  return cfg.body.usageToday as number;
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/test/ai.test.ts`
Expected: the new blocks fail with 404 on every `/api/ai/*` and `/api/admin/ai/*` route.

- [ ] **Step 3: Implement the user router**

```ts
// server/routes/ai.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { proxyRateLimiter } from './proxy.js';
import {
  listProviders, adminKeyFor, userKeyFor, hasUserKey, usageToday, dailyCap, isAiEnabled, userKeysAllowed, defaultProviderId,
} from '../ai/store.js';
import { availableFor } from '../ai/resolve.js';
import { summarize } from '../ai/summarize.js';
import { AiError } from '../ai/errors.js';

const router = Router();
router.use(requireAuth);
// Même seau que /api/proxy et /api/extract : un appel IA est une sortie du backend.
if (proxyRateLimiter) router.use(proxyRateLimiter);

const MAX_HTML_BYTES = 200 * 1024;

function availability(userId: number) {
  return availableFor(listProviders(), { user: (id) => userKeyFor(userId, id), admin: (id) => adminKeyFor(id) });
}

router.get('/config', (req, res) => {
  if (!isAiEnabled()) {
    return res.json({ enabled: false, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null });
  }
  const avail = new Set(availability(req.user.id).map((a) => a.provider.id));
  const providers = listProviders().map((p) => ({
    id: p.id, name: p.name, type: p.type, hasAdminKey: p.hasAdminKey, shared: p.shared,
    hasUserKey: hasUserKey(req.user.id, p.id), available: avail.has(p.id),
  }));
  const def = defaultProviderId();
  res.json({
    enabled: true, providers, userKeysAllowed: userKeysAllowed(), dailyCap: dailyCap(), usageToday: usageToday(req.user.id),
    defaultProvider: def && providers.some((p) => p.id === def) ? def : null,
  });
});

const asId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

router.post('/summary', async (req, res) => {
  if (!isAiEnabled()) return res.status(404).json({ error: 'ai_disabled' });
  const { articleId, title, html, provider, feedProvider, categoryProvider, preferredProvider, fallback } = req.body ?? {};
  if (typeof articleId !== 'string' || !articleId || typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML_BYTES) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const out = await summarize({
      userId: req.user.id, articleId, title: typeof title === 'string' ? title : '', html,
      resolution: { force: asId(provider), feed: asId(feedProvider), category: asId(categoryProvider), preferred: asId(preferredProvider), adminDefault: defaultProviderId() },
      available: availability(req.user.id),
      fallback: fallback !== false,
    });
    res.json(out);
  } catch (err) {
    if (!(err instanceof AiError)) { console.error('AI summary error:', err); return res.status(500).json({ error: 'ai_failed' }); }
    if (err.message === 'article_too_short') return res.status(400).json({ error: 'article_too_short' });
    if (err.message === 'ai_daily_cap') return res.status(429).json({ error: 'ai_daily_cap', cap: dailyCap() });
    if (err.message === 'no_provider') return res.status(409).json({ error: 'no_provider' });
    if (err.kind === 'refused') return res.status(422).json({ error: 'ai_refused' });
    console.error('AI summary failed:', err.kind, err.message);
    res.status(502).json({ error: 'ai_failed', kind: err.kind });
  }
});

export default router;
```

- [ ] **Step 4: Implement the admin router**

```ts
// server/routes/adminAi.ts
import { Router } from 'express';
import { setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  listProviders, getProvider, createProvider, updateProvider, deleteProvider, reorderProviders, adminKeyFor,
  isAiEnabled, userKeysAllowed, dailyCap, defaultProviderId, type ProviderInput,
} from '../ai/store.js';
import { callProvider } from '../ai/providers.js';
import { AiError } from '../ai/errors.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const TYPES = ['anthropic', 'openai'];
function parseInput(body: unknown, partial: boolean): ProviderInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : undefined);
  const name = str('name'), type = str('type'), baseUrl = str('baseUrl'), model = str('model');
  if (!partial && (!name || !type || !baseUrl || !model)) return null;
  if (type !== undefined && !TYPES.includes(type)) return null;
  if (baseUrl !== undefined && !/^https?:\/\//i.test(baseUrl)) return null;
  const out: Partial<ProviderInput> = {};
  if (name !== undefined) out.name = name;
  if (type !== undefined) out.type = type as ProviderInput['type'];
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  if (model !== undefined) out.model = model;
  if (b.adminKey !== undefined) out.adminKey = typeof b.adminKey === 'string' ? b.adminKey : null;
  if (b.shared !== undefined) out.shared = b.shared === true;
  return out as ProviderInput;
}
const settingsView = () => ({ enabled: isAiEnabled(), userKeysAllowed: userKeysAllowed(), dailyCap: dailyCap(), defaultProvider: defaultProviderId() });

router.get('/ai/providers', (_req, res) => res.json({ providers: listProviders(), settings: settingsView() }));

router.post('/ai/providers', (req, res) => {
  const input = parseInput(req.body, false);
  if (!input) return res.status(400).json({ error: 'invalid_provider' });
  res.status(201).json({ provider: createProvider(input) });
});

router.put('/ai/providers/order', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((n: unknown) => Number.isInteger(n)) : null;
  if (!ids) return res.status(400).json({ error: 'invalid_order' });
  reorderProviders(ids);
  res.json({ ok: true });
});

router.put('/ai/providers/:id', (req, res) => {
  const input = parseInput(req.body, true);
  if (!input) return res.status(400).json({ error: 'invalid_provider' });
  const p = updateProvider(Number(req.params.id), input);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ provider: p });
});

router.delete('/ai/providers/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!deleteProvider(id)) return res.status(404).json({ error: 'not_found' });
  if (defaultProviderId() === id) setSetting('ai_default_provider', '');
  res.json({ ok: true });
});

router.post('/ai/providers/:id/test', async (req, res) => {
  const p = getProvider(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not_found' });
  try {
    const r = await callProvider(p, adminKeyFor(p.id), { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16 });
    res.json({ ok: true, model: r.model, durationMs: r.durationMs });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('technical', (err as Error).message);
    res.json({ ok: false, kind: e.kind, message: e.message.slice(0, 200) });
  }
});

router.put('/ai/settings', (req, res) => {
  const { enabled, userKeysAllowed: uk, dailyCap: cap, defaultProvider } = req.body ?? {};
  if (enabled !== undefined) setSetting('ai_enabled', enabled ? 'true' : 'false');
  if (uk !== undefined) setSetting('ai_user_keys_allowed', uk ? 'true' : 'false');
  if (cap !== undefined) {
    if (!Number.isInteger(cap) || cap < 0) return res.status(400).json({ error: 'invalid_cap' });
    setSetting('ai_daily_cap', String(cap));
  }
  if (defaultProvider !== undefined) {
    if (defaultProvider !== null && !getProvider(Number(defaultProvider))) return res.status(400).json({ error: 'unknown_provider' });
    setSetting('ai_default_provider', defaultProvider === null ? '' : String(defaultProvider));
  }
  res.json({ ok: true, settings: settingsView() });
});

export default router;
```

Dans `server/index.ts` : ajouter `import aiRoutes from './routes/ai.js';` et `import adminAiRoutes from './routes/adminAi.js';` à la suite des imports de routes, puis `app.use('/api/ai', aiRoutes);` et `app.use('/api/admin', adminAiRoutes);` après `app.use('/api/extract', extractRoutes);`. L'ordre des deux `/api/admin` n'importe pas : les chemins ne se recouvrent pas.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/test/ai.test.ts && npx vitest run src/lib/featuresDoc.test.ts`
Expected: `ai.test.ts` passes. `featuresDoc.test.ts` **fails** listing the nine new routes — attendu, la tâche 15 les documente ; ne pas committer avant qu'il soit vert ou committer les deux ensemble (choisir : documenter maintenant les routes dans la table « Routes serveur » de `docs/FEATURES.md`, voir tâche 15 pour les lignes exactes, et committer le tout).

- [ ] **Step 6: Commit**

```bash
git add server/routes/ai.ts server/routes/adminAi.ts server/index.ts server/test/ai.test.ts docs/FEATURES.md
git commit -m "feat(ai): user and admin routes"
```

---

### Task 8: Banc local (faux fournisseur compatible OpenAI)

**Files:**
- Create (hors dépôt, dans le scratchpad de la session) : `fake-openai.mjs`

Pas de test unitaire : c'est un outil pour dérouler le socle de bout en bout sans dépenser. Il n'est **pas** commité (`scripts/` est copié dans l'image).

- [ ] **Step 1: Write the fake provider**

```js
// fake-openai.mjs — `node fake-openai.mjs` → http://127.0.0.1:9998
import http from 'node:http';
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    console.log(new Date().toISOString(), req.method, req.url, req.headers.authorization ? 'auth' : 'no-auth', body.length + 'B');
    if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end(); }
    if (req.headers.authorization === 'Bearer bad') { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
    const words = (JSON.parse(body).messages.at(-1).content.match(/\S+/g) || []).length;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'fake-1', choices: [{ message: { content: `lang: fr\n\nFaux résumé de ${words} mots.\n\nSecond paragraphe.` }, finish_reason: 'stop' }], usage: { prompt_tokens: words, completion_tokens: 12 } }));
  });
}).listen(9998, '127.0.0.1', () => console.log('fake openai on http://127.0.0.1:9998'));
```

- [ ] **Step 2: Run the server against it**

```bash
node fake-openai.mjs &
PORT=3105 FRIRSS_DATA_DIR=$PWD/data-bench npx tsx server/index.ts &
# inscrire l'admin, créer le fournisseur (type openai, baseUrl http://127.0.0.1:9998), activer, résumer :
T=$(curl -s -X POST localhost:3105/api/auth/register -H 'content-type: application/json' -d '{"username":"root","password":"secret123","email":"root@example.com"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST localhost:3105/api/admin/ai/providers -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"name":"Fake","type":"openai","baseUrl":"http://127.0.0.1:9998","model":"fake-1","adminKey":"ok","shared":true}'
curl -s -X PUT localhost:3105/api/admin/ai/settings -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"enabled":true,"defaultProvider":1,"dailyCap":3}'
curl -s -X POST localhost:3105/api/ai/summary -H "authorization: Bearer $T" -H 'content-type: application/json' -d "{\"articleId\":\"b1\",\"title\":\"T\",\"html\":\"<p>$(printf 'mot %.0s' $(seq 60))</p>\"}"
```
Expected: `fromCache:false` puis, en rejouant, `fromCache:true` ; après trois articles distincts, `429 ai_daily_cap` ; avec `"adminKey":"bad"` sur le fournisseur, `502 ai_failed kind:auth`. Note : `127.0.0.1` est joignable **sans** `PROXY_INTERNAL_HOSTS` — c'est précisément l'exemption `trustedHosts` qu'on vérifie.

- [ ] **Step 3: Stop the bench**

```bash
pkill -f "tsx server/index.ts"; pkill -f fake-openai.mjs; rm -rf data-bench
```

Rien à committer.

---

### Task 9: Client — fonctions d'API et `aiStore`

**Files:**
- Modify: `src/api/backend.ts` (après `updateAdminSettings`)
- Create: `src/stores/aiStore.ts`, `src/stores/aiStore.test.ts`
- Modify: `src/lib/prefsSync.ts` (dans `hydratePrefs`, après `startSync();`)

**Interfaces:**
- Produces (client) :
  - `interface AiProviderView { id: number; name: string; type: 'anthropic' | 'openai'; hasAdminKey: boolean; shared: boolean; hasUserKey: boolean; available: boolean }`
  - `interface AiConfig { enabled: boolean; providers: AiProviderView[]; userKeysAllowed: boolean; dailyCap: number; usageToday: number; defaultProvider: number | null }`
  - `interface AiSummaryResult { text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }`
  - `getAiConfig(): Promise<AiConfig>`, `requestAiSummary(body: { articleId: string; title: string; html: string; provider?: number }): Promise<AiSummaryResult>`
  - Admin : `getAiProviders(): Promise<{ providers: AiProviderAdmin[]; settings: AiAdminSettings }>`, `createAiProvider(input)`, `updateAiProvider(id, input)`, `deleteAiProvider(id)`, `reorderAiProviders(ids)`, `testAiProvider(id): Promise<{ ok: boolean; model?: string; durationMs?: number; kind?: string; message?: string }>`, `updateAiSettings(s: Partial<AiAdminSettings>)`, avec `interface AiProviderAdmin { id; name; type; baseUrl; model; hasAdminKey; shared; position }` et `interface AiAdminSettings { enabled: boolean; userKeysAllowed: boolean; dailyCap: number; defaultProvider: number | null }`.
  - `useAiStore`: `{ config: AiConfig | null; load: () => Promise<void>; reset: () => void }` ; `aiEnabled(): boolean` sélecteur pur sur `config?.enabled === true`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/aiStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/backend', () => ({ getAiConfig: vi.fn() }));
import { getAiConfig } from '../api/backend';
import { useAiStore } from './aiStore';

beforeEach(() => useAiStore.getState().reset());

describe('aiStore', () => {
  it('starts with no config and loads it', async () => {
    expect(useAiStore.getState().config).toBeNull();
    vi.mocked(getAiConfig).mockResolvedValue({ enabled: true, providers: [], userKeysAllowed: false, dailyCap: 50, usageToday: 0, defaultProvider: null });
    await useAiStore.getState().load();
    expect(useAiStore.getState().config?.enabled).toBe(true);
  });
  it('a failed load leaves the feature off, never throws', async () => {
    vi.mocked(getAiConfig).mockRejectedValue(new Error('network'));
    await expect(useAiStore.getState().load()).resolves.toBeUndefined();
    expect(useAiStore.getState().config?.enabled ?? false).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stores/aiStore.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implement**

Ajouter à `src/api/backend.ts` :

```ts
// ── Résumés IA ──────────────────────────────────────────────────────
export interface AiProviderView { id: number; name: string; type: 'anthropic' | 'openai'; hasAdminKey: boolean; shared: boolean; hasUserKey: boolean; available: boolean }
export interface AiConfig { enabled: boolean; providers: AiProviderView[]; userKeysAllowed: boolean; dailyCap: number; usageToday: number; defaultProvider: number | null }
export interface AiSummaryResult { text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }
export interface AiProviderAdmin { id: number; name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; hasAdminKey: boolean; shared: boolean; position: number }
export interface AiAdminSettings { enabled: boolean; userKeysAllowed: boolean; dailyCap: number; defaultProvider: number | null }
export interface AiProviderInput { name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; adminKey?: string | null; shared?: boolean }

export async function getAiConfig(): Promise<AiConfig> {
  const { data } = await backend.get<AiConfig>('/ai/config');
  return data;
}
export async function requestAiSummary(body: { articleId: string; title: string; html: string; provider?: number }): Promise<AiSummaryResult> {
  const { data } = await backend.post<AiSummaryResult>('/ai/summary', body);
  return data;
}
export async function getAiProviders(): Promise<{ providers: AiProviderAdmin[]; settings: AiAdminSettings }> {
  const { data } = await backend.get<{ providers: AiProviderAdmin[]; settings: AiAdminSettings }>('/admin/ai/providers');
  return data;
}
export async function createAiProvider(input: AiProviderInput): Promise<AiProviderAdmin> {
  const { data } = await backend.post<{ provider: AiProviderAdmin }>('/admin/ai/providers', input);
  return data.provider;
}
export async function updateAiProvider(id: number, input: Partial<AiProviderInput>): Promise<AiProviderAdmin> {
  const { data } = await backend.put<{ provider: AiProviderAdmin }>(`/admin/ai/providers/${id}`, input);
  return data.provider;
}
export async function deleteAiProvider(id: number): Promise<void> {
  await backend.delete(`/admin/ai/providers/${id}`);
}
export async function reorderAiProviders(ids: number[]): Promise<void> {
  await backend.put('/admin/ai/providers/order', { ids });
}
export async function testAiProvider(id: number): Promise<{ ok: boolean; model?: string; durationMs?: number; kind?: string; message?: string }> {
  const { data } = await backend.post(`/admin/ai/providers/${id}/test`);
  return data;
}
export async function updateAiSettings(settings: Partial<AiAdminSettings>): Promise<void> {
  await backend.put('/admin/ai/settings', settings);
}
```

```ts
// src/stores/aiStore.ts
import { create } from 'zustand';
import { getAiConfig, type AiConfig } from '../api/backend';

/**
 * Ce que le client sait de l'IA : rien tant que `load()` n'a pas répondu, et
 * « éteint » si la requête échoue — un réseau en panne ne doit pas faire
 * apparaître de pastille. Rechargé après chaque connexion (prefsSync) et
 * après chaque sauvegarde du bloc admin.
 */
interface AiState {
  config: AiConfig | null;
  load: () => Promise<void>;
  reset: () => void;
}
const OFF: AiConfig = { enabled: false, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null };

export const useAiStore = create<AiState>()((set) => ({
  config: null,
  load: async () => {
    try { set({ config: await getAiConfig() }); } catch { set({ config: OFF }); }
  },
  reset: () => set({ config: null }),
}));

export const aiEnabled = (s: AiState): boolean => s.config?.enabled === true;
```

Dans `src/lib/prefsSync.ts`, importer `import { useAiStore } from '../stores/aiStore';` et, dans `hydratePrefs()`, juste après `startSync();` : `void useAiStore.getState().load();`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/stores/aiStore.test.ts src/lib/prefsSync.test.ts` (ce dernier s'il existe ; sinon `npx vitest run src/lib`)
Expected: pass. `npm run typecheck` vert.

- [ ] **Step 5: Commit**

```bash
git add src/api/backend.ts src/stores/aiStore.ts src/stores/aiStore.test.ts src/lib/prefsSync.ts
git commit -m "feat(ai): client API and config store"
```

---

### Task 10: Composant `AiSummary` (pastille + bloc)

**Files:**
- Create: `src/components/ReadingPane/AiSummary.tsx`, `src/components/ReadingPane/AiSummary.test.tsx`

Invoquer le skill `frontend-design` **avant** d'écrire le JSX de ce composant : la pastille doit se distinguer des autres sans crier (demande du propriétaire), le bloc est une surface neutre, pas une teinte. Les classes ci-dessous sont un point de départ, pas la décision finale.

**Interfaces:**
- Consumes: `AiSummaryResult`, `AiProviderView`.
- Produces: `interface AiSummaryProps { status: 'idle' | 'loading' | 'done' | 'error'; result: AiSummaryResult | null; error: string | null; providers: AiProviderView[]; onSummarize: (providerId?: number) => void; onHide: () => void; disabled?: boolean }` ; `export default function AiSummary(props)`.
- Comportement : la pastille porte `title`/`aria-label` « Résumé IA » ; au repos un clic appelle `onSummarize()` ; en `loading` elle est `disabled` avec un spinner et « Résumé… » ; en `done` elle est active, un clic appelle `onHide()` ; le bloc affiche l'en-tête « Résumé par {providerName} » (+ « · depuis le cache » si `fromCache`, + « {fellBackFrom} indisponible » si repli), un menu « Résumer avec… » listant `providers.filter(p => p.available)` (bouton par fournisseur → `onSummarize(id)`), et le texte en paragraphes (`split('\n\n')`). Le menu se rend par portail sous `<body>` (règle du projet) — réutiliser le moule de `SavedCategoryPicker` pour le positionnement, ou `BottomSheet` sur mobile (`useBreakpoint`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ReadingPane/AiSummary.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import AiSummary from './AiSummary';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k) }) }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
afterEach(cleanup);

const providers: AiProviderView[] = [
  { id: 1, name: 'Claude', type: 'anthropic', hasAdminKey: true, shared: true, hasUserKey: false, available: true },
  { id: 2, name: 'Ollama', type: 'openai', hasAdminKey: false, shared: false, hasUserKey: false, available: true },
  { id: 3, name: 'Privé', type: 'anthropic', hasAdminKey: true, shared: false, hasUserKey: false, available: false },
];
const result: AiSummaryResult = { text: 'Premier.\n\nSecond.', lang: 'fr', providerId: 2, providerName: 'Ollama', model: 'm', fromCache: false, fellBackFrom: 'Claude' };
const noop = () => {};

describe('AiSummary', () => {
  it('idle: the chip asks for a summary with the default provider', () => {
    const onSummarize = vi.fn();
    const { getByRole } = render(<AiSummary status="idle" result={null} error={null} providers={providers} onSummarize={onSummarize} onHide={noop} />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onSummarize).toHaveBeenCalledWith(undefined);
  });
  it('loading: the chip is disabled', () => {
    const { getByRole } = render(<AiSummary status="loading" result={null} error={null} providers={providers} onSummarize={noop} onHide={noop} />);
    expect((getByRole('button', { name: 'ai.summarize' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('done: shows provider, fallback notice, paragraphs, and only available providers in the menu', () => {
    const onSummarize = vi.fn();
    const { getByText, getByRole, queryByText } = render(<AiSummary status="done" result={result} error={null} providers={providers} onSummarize={onSummarize} onHide={noop} />);
    expect(getByText('ai.by:Ollama')).toBeTruthy();
    expect(getByText('ai.fellBack:Claude')).toBeTruthy();
    expect(getByText('Premier.')).toBeTruthy();
    expect(getByText('Second.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(queryByText('Privé')).toBeNull();
    fireEvent.click(getByText('Claude'));
    expect(onSummarize).toHaveBeenCalledWith(1);
  });
  it('done: clicking the chip hides the block', () => {
    const onHide = vi.fn();
    const { getByRole } = render(<AiSummary status="done" result={result} error={null} providers={providers} onSummarize={noop} onHide={onHide} />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onHide).toHaveBeenCalledOnce();
  });
  it('error: the message is shown and the chip retries', () => {
    const onSummarize = vi.fn();
    const { getByText, getByRole } = render(<AiSummary status="error" result={null} error="ai.errors.auth" providers={providers} onSummarize={onSummarize} onHide={noop} />);
    expect(getByText('ai.errors.auth')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(onSummarize).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/ReadingPane/AiSummary.test.tsx`
Expected: FAIL — module absent.

- [ ] **Step 3: Implement** (après le passage par `frontend-design` ; squelette fonctionnel)

```tsx
// src/components/ReadingPane/AiSummary.tsx
import { useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import BottomSheet from '../BottomSheet';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

export interface AiSummaryProps {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: AiSummaryResult | null;
  error: string | null;
  providers: AiProviderView[];
  onSummarize: (providerId?: number) => void;
  onHide: () => void;
  disabled?: boolean;
}

/**
 * La pastille « Résumé IA » et le bloc qui s'ouvre dessous (spec §11).
 * Un seul emplacement sur les trois formats ; les actions rares (« Résumer
 * avec… ») n'apparaissent qu'une fois un résumé produit.
 */
export default function AiSummary({ status, result, error, providers, onSummarize, onHide, disabled }: AiSummaryProps) {
  const { t } = useTranslation();
  const isMobile = useBreakpoint() !== 'desktop';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const available = providers.filter((p) => p.available);
  const done = status === 'done' && result;

  const chip = (
    <button
      type="button"
      onClick={() => (done ? onHide() : onSummarize())}
      disabled={disabled || status === 'loading'}
      title={t('ai.summarize')}
      aria-label={t('ai.summarize')}
      aria-pressed={!!done}
      className="ai-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all"
      style={{
        color: done ? 'var(--on-accent)' : 'var(--accent)',
        background: done ? 'var(--accent)' : 'var(--accent-glow)',
        border: '1.5px solid color-mix(in srgb, var(--accent) 35%, transparent)',
      }}
    >
      {status === 'loading' ? <Spinner /> : <Sparkle />}
      <span>{status === 'loading' ? t('ai.summarizing') : t('ai.summarize')}</span>
    </button>
  );

  const menuItems = available.map((p) => (
    <button key={p.id} type="button" onClick={() => { setMenuOpen(false); onSummarize(p.id); }}
      className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-black/5" style={{ color: 'var(--list-title)' }}>
      {p.name}
    </button>
  ));

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">{chip}</div>
      {status === 'error' && error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
      {done && (
        <section className="mt-3 rounded-lg px-4 py-3" style={{ background: 'var(--list-active)', border: '1px solid var(--panel-border)' }} aria-label={t('ai.summaryTitle')}>
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mb-2" style={{ color: 'var(--reading-meta)' }}>
            <span>{t('ai.by', { name: result.providerName })}</span>
            {result.fromCache && <span>· {t('ai.fromCache')}</span>}
            {result.fellBackFrom && <span>· {t('ai.fellBack', { name: result.fellBackFrom })}</span>}
            <button ref={menuAnchor} type="button" onClick={() => setMenuOpen((o) => !o)} className="underline" aria-haspopup="menu" aria-expanded={menuOpen}>
              {t('ai.withProvider')}
            </button>
          </header>
          {result.text.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="text-sm leading-relaxed mb-2 last:mb-0" style={{ color: 'var(--reading-text)' }}>{p}</p>
          ))}
        </section>
      )}
      {menuOpen && (isMobile
        ? <BottomSheet open onClose={() => setMenuOpen(false)} title={t('ai.withProvider')}>{menuItems}</BottomSheet>
        : createPortal(<Popover anchor={menuAnchor.current} onClose={() => setMenuOpen(false)}>{menuItems}</Popover>, document.body))}
    </div>
  );
}

function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const r = anchor?.getBoundingClientRect();
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden="true" />
      <div role="menu" className="fixed z-[61] min-w-[180px] rounded-lg p-1 shadow-lg"
        style={{ top: (r?.bottom ?? 0) + 4, left: r?.left ?? 0, background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}>
        {children}
      </div>
    </>
  );
}
function Spinner() {
  return <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>;
}
function Sparkle() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>;
}
```

Le popover est volontairement minimal ; si `clampToViewport` (`src/lib/clampToViewport.ts`) convient, l'utiliser pour qu'un menu ouvert près du bord droit ne sorte pas de l'écran.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/ReadingPane/AiSummary.test.tsx`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReadingPane/AiSummary.tsx src/components/ReadingPane/AiSummary.test.tsx
git commit -m "feat(ai): summary chip and block component"
```

---

### Task 11: Branchement dans `ReadingPane`

**Files:**
- Modify: `src/components/ReadingPane/ReadingPane.tsx` — imports (lignes 1-25), états (après la ligne 151 `const lastExtractedId = useRef…`), un `useEffect` de remise à zéro, un `handleSummarize`, et le rendu juste **avant** le bloc `{/* Extraction error */}` (ligne ~1227).
- Test: `src/components/ReadingPane/ReadingPane.ai.test.tsx`

**Interfaces:**
- Consumes: `AiSummary` (tâche 10), `useAiStore`, `aiEnabled` (tâche 9), `requestAiSummary`.
- Produit un seul fait observable : la pastille n'existe que si `aiEnabled` ; une requête en vol par article ; l'article qui change pendant la requête ne reçoit pas le résumé du précédent.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ReadingPane/ReadingPane.ai.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }) }));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn() }));
vi.mock('../../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)), listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()), subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()), queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useAiStore } from '../../stores/aiStore';
import { requestAiSummary } from '../../api/backend';

const article = (id: string) => ({
  id, title: 'Titre ' + id, summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>' + 'mot '.repeat(60) + '</p>', url: 'https://example.com/' + id,
  published: Date.now(), read: false, starred: false, labels: [],
} as unknown as Article);
const ON = { enabled: true, providers: [{ id: 1, name: 'Ollama', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true }], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };

beforeEach(() => {
  useFeedStore.setState({ selectedArticle: article('a1'), articles: [article('a1'), article('a2')] });
  useAiStore.setState({ config: ON });
});
afterEach(cleanup);

describe('ReadingPane — Résumé IA', () => {
  it('shows no chip when the feature is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false, providers: [] } });
    const { queryByRole } = render(<ReadingPane />);
    expect(queryByRole('button', { name: 'ai.summarize' })).toBeNull();
  });
  it('requests a summary with the article id, title and html, then shows it', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1', title: 'Titre a1', html: expect.stringContaining('mot') }));
    expect(await findByText('Le résumé.')).toBeTruthy();
  });
  it('ignores a summary that arrives after the article changed', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(requestAiSummary).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { getByRole, queryByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    await act(async () => { resolve({ text: 'Résumé de a1', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false }); });
    await waitFor(() => expect(queryByText('Résumé de a1')).toBeNull());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/ReadingPane/ReadingPane.ai.test.tsx`
Expected: le 1er passe (rien n'existe), les deux autres échouent (« Unable to find role button ai.summarize »).

- [ ] **Step 3: Wire the pane**

Imports à ajouter en tête de `ReadingPane.tsx` :

```ts
import AiSummary from './AiSummary';
import { useAiStore, aiEnabled } from '../../stores/aiStore';
import { requestAiSummary, type AiSummaryResult } from '../../api/backend';
import axios from 'axios';
```

États, après `const lastExtractedId = useRef<string | null>(null);` :

```ts
  // Résumé IA — un état par article affiché ; remis à zéro quand il change.
  const aiOn = useAiStore(aiEnabled);
  const aiProviders = useAiStore((s) => s.config?.providers ?? []);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiResult, setAiResult] = useState<AiSummaryResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiInFlight = useRef<string | null>(null);

  useEffect(() => {
    setAiStatus('idle'); setAiResult(null); setAiError(null); aiInFlight.current = null;
  }, [selectedArticle?.id]);
```

Le gestionnaire, à placer après `handleExtract` :

```ts
  const handleSummarize = useCallback(async (providerId?: number) => {
    if (!selectedArticle || aiInFlight.current === selectedArticle.id) return;
    const id = selectedArticle.id;
    aiInFlight.current = id;
    setAiStatus('loading'); setAiError(null);
    try {
      const r = await requestAiSummary({
        articleId: id, title: selectedArticle.title,
        html: extractedContent?.content ?? selectedArticle.content ?? '',
        provider: providerId,
      });
      if (useFeedStore.getState().selectedArticle?.id !== id) return;
      setAiResult(r); setAiStatus('done');
    } catch (err) {
      if (useFeedStore.getState().selectedArticle?.id !== id) return;
      const code = axios.isAxiosError(err) ? (err.response?.data as { error?: string; kind?: string } | undefined) : undefined;
      const key = code?.error === 'ai_daily_cap' ? 'ai.errors.cap'
        : code?.error === 'article_too_short' ? 'ai.errors.tooShort'
        : code?.error === 'ai_refused' ? 'ai.errors.refused'
        : code?.error === 'no_provider' ? 'ai.errors.noProvider'
        : code?.kind === 'auth' ? 'ai.errors.auth'
        : code?.kind === 'quota' ? 'ai.errors.quota'
        : 'ai.errors.technical';
      setAiError(t(key)); setAiStatus('error');
    } finally {
      if (aiInFlight.current === id) aiInFlight.current = null;
    }
  }, [selectedArticle, extractedContent, t]);
```

Rendu, juste avant `{/* Extraction error */}` :

```tsx
          {aiOn && (
            <AiSummary
              status={aiStatus} result={aiResult} error={aiError} providers={aiProviders}
              onSummarize={handleSummarize}
              onHide={() => { setAiStatus('idle'); setAiResult(null); }}
              disabled={typeof navigator !== 'undefined' && navigator.onLine === false}
            />
          )}
```

Le `useEffect` de remise à zéro doit être déclaré **avant** le `return null` anticipé du composant (les hooks se comptent) : le placer avec les autres états, pas plus bas.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/ReadingPane/ && npm run typecheck`
Expected: pass, y compris `ReadingPane.body.test.tsx` (son mock de `../../api/backend` doit aussi exporter `getAiConfig` et `requestAiSummary` — l'ajouter, sinon « No "getAiConfig" export is defined on the mock »).

- [ ] **Step 5: Commit**

```bash
git add src/components/ReadingPane/ReadingPane.tsx src/components/ReadingPane/ReadingPane.ai.test.tsx src/components/ReadingPane/ReadingPane.body.test.tsx
git commit -m "feat(ai): summary chip in the reading pane"
```

---

### Task 12: Section « IA » des Préférences — bloc admin « Fournisseurs »

**Files:**
- Create: `src/components/Preferences/AiTab.tsx`, `src/components/Preferences/AiTab.test.tsx`
- Modify: `src/components/Preferences/Preferences.tsx` (ligne 94 `SECTIONS`, ligne 95 `sections`, bloc des `Pane` lignes 325-340)

Invoquer `frontend-design` avant le JSX : deux blocs clairs, le bloc admin en dernier, « Avancé » sous un pli. Les blocs utilisateur (préféré, repli, par flux, clés) sont le **plan 2** ; ici la section ne contient que le bloc admin, et pour un non-admin un texte « Les résumés IA sont prêts : cliquez « Résumé IA » dans un article » (`ai.userIntro`).

**Interfaces:**
- Consumes: `getAiProviders`, `createAiProvider`, `updateAiProvider`, `deleteAiProvider`, `reorderAiProviders`, `testAiProvider`, `updateAiSettings`, `useAiStore().load`.
- Produces: `export default function AiTab({ active }: { active?: boolean })`. Dans `Preferences.tsx`, la section `ai` apparaît dans la navigation si `aiEnabled || isAdmin`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/Preferences/AiTab.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(),
}));
import { getAiProviders, createAiProvider, updateAiSettings, testAiProvider } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import AiTab from './AiTab';

const admin = { id: 1, username: 'root', role: 'admin' as const };
const user = { id: 2, username: 'alice', role: 'user' as const };
beforeEach(() => {
  vi.mocked(getAiProviders).mockResolvedValue({ providers: [], settings: { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
});
afterEach(cleanup);

describe('AiTab', () => {
  it('a plain user sees the intro, never the providers block', async () => {
    useAuthStore.setState({ backendUser: user });
    const { findByText, queryByText } = render(<AiTab active />);
    expect(await findByText('ai.userIntro')).toBeTruthy();
    expect(queryByText('ai.admin.title')).toBeNull();
    expect(getAiProviders).not.toHaveBeenCalled();
  });
  it('the admin toggles the feature on', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(updateAiSettings).mockResolvedValue();
    const { findByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('switch', { name: 'ai.admin.enable' }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ enabled: true }));
  });
  it('the admin adds a provider; the key field is cleared after saving', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(createAiProvider).mockResolvedValue({ id: 7, name: 'Ollama', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3', hasAdminKey: false, shared: false, position: 0 });
    const { findByRole, getByLabelText, findByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    fireEvent.change(getByLabelText('ai.admin.name'), { target: { value: 'Ollama' } });
    fireEvent.change(getByLabelText('ai.admin.baseUrl'), { target: { value: 'http://ollama:11434' } });
    fireEvent.change(getByLabelText('ai.admin.model'), { target: { value: 'llama3' } });
    fireEvent.click(await findByRole('button', { name: 'ai.admin.save' }));
    await waitFor(() => expect(createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ollama', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3' })));
    expect(await findByText('Ollama')).toBeTruthy();
    expect((getByLabelText('ai.admin.key') as HTMLInputElement).value).toBe('');
  });
  it('the test button reports the outcome', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [{ id: 7, name: 'Ollama', type: 'openai', baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: false, position: 0 }], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(testAiProvider).mockResolvedValue({ ok: false, kind: 'auth', message: 'HTTP 401' });
    const { findByRole, findByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.test' }));
    expect(await findByText('ai.admin.testFailed')).toBeTruthy();
  });
});
```

Et dans `src/components/Preferences/Preferences.header.test.tsx` (ou un nouveau `Preferences.ai.test.tsx` sur le même moule), un test : « la section `preferences.sections.ai` est absente de la navigation pour un utilisateur quand `config.enabled` est faux, présente pour l'admin ».

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/Preferences/AiTab.test.tsx`
Expected: FAIL — module absent.

- [ ] **Step 3: Implement the tab**

```tsx
// src/components/Preferences/AiTab.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';
import ToggleSwitch from '../ToggleSwitch';
import {
  getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, reorderAiProviders, testAiProvider, updateAiSettings,
  type AiProviderAdmin, type AiAdminSettings, type AiProviderInput,
} from '../../api/backend';

const EMPTY: AiProviderInput = { name: '', type: 'openai', baseUrl: '', model: '', adminKey: '', shared: true };

/**
 * Section « IA » (spec §10). Plan 1 : le bloc admin « Fournisseurs » seul ;
 * les blocs utilisateur arrivent avec le plan 2. Rien n'est chargé pour un
 * non-admin : les routes lui sont fermées, inutile de les appeler.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  if (!isAdmin) {
    return <p className="text-sm" style={{ color: 'var(--list-summary)' }}>{t('ai.userIntro')}</p>;
  }
  return <AdminProviders active={active} />;
}

function AdminProviders({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const reloadConfig = useAiStore((s) => s.load);
  const [providers, setProviders] = useState<AiProviderAdmin[]>([]);
  const [settings, setSettings] = useState<AiAdminSettings>({ enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null });
  const [editing, setEditing] = useState<{ id: number | null; draft: AiProviderInput } | null>(null);
  const [testResult, setTestResult] = useState<Record<number, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    getAiProviders().then((r) => { setProviders(r.providers); setSettings(r.settings); }).catch(() => setError(t('ai.admin.loadError')));
  }, [active, t]);

  async function saveSettings(patch: Partial<AiAdminSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    await updateAiSettings(patch);
    void reloadConfig();
  }
  async function saveProvider() {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim() || !d.baseUrl.trim() || !d.model.trim()) { setError(t('ai.admin.missingFields')); return; }
    setError('');
    const payload: Partial<AiProviderInput> = { ...d, adminKey: d.adminKey === '' ? undefined : d.adminKey };
    const saved = editing.id === null ? await createAiProvider(payload as AiProviderInput) : await updateAiProvider(editing.id, payload);
    setProviders((list) => (editing.id === null ? [...list, saved] : list.map((p) => (p.id === saved.id ? saved : p))));
    setEditing(null);
    void reloadConfig();
  }
  async function remove(id: number) {
    await deleteAiProvider(id);
    setProviders((l) => l.filter((p) => p.id !== id));
    if (settings.defaultProvider === id) setSettings((s) => ({ ...s, defaultProvider: null }));
    void reloadConfig();
  }
  async function move(id: number, dir: -1 | 1) {
    const ids = providers.map((p) => p.id);
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setProviders(ids.map((x) => providers.find((p) => p.id === x)!));
    await reorderAiProviders(ids);
  }
  async function test(id: number) {
    setTestResult((r) => ({ ...r, [id]: t('ai.admin.testing') }));
    const r = await testAiProvider(id);
    setTestResult((m) => ({ ...m, [id]: r.ok ? t('ai.admin.testOk') : t('ai.admin.testFailed') }));
  }

  const field = (label: string, key: keyof AiProviderInput, type = 'text') => (
    <label className="block text-xs" style={{ color: 'var(--list-summary)' }}>
      {label}
      <input type={type} value={(editing?.draft[key] as string) ?? ''} aria-label={label}
        onChange={(e) => setEditing((ed) => ed && ({ ...ed, draft: { ...ed.draft, [key]: e.target.value } }))}
        className="mt-0.5 w-full px-3 py-1.5 text-sm rounded-md"
        style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }} />
    </label>
  );

  return (
    <div className="space-y-6">
      <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
        <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full" style={{ background: 'var(--accent)' }} />
        {t('ai.admin.title')}
      </h3>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.enable')}</span>
        <ToggleSwitch checked={settings.enabled} onChange={(v) => saveSettings({ enabled: v })} ariaLabel={t('ai.admin.enable')} />
      </div>
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}

      <ul className="space-y-2">
        {providers.map((p, i) => (
          <li key={p.id} className="rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid var(--panel-border)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium" style={{ color: 'var(--list-title)' }}>{p.name}</span>
              <span className="text-xs opacity-70">{p.type} · {p.model}{p.hasAdminKey ? ` · ${t('ai.admin.keySet')}` : ''}</span>
              <span className="ml-auto flex gap-1">
                <button type="button" aria-label={t('ai.admin.moveUp')} disabled={i === 0} onClick={() => move(p.id, -1)}>↑</button>
                <button type="button" aria-label={t('ai.admin.moveDown')} disabled={i === providers.length - 1} onClick={() => move(p.id, 1)}>↓</button>
                <button type="button" onClick={() => test(p.id)}>{t('ai.admin.test')}</button>
                <button type="button" onClick={() => setEditing({ id: p.id, draft: { name: p.name, type: p.type, baseUrl: p.baseUrl, model: p.model, adminKey: '', shared: p.shared } })}>{t('ai.admin.edit')}</button>
                <button type="button" onClick={() => remove(p.id)} style={{ color: 'var(--danger)' }}>{t('ai.admin.delete')}</button>
              </span>
            </div>
            {testResult[p.id] && <p className="text-xs mt-1" style={{ color: 'var(--list-summary)' }}>{testResult[p.id]}</p>}
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--panel-header-bg)' }}>
          {field(t('ai.admin.name'), 'name')}
          <label className="block text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('ai.admin.type')}
            <select value={editing.draft.type} aria-label={t('ai.admin.type')} className="mt-0.5 w-full px-3 py-1.5 text-sm rounded-md"
              onChange={(e) => setEditing((ed) => ed && ({ ...ed, draft: { ...ed.draft, type: e.target.value as 'anthropic' | 'openai' } }))}>
              <option value="openai">{t('ai.admin.typeOpenai')}</option>
              <option value="anthropic">{t('ai.admin.typeAnthropic')}</option>
            </select>
          </label>
          {field(t('ai.admin.baseUrl'), 'baseUrl', 'url')}
          {field(t('ai.admin.model'), 'model')}
          {field(t('ai.admin.key'), 'adminKey', 'password')}
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--list-title)' }}>
            <input type="checkbox" checked={!!editing.draft.shared} onChange={(e) => setEditing((ed) => ed && ({ ...ed, draft: { ...ed.draft, shared: e.target.checked } }))} />
            {t('ai.admin.shared')}
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={saveProvider} className="px-3 py-1.5 text-xs font-semibold rounded-md" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{t('ai.admin.save')}</button>
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs rounded-md">{t('ai.admin.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing({ id: null, draft: { ...EMPTY } })} className="px-3 py-1.5 text-xs font-semibold rounded-md" style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}>
          {t('ai.admin.add')}
        </button>
      )}

      <label className="block text-xs" style={{ color: 'var(--list-summary)' }}>
        {t('ai.admin.defaultProvider')}
        <select value={settings.defaultProvider ?? ''} aria-label={t('ai.admin.defaultProvider')} className="mt-0.5 w-full px-3 py-1.5 text-sm rounded-md"
          onChange={(e) => saveSettings({ defaultProvider: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('ai.admin.none')}</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="text-xs underline" style={{ color: 'var(--list-summary)' }}>
        {t('ai.admin.advanced')}
      </button>
      {advanced && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.admin.userKeysAllowed')}</span>
            <ToggleSwitch checked={settings.userKeysAllowed} onChange={(v) => saveSettings({ userKeysAllowed: v })} ariaLabel={t('ai.admin.userKeysAllowed')} />
          </div>
          <label className="block text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('ai.admin.dailyCap')}
            <input type="number" min={0} value={settings.dailyCap} aria-label={t('ai.admin.dailyCap')}
              onChange={(e) => saveSettings({ dailyCap: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              className="mt-0.5 w-32 px-3 py-1.5 text-sm rounded-md" style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }} />
            <span className="block mt-1 opacity-70">{t('ai.admin.dailyCapHint')}</span>
          </label>
        </div>
      )}
    </div>
  );
}
```

`ToggleSwitch` rend un bouton `role="switch"` ? Vérifier dans `src/components/ToggleSwitch.tsx` ; si c'est `aria-pressed` sur un `button`, adapter le test (`getByRole('button', { name })`).

Dans `Preferences.tsx` :

```ts
  const aiOn = useAiStore(aiEnabled);
  const SECTIONS = ['general', 'appearance', 'layout', 'labels', 'feeds', 'offline', ...((aiOn || isAdmin) ? ['ai'] as const : [])] as const;
```
(ou un tableau construit en deux temps si TypeScript renâcle sur le spread conditionnel — `const SECTIONS: readonly string[]`), import `AiTab` et `useAiStore, aiEnabled`, et le `Pane` :

```tsx
          {(aiOn || isAdmin) && visited.has('ai') && (
            <Pane id="ai" tab={tab}><AiTab active={tab === 'ai'} /></Pane>
          )}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/Preferences/ && npm run typecheck`
Expected: pass. `settingsCoverage.test.ts` reste vert (aucune clé retirée).

- [ ] **Step 5: Commit**

```bash
git add src/components/Preferences/AiTab.tsx src/components/Preferences/AiTab.test.tsx src/components/Preferences/Preferences.tsx src/components/Preferences/Preferences.header.test.tsx
git commit -m "feat(ai): IA preferences section with the admin providers block"
```

---

### Task 13: Dix locales — famille `ai` et `preferences.sections.ai`

**Files:**
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`
- Test: `src/lib/i18nCoverage.test.ts` (existant) + la commande de parité du `CLAUDE.md`

Les clés sont exactement celles consommées par les tâches 10 à 12. Le français est la source ; l'anglais ci-dessous ; les huit autres locales reçoivent une traduction soignée de chaque valeur (pas de copie de l'anglais). Édition par script Node, jamais à la main.

- [ ] **Step 1: Run the coverage test to see it fail**

Run: `npx vitest run src/lib/i18nCoverage.test.ts`
Expected: FAIL — clés `ai.*` et `preferences.sections.ai` utilisées dans le code, absentes des locales.

- [ ] **Step 2: Add the keys with a script**

```js
// à exécuter : node add-ai-locales.mjs (dans le scratchpad, pas dans le dépôt)
import fs from 'node:fs';
const fr = {
  summarize: 'Résumé IA', summarizing: 'Résumé…', summaryTitle: 'Résumé',
  by: 'Résumé par {{name}}', fromCache: 'depuis le cache', fellBack: '{{name}} indisponible',
  withProvider: 'Résumer avec…', userIntro: 'Les résumés IA sont prêts : ouvrez un article et cliquez « Résumé IA ».',
  errors: {
    auth: 'Clé refusée par le fournisseur. Vérifiez-la dans Préférences › IA.',
    quota: 'Quota du fournisseur atteint. Réessayez plus tard.',
    cap: 'Limite quotidienne de résumés atteinte.',
    tooShort: 'Article trop court pour être résumé.',
    refused: 'Le fournisseur a refusé de résumer cet article.',
    noProvider: 'Aucun fournisseur disponible.',
    technical: 'Le fournisseur n’a pas répondu. Réessayez.',
  },
  admin: {
    title: 'Fournisseurs', enable: 'Activer les résumés IA', add: 'Ajouter un fournisseur', edit: 'Modifier', delete: 'Supprimer',
    save: 'Enregistrer', cancel: 'Annuler', test: 'Tester', testing: 'Test en cours…', testOk: 'Connexion réussie', testFailed: 'Échec : vérifiez l’URL, le modèle et la clé',
    name: 'Nom', type: 'Type', typeOpenai: 'Compatible OpenAI (OpenAI, Ollama, Mistral, OpenRouter…)', typeAnthropic: 'Anthropic (Claude)',
    baseUrl: 'URL de base', model: 'Modèle', key: 'Clé d’API (laisser vide pour conserver)', keySet: 'clé enregistrée',
    shared: 'Partager cette clé avec les utilisateurs', defaultProvider: 'Fournisseur par défaut', none: 'Aucun',
    moveUp: 'Monter', moveDown: 'Descendre', advanced: 'Avancé', userKeysAllowed: 'Les utilisateurs peuvent saisir leur propre clé',
    dailyCap: 'Plafond quotidien par utilisateur', dailyCapHint: 'Compte seulement les appels payés par votre clé. 0 = illimité.',
    missingFields: 'Nom, URL et modèle sont obligatoires.', loadError: 'Impossible de charger les fournisseurs.',
  },
};
const en = {
  summarize: 'AI summary', summarizing: 'Summarising…', summaryTitle: 'Summary',
  by: 'Summary by {{name}}', fromCache: 'from cache', fellBack: '{{name}} unavailable',
  withProvider: 'Summarise with…', userIntro: 'AI summaries are ready: open an article and click “AI summary”.',
  errors: {
    auth: 'Key rejected by the provider. Check it in Preferences › AI.',
    quota: 'Provider quota reached. Try again later.',
    cap: 'Daily summary limit reached.',
    tooShort: 'Article too short to summarise.',
    refused: 'The provider declined to summarise this article.',
    noProvider: 'No provider available.',
    technical: 'The provider did not answer. Try again.',
  },
  admin: {
    title: 'Providers', enable: 'Enable AI summaries', add: 'Add a provider', edit: 'Edit', delete: 'Delete',
    save: 'Save', cancel: 'Cancel', test: 'Test', testing: 'Testing…', testOk: 'Connection OK', testFailed: 'Failed: check the URL, model and key',
    name: 'Name', type: 'Type', typeOpenai: 'OpenAI-compatible (OpenAI, Ollama, Mistral, OpenRouter…)', typeAnthropic: 'Anthropic (Claude)',
    baseUrl: 'Base URL', model: 'Model', key: 'API key (leave empty to keep)', keySet: 'key set',
    shared: 'Share this key with users', defaultProvider: 'Default provider', none: 'None',
    moveUp: 'Move up', moveDown: 'Move down', advanced: 'Advanced', userKeysAllowed: 'Users may enter their own key',
    dailyCap: 'Daily cap per user', dailyCapHint: 'Counts only calls paid with your key. 0 = unlimited.',
    missingFields: 'Name, URL and model are required.', loadError: 'Could not load the providers.',
  },
};
const sections = { fr: 'IA', en: 'AI', de: 'KI', es: 'IA', it: 'IA', nl: 'AI', pl: 'AI', pt: 'IA', uk: 'ШІ', zh: 'AI' };
const translated = { fr, en /* de, es, it, nl, pl, pt, uk, zh : même structure, valeurs traduites — à écrire ici avant d'exécuter */ };
for (const l of Object.keys(sections)) {
  const p = `src/locales/${l}.json`;
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!translated[l]) throw new Error(`traduction manquante pour ${l}`);
  o.ai = translated[l];
  o.preferences.sections.ai = sections[l];
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
}
```

Compléter `translated` pour les huit autres locales **avant** d'exécuter (le script refuse sinon). Soigner le polonais et l'ukrainien ; aucun pluriel dans cette famille, donc pas de formes `_one/_other`.

- [ ] **Step 3: Verify parity and coverage**

Run: la commande de parité du `CLAUDE.md` (section « Vérifier la parité des traductions »), puis `npx vitest run src/lib/i18nCoverage.test.ts src/lib/featuresDoc.test.ts`
Expected: « parité ok (10 locales …) » ; `i18nCoverage` vert ; `featuresDoc` **rouge** sur la famille `ai` jusqu'à la tâche 14.

- [ ] **Step 4: Sweep the visible attributes**

`grep -n "title=\|aria-label=\|placeholder=" src/components/ReadingPane/AiSummary.tsx src/components/Preferences/AiTab.tsx` : chaque valeur passe par `t()`. Aucune chaîne littérale.

- [ ] **Step 5: Commit**

```bash
git add src/locales/*.json
git commit -m "i18n(ai): summary and provider strings in the ten locales"
```

---

### Task 14: Documentation — inventaire, sécurité, journal de release

**Files:**
- Modify: `docs/FEATURES.md` (nouvelle famille après « Extraction du contenu complet » ; table « Routes serveur » ; liste « Familles de traductions »), `SECURITY.md` (après « The OIDC issuer is trusted by the anti-SSRF guard »), `docs/RELEASE-NEXT.md`.

- [ ] **Step 1: Write the FEATURES family**

Insérer avant `### Extraction du contenu complet` :

```markdown
### Résumés par IA
Un bouton « Résumé IA » dans le volet de lecture envoie le texte de l'article
à un fournisseur de modèle de langage et affiche le résumé au-dessus de
l'article. **Éteint d'origine** : tant que l'admin n'a pas activé la
fonctionnalité (Préférences → IA → Fournisseurs), rien n'est visible, pas même
la section pour un utilisateur. Spec :
`docs/superpowers/specs/2026-10-15-ai-summaries-design.md`. Demandé dans la
discussion #22.

- **Où** : `server/ai/` (adaptateurs `providers.ts`, résolution `resolve.ts`,
  orchestration `summarize.ts`, store `store.ts`), routes `server/routes/ai.ts`
  et `server/routes/adminAi.ts`, client `src/stores/aiStore.ts`,
  `src/components/ReadingPane/AiSummary.tsx`,
  `src/components/Preferences/AiTab.tsx`. Traductions : famille `ai`.
- **Deux adaptateurs, jamais plus** : `anthropic` (Messages API) et `openai`
  (`/v1/chat/completions`), qui couvre OpenAI, Ollama, LM Studio, Mistral,
  Groq, DeepSeek, Grok, OpenRouter, Gemini. Ajouter un fournisseur = l'admin
  saisit une URL de base, un modèle, une clé éventuelle. Un fournisseur sans
  point d'accès compatible OpenAI passe par OpenRouter.
- **Clés** : chiffrées en base (`server/crypto.ts`, comme les jetons FreshRSS),
  jamais renvoyées par l'API (`hasAdminKey` / `hasUserKey`). Clé personnelle
  (plan 2) > clé admin partagée > fournisseur indisponible ; un `openai` sans
  clé (Ollama) est disponible pour tous.
- **Appels sortants** : `fetchUpstream` avec `trustedHosts: [hôte du
  fournisseur]` (même exemption que l'émetteur OIDC : URL fixée par l'admin),
  `followRedirects: false`, délai 60 s. Les appels comptent dans le seau
  `FRIRSS_PROXY_RATE_LIMIT`.
- **Résolution** (`resolve.ts`, pure, testée) : forçage ponctuel > flux >
  catégorie > préféré > défaut admin ; un étage muet ou indisponible est sauté.
- **Repli** : sur erreur `auth` / `quota` / `technical` seulement, dans l'ordre
  de l'admin, jamais sur `refused`, un seul tour ; la réponse dit d'où on vient
  (`fellBackFrom`).
- **Plafond** (`ai_daily_cap`, défaut 50, 0 = illimité) : par utilisateur et
  jour civil, compté **seulement quand la clé admin paie**.
- **Cache** : clé article + opération + fournisseur + langue + version de
  consigne (`PROMPT_VERSION`) ; Redis si `REDIS_URL`, sinon table `ai_cache`
  purgée au-delà de 10 000 lignes.
- **Langue** : le résumé est dans la langue de l'article ; le modèle rend
  `lang: <code>` en première ligne, retirée et conservée (`lang.ts`) pour la
  traduction (plan 3).
- **Pièges** : la pastille est désactivée hors ligne ; un article de moins de
  40 mots est refusé avant tout appel (`article_too_short`) ; un 3xx du
  fournisseur est une erreur technique, jamais suivi (aucun secret ne part vers
  l'hôte de redirection) ; `stop_reason: refusal` / `finish_reason:
  content_filter` = `refused`, pas de repli.
- **Réglages serveur** (`settings`) : `ai_enabled`, `ai_user_keys_allowed`,
  `ai_daily_cap`, `ai_default_provider`. Tables : `ai_providers`,
  `ai_user_keys`, `ai_usage`, `ai_cache`.
```

- [ ] **Step 2: Add the routes to the table and the family to the list**

Dans la table « Routes serveur », après `| PUT | \`/api/admin/settings\` | … |` :

```markdown
| GET | `/api/ai/config` | Ce que le client sait de l'IA (fournisseurs sans clés, plafond, usage) |
| POST | `/api/ai/summary` | Résumer un article |
| GET | `/api/admin/ai/providers` | Lister fournisseurs et réglages IA |
| POST | `/api/admin/ai/providers` | Créer un fournisseur |
| PUT | `/api/admin/ai/providers/order` | Réordonner les fournisseurs |
| PUT | `/api/admin/ai/providers/:id` | Modifier un fournisseur |
| DELETE | `/api/admin/ai/providers/:id` | Supprimer un fournisseur |
| POST | `/api/admin/ai/providers/:id/test` | Appel d'essai |
| PUT | `/api/admin/ai/settings` | Interrupteur, politique des clés, plafond, défaut |
```

Dans « Familles de traductions », ajouter `· \`ai\`` en fin de liste.

- [ ] **Step 3: SECURITY.md and RELEASE-NEXT.md**

`SECURITY.md`, nouvelle sous-section après celle de l'émetteur OIDC :

```markdown
### AI providers: admin-set endpoints, encrypted keys

AI summaries (off by default) call a provider the **administrator** declared:
its host is trusted by the anti-SSRF guard exactly like the OIDC issuer, so a
model on the LAN (Ollama) works without `PROXY_INTERNAL_HOSTS`; redirects are
never followed, so a key is never sent to a host the admin did not type.
Users never set an endpoint. API keys are encrypted at rest with the instance
key and never returned by any route. The daily cap only limits what the
admin's shared key pays for.
```

`docs/RELEASE-NEXT.md`, sous « Fonctionnalités » :

```markdown
- **Résumés par IA** (discussion #22). Un bouton « Résumé IA » dans le volet
  envoie l'article au fournisseur que l'admin a déclaré (Claude, ou tout
  service compatible OpenAI dont Ollama) et affiche le résumé au-dessus de
  l'article. Éteint d'origine ; nouvelle section « IA » des Préférences avec le
  bloc admin « Fournisseurs » (interrupteur, fournisseurs, clé partagée, test de
  connexion, plafond quotidien). Repli automatique entre fournisseurs, cache
  des résumés, clés chiffrées, aucune dépendance nouvelle.
```

- [ ] **Step 4: Run the guards**

Run: `npx vitest run src/lib/featuresDoc.test.ts src/lib/i18nCoverage.test.ts`
Expected: vert.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md SECURITY.md docs/RELEASE-NEXT.md
git commit -m "docs(ai): inventory, security note and release log for AI summaries"
```

---

### Task 15: Vérification de bout en bout et sur trois formats

**Files:** aucun nouveau.

- [ ] **Step 1: Full gates**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`, puis le garde-fou de fuite.
Expected: tout vert, sortie du garde-fou vide.

- [ ] **Step 2: Local bench through the real UI**

Relancer le banc de la tâche 8 (faux fournisseur + serveur sur 3105) et `npm run dev:client` ; se connecter, Préférences → IA : créer le fournisseur « Fake » (`http://127.0.0.1:9998`, modèle `fake-1`, clé `ok`, partagée), « Tester » → « Connexion réussie », activer, défaut. Ouvrir un article → la pastille « Résumé IA » → le bloc « Résumé par Fake », deux paragraphes. Rouvrir le même article → « depuis le cache ». Mettre la clé `bad` → « Clé refusée… ». Vérifier la console du navigateur : aucune erreur.

- [ ] **Step 3: Three form factors**

Avec les outils du projet (navigateur de test, puis émulateur Android à 320 px pour le téléphone) : la pastille tient dans la rangée à 320 px sans débordement horizontal ; le bloc est lisible ; le menu « Résumer avec… » s'ouvre en feuille du bas sur mobile et en popover sur desktop, sans sortir de l'écran ; la section « IA » est accessible dans les Préférences mobiles (liste des sections → écran). Mesurer avec `getBoundingClientRect()` : aucune largeur > `innerWidth`.

- [ ] **Step 4: Push the branch and show the owner**

```bash
git push -u origin ai-summaries
```

Puis demander au propriétaire un déploiement de `frirss-test` sur l'image de la branche **s'il le souhaite** (le workflow ne publie que `dev`, `main` et les tags : une image de branche demande une décision), sinon la démonstration se fait sur le banc local. Ne pas fusionner dans `dev` : c'est sa décision.

---

## Après ce plan

- **Plan 2** (`2026-10-15-ai-summaries-user.md`, à écrire une fois ce plan livré) : blocs utilisateur de la section IA (préféré, repli, résumé automatique avec l'avertissement de coût, par flux et catégorie, clés personnelles, usage du jour), préférences synchronisées `ai.*` dans `uiStore`, champ `aiProvider` de `FeedSetting`, raccourci clavier et palette.
- **Plan 3** (`2026-10-15-ai-translation.md`) : traduction du résumé puis de l'article, liste figée des 28 langues, `Intl.DisplayNames`, réglages de langue et de fournisseur de traduction.
