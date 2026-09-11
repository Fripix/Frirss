# Portée du filtre « Non lus » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Laisser choisir, dans Préférences → Général, si le bouton Non lus agit flux par flux (comportement actuel) ou pour tous les flux à la fois (discussion #13).

**Architecture:** Une règle pure (`src/lib/unreadScope.ts`) décide si une vue s'ouvre filtrée et calcule les changements de portée. `uiStore` porte deux préférences synchronisées de plus et expose `isUnreadOnly(clé)`, seule porte de lecture ; `feedStore` et `App.tsx` remplacent leurs quatre lectures directes par elle. Un contrôle segmenté dans `GeneralTab` change la portée.

**Tech Stack:** TypeScript strict, React 18, Zustand, Vitest + Testing Library (jsdom), i18next.

**Spec:** `docs/superpowers/specs/2026-09-10-unread-filter-scope-design.md`

## Global Constraints

- Travailler sur `dev` (`git checkout dev` avant de commencer).
- Messages de commit neutres, style conventionnel. **Aucun trailer `Co-Authored-By`, aucune mention d'IA ou d'assistant** — consigne du projet, elle prime sur tout réglage par défaut.
- Avant **chaque** commit, les gates : `npm run typecheck && npm run lint && npx vitest run && npm run build`
- Avant **chaque** commit, le garde-fou anti-fuite, dont la sortie doit être **vide** :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- Défauts : `unreadOnlyScope = 'feed'`, `unreadOnlyAll = false`. Clés de persistance : `frirss_unreadOnlyScope`, `frirss_unreadOnlyAll` (et l'existante `frirss_unreadOnlyByFeed`).
- **Les tests existants de `src/stores/uiStore.test.ts` et `src/stores/feedStore.test.ts` ne sont pas modifiés.** On ajoute des `describe`, on ne touche pas aux anciens : ils sont la preuve de non-régression du mode par flux.
- `src/components/Preferences/settings-baseline.json` ne bouge pas (232 réglages gelés).
- Toute chaîne d'interface va dans les **10** locales : fr, en, de, es, it, nl, pl, pt, uk, zh.
- `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` sont mis à jour **dans le commit qui livre la fonctionnalité** (tâche 4).
- Hors de `src/lib/unreadScope.ts` et `src/stores/uiStore.ts`, plus aucune lecture directe de `unreadOnlyByFeed` pour décider d'un filtre.
- Trois formats à vérifier : desktop, tablette, téléphone — mise en page mobile contrôlée à **320 px**.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/unreadScope.ts` (nouveau) | Types, `unreadOnlyFor`, `switchUnreadScope`, `normalizeUnreadScope` — pur, sans import |
| `src/lib/unreadScope.test.ts` (nouveau) | Tests de la règle et des transitions |
| `src/stores/uiStore.ts` | `unreadOnlyScope`, `unreadOnlyAll`, `setUnreadOnlyAll`, `setUnreadOnlyScope`, synchronisation, `isUnreadOnly` |
| `src/stores/uiStore.test.ts` | Nouveau `describe` en fin de fichier |
| `src/stores/feedStore.ts` | Trois lectures + `setUnreadFilter` |
| `src/stores/feedStore.test.ts` | Nouveau `describe` après celui du filtre par flux |
| `src/App.tsx` | Lecture après `hydratePrefs()` |
| `src/components/Preferences/GeneralTab.tsx` | Contrôle segmenté |
| `src/components/Preferences/GeneralTab.test.tsx` (nouveau) | Câblage du contrôle |
| `src/locales/*.json` | 4 clés sous `preferences.general` |
| `docs/FEATURES.md`, `docs/RELEASE-NEXT.md` | Inventaire et journal du cycle |

---

### Task 1: La règle pure

**Files:**
- Create: `src/lib/unreadScope.ts`
- Test: `src/lib/unreadScope.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type UnreadScope = 'feed' | 'all'`
  - `interface UnreadPrefs { scope: UnreadScope; all: boolean; byFeed: Record<string, boolean> }`
  - `unreadOnlyFor(key: string, prefs: UnreadPrefs): boolean`
  - `switchUnreadScope(prefs: UnreadPrefs, to: UnreadScope, currentKey: string): UnreadPrefs`
  - `normalizeUnreadScope(v: unknown): UnreadScope`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/lib/unreadScope.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUnreadScope, switchUnreadScope, unreadOnlyFor, type UnreadPrefs } from './unreadScope';

const prefs = (over: Partial<UnreadPrefs> = {}): UnreadPrefs => ({
  scope: 'feed',
  all: false,
  byFeed: {},
  ...over,
});

describe('unreadOnlyFor', () => {
  it('per feed, global mode never used: identical to the legacy expression', () => {
    const byFeed: Record<string, boolean> = { 'feed/on': true, 'feed/off': false };
    for (const key of ['feed/on', 'feed/off', 'feed/unset', '']) {
      // Legacy expression, as it stood in feedStore/App: `unreadOnlyByFeed[key] ? 'unread' : 'all'`
      expect(unreadOnlyFor(key, prefs({ byFeed }))).toBe(!!byFeed[key]);
    }
  });

  it('per feed: a stored null (bad sync payload) reads like the legacy expression', () => {
    const byFeed = { 'feed/null': null } as unknown as Record<string, boolean>;
    expect(unreadOnlyFor('feed/null', prefs({ byFeed }))).toBe(false);
  });

  it('per feed after global use: a feed without a choice inherits, a feed with one keeps it', () => {
    const p = prefs({ all: true, byFeed: { 'feed/off': false } });
    expect(unreadOnlyFor('feed/unset', p)).toBe(true);
    expect(unreadOnlyFor('feed/off', p)).toBe(false);
  });

  it('all feeds: the per-feed table is ignored', () => {
    expect(unreadOnlyFor('feed/off', prefs({ scope: 'all', all: true, byFeed: { 'feed/off': false } }))).toBe(true);
    expect(unreadOnlyFor('', prefs({ scope: 'all', all: true }))).toBe(true);
    expect(unreadOnlyFor('feed/on', prefs({ scope: 'all', all: false, byFeed: { 'feed/on': true } }))).toBe(false);
  });
});

describe('switchUnreadScope', () => {
  it('to all feeds: takes the choice of the view on screen, keeps the table', () => {
    const byFeed = { 'feed/A': true, 'feed/B': false };
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/A')).toEqual({ scope: 'all', all: true, byFeed });
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/B').all).toBe(false);
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/unset').all).toBe(false);
  });

  it('back to per feed: keeps the last state and clears the table', () => {
    const next = switchUnreadScope(prefs({ scope: 'all', all: true, byFeed: { 'feed/B': false } }), 'feed', 'feed/A');
    expect(next).toEqual({ scope: 'feed', all: true, byFeed: {} });
    // The old per-feed choice of feed/B does not come back.
    expect(unreadOnlyFor('feed/B', next)).toBe(true);
  });

  it('choosing the active scope returns the very same object', () => {
    const p = prefs({ byFeed: { 'feed/A': true } });
    expect(switchUnreadScope(p, 'feed', 'feed/A')).toBe(p);
    const q = prefs({ scope: 'all', all: true });
    expect(switchUnreadScope(q, 'all', 'feed/A')).toBe(q);
  });
});

describe('normalizeUnreadScope', () => {
  it('keeps the two known values and falls back to per feed', () => {
    expect(normalizeUnreadScope('all')).toBe('all');
    expect(normalizeUnreadScope('feed')).toBe('feed');
    expect(normalizeUnreadScope('everything')).toBe('feed');
    expect(normalizeUnreadScope(undefined)).toBe('feed');
    expect(normalizeUnreadScope(null)).toBe('feed');
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/lib/unreadScope.test.ts`
Expected: FAIL — `Failed to resolve import "./unreadScope"`.

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/lib/unreadScope.ts` :

```ts
/**
 * Portée du filtre « Non lus ».
 *
 * - `feed` : chaque flux, catégorie ou étiquette retient son propre choix
 *   (`byFeed`, la clé `''` désignant la vue d'accueil). Un flux sans choix
 *   part de `all`.
 * - `all`  : un seul état, `all`, pour toutes les vues ; `byFeed` est ignoré.
 *
 * Tant que le mode global n'a jamais servi, `all` vaut `false` et la règle
 * rend exactement l'ancienne expression `unreadOnlyByFeed[clé] ? … : …`.
 * Spec : docs/superpowers/specs/2026-09-10-unread-filter-scope-design.md
 */
export type UnreadScope = 'feed' | 'all';

export interface UnreadPrefs {
  scope: UnreadScope;
  all: boolean;
  byFeed: Record<string, boolean>;
}

/** Une portée inconnue (valeur synchronisée par une version future) vaut `feed`. */
export function normalizeUnreadScope(v: unknown): UnreadScope {
  return v === 'all' ? 'all' : 'feed';
}

/** Vrai si la vue de clé `key` s'ouvre filtrée sur les non-lus. */
export function unreadOnlyFor(key: string, prefs: UnreadPrefs): boolean {
  if (prefs.scope === 'all') return prefs.all;
  const own = prefs.byFeed[key];
  return own === undefined || own === null ? prefs.all : !!own;
}

/**
 * Changement de portée. Ne recharge rien : c'est à l'appelant de ne pas
 * toucher la vue affichée.
 * - vers `all`  : l'état global prend le choix de la vue affichée, donc rien
 *   ne bascule à l'écran ; la table est conservée.
 * - vers `feed` : le dernier état est conservé et la table est VIDÉE — les
 *   choix par flux antérieurs ne doivent pas ressurgir (décision du
 *   propriétaire, 2026-09-10).
 * Même portée : renvoie l'objet reçu, inchangé.
 */
export function switchUnreadScope(prefs: UnreadPrefs, to: UnreadScope, currentKey: string): UnreadPrefs {
  if (prefs.scope === to) return prefs;
  if (to === 'all') {
    return { scope: 'all', all: unreadOnlyFor(currentKey, prefs), byFeed: prefs.byFeed };
  }
  return { scope: 'feed', all: prefs.all, byFeed: {} };
}
```

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `npx vitest run src/lib/unreadScope.test.ts`
Expected: PASS — 3 `describe`, 8 tests verts.

- [ ] **Step 5: Gates, garde-fou, commit**

Run les gates et le garde-fou (voir Global Constraints). Expected : tout vert, garde-fou vide.

```bash
git add src/lib/unreadScope.ts src/lib/unreadScope.test.ts
git commit -m "feat(filter): pure rule for the unread filter scope"
```

---

### Task 2: Les préférences dans `uiStore`

**Files:**
- Modify: `src/stores/uiStore.ts`
- Test: `src/stores/uiStore.test.ts` (ajout en fin de fichier uniquement)

**Interfaces:**
- Consumes (tâche 1) : `normalizeUnreadScope`, `switchUnreadScope`, `unreadOnlyFor`, `type UnreadScope`.
- Produces :
  - état `unreadOnlyScope: UnreadScope`, `unreadOnlyAll: boolean`
  - `setUnreadOnlyAll(on: boolean): void`
  - `setUnreadOnlyScope(scope: UnreadScope, currentKey: string): void`
  - export `isUnreadOnly(key: string): boolean` — seule porte de lecture pour les tâches 3 et 4

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/stores/uiStore.test.ts`, ajouter une ligne d'import **à part**, juste sous
`import { useUiStore, UI_SYNC_KEYS } from './uiStore';` (la ligne existante reste intacte) :

```ts
import { isUnreadOnly } from './uiStore';
```

Puis ajouter **en fin** de fichier, sans modifier les tests existants :

```ts
describe('uiStore — portée du filtre Non lus', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('isUnreadOnly per feed reads the stored choice, like before', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true, 'feed/B': false } });
    expect(isUnreadOnly('feed/A')).toBe(true);
    expect(isUnreadOnly('feed/B')).toBe(false);
    expect(isUnreadOnly('feed/unset')).toBe(false);
  });

  it('setUnreadOnlyScope to all takes the choice of the current view and keeps the table', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true, 'feed/B': false } });
    useUiStore.getState().setUnreadOnlyScope('all', 'feed/A');
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('all');
    expect(s.unreadOnlyAll).toBe(true);
    expect(s.unreadOnlyByFeed).toEqual({ 'feed/A': true, 'feed/B': false });
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyScope')!)).toBe('all');
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyAll')!)).toBe(true);
    expect(isUnreadOnly('feed/B')).toBe(true);
  });

  it('back to per feed keeps the last state and clears the per-feed table', () => {
    useUiStore.setState({ unreadOnlyScope: 'all', unreadOnlyAll: true, unreadOnlyByFeed: { 'feed/B': false } });
    useUiStore.getState().setUnreadOnlyScope('feed', 'feed/A');
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('feed');
    expect(s.unreadOnlyAll).toBe(true);
    expect(s.unreadOnlyByFeed).toEqual({});
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyByFeed')!)).toEqual({});
    expect(isUnreadOnly('feed/B')).toBe(true);
  });

  it('choosing the active scope writes nothing', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true } });
    useUiStore.getState().setUnreadOnlyScope('feed', 'feed/A');
    expect(useUiStore.getState().unreadOnlyByFeed).toEqual({ 'feed/A': true });
    expect(localStorage.getItem('frirss_unreadOnlyScope')).toBeNull();
  });

  it('setUnreadOnlyAll stores and persists the global state', () => {
    useUiStore.getState().setUnreadOnlyAll(true);
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
    expect(localStorage.getItem('frirss_unreadOnlyAll')).toBe('true');
  });

  it('applyServerPrefs applies both prefs and normalises an unknown scope', () => {
    useUiStore.getState().applyServerPrefs({ unreadOnlyScope: 'all', unreadOnlyAll: true });
    expect(useUiStore.getState().unreadOnlyScope).toBe('all');
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
    useUiStore.getState().applyServerPrefs({ unreadOnlyScope: 'everything' });
    expect(useUiStore.getState().unreadOnlyScope).toBe('feed');
  });

  it('syncs both prefs across devices', () => {
    expect(UI_SYNC_KEYS).toContain('unreadOnlyScope');
    expect(UI_SYNC_KEYS).toContain('unreadOnlyAll');
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: FAIL — `isUnreadOnly` n'est pas exporté ; les anciens tests du fichier restent verts.

- [ ] **Step 3: Import**

Dans `src/stores/uiStore.ts`, sous la ligne
`import { normalizeRowActions, type RowActionKind, type RowActionSettings } from '../lib/rowActions';`
ajouter :

```ts
import { normalizeUnreadScope, switchUnreadScope, unreadOnlyFor, type UnreadScope } from '../lib/unreadScope';
```

- [ ] **Step 4: Types de l'état**

Remplacer :

```ts
  unreadOnlyByFeed: Record<string, boolean>;
  setFeedUnreadOnly: (feedKey: string, on: boolean) => void;
```

par :

```ts
  unreadOnlyByFeed: Record<string, boolean>;
  setFeedUnreadOnly: (feedKey: string, on: boolean) => void;
  // Portée du filtre « Non lus » : 'feed' = chaque vue retient son choix
  // (unreadOnlyByFeed), 'all' = un seul état pour toutes (unreadOnlyAll).
  // Ne jamais lire ces champs directement pour décider d'un filtre : passer
  // par isUnreadOnly(). Voir src/lib/unreadScope.ts. Synchronisé.
  unreadOnlyScope: UnreadScope;
  unreadOnlyAll: boolean;
  setUnreadOnlyAll: (on: boolean) => void;
  /** `currentKey` : clé de la vue affichée (id du flux ou de l'étiquette, '' pour l'accueil). */
  setUnreadOnlyScope: (scope: UnreadScope, currentKey: string) => void;
```

- [ ] **Step 5: Implémentation dans le store**

Remplacer :

```ts
  // Auto-refresh the offline cache on app open (local, throttled in App).
```

par :

```ts
  unreadOnlyScope: normalizeUnreadScope(loadJson('frirss_unreadOnlyScope', 'feed')),
  unreadOnlyAll: loadJson('frirss_unreadOnlyAll', false),
  setUnreadOnlyAll: (on) => {
    localStorage.setItem('frirss_unreadOnlyAll', JSON.stringify(on));
    set({ unreadOnlyAll: on });
  },
  // Un seul `set` pour les trois champs : la synchronisation (prefsSync) voit
  // la nouvelle portée et la table vidée dans le même changement.
  setUnreadOnlyScope: (scope, currentKey) => {
    set((state) => {
      const next = switchUnreadScope(
        { scope: state.unreadOnlyScope, all: state.unreadOnlyAll, byFeed: state.unreadOnlyByFeed },
        scope,
        currentKey,
      );
      if (next.scope === state.unreadOnlyScope) return {};
      localStorage.setItem('frirss_unreadOnlyScope', JSON.stringify(next.scope));
      localStorage.setItem('frirss_unreadOnlyAll', JSON.stringify(next.all));
      localStorage.setItem('frirss_unreadOnlyByFeed', JSON.stringify(next.byFeed));
      return { unreadOnlyScope: next.scope, unreadOnlyAll: next.all, unreadOnlyByFeed: next.byFeed };
    });
  },
  // Auto-refresh the offline cache on app open (local, throttled in App).
```

- [ ] **Step 6: Synchronisation**

La chaîne `'unreadOnlyByFeed', 'hideReadFeeds',` apparaît **exactement deux fois** (clés JSON d'`applyServerPrefs` et `UI_SYNC_KEYS`). Remplacer les deux occurrences par :

```ts
'unreadOnlyByFeed', 'unreadOnlyScope', 'unreadOnlyAll', 'hideReadFeeds',
```

Vérifier : `grep -c "'unreadOnlyScope', 'unreadOnlyAll'" src/stores/uiStore.ts` → `2`.

Puis, dans `applyServerPrefs`, remplacer :

```ts
        const value = k === 'offlineImagePreset' ? normalizeImagePreset(prefs[k])
          : k === 'rowActions' ? normalizeRowActions(prefs[k])
          : prefs[k];
```

par :

```ts
        const value = k === 'offlineImagePreset' ? normalizeImagePreset(prefs[k])
          : k === 'rowActions' ? normalizeRowActions(prefs[k])
          : k === 'unreadOnlyScope' ? normalizeUnreadScope(prefs[k])
          : prefs[k];
```

- [ ] **Step 7: La porte de lecture**

Remplacer :

```ts
// Keys synced to the server (logical prefs — NOT geometric: panel widths,
```

par :

```ts
/**
 * Vrai si la vue de clé `key` (id du flux ou de l'étiquette, '' pour l'accueil)
 * s'ouvre filtrée sur les non-lus. SEULE lecture autorisée de la portée du
 * filtre — voir src/lib/unreadScope.ts.
 */
export function isUnreadOnly(key: string): boolean {
  const s = useUiStore.getState();
  return unreadOnlyFor(key, { scope: s.unreadOnlyScope, all: s.unreadOnlyAll, byFeed: s.unreadOnlyByFeed });
}

// Keys synced to the server (logical prefs — NOT geometric: panel widths,
```

- [ ] **Step 8: Vérifier qu'ils passent**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: PASS — anciens et nouveaux tests verts.

- [ ] **Step 9: Gates, garde-fou, commit**

```bash
git add src/stores/uiStore.ts src/stores/uiStore.test.ts
git commit -m "feat(filter): store and sync the unread filter scope"
```

---

### Task 3: Brancher `feedStore` et `App.tsx`

**Files:**
- Modify: `src/stores/feedStore.ts` (import l. 24, état initial `filter`, `setUnreadFilter`, `selectView`, `prefetchView`)
- Modify: `src/App.tsx` (import l. 6, lecture après `hydratePrefs()`)
- Test: `src/stores/feedStore.test.ts` (nouveau `describe` uniquement)

**Interfaces:**
- Consumes (tâche 2) : `isUnreadOnly(key: string): boolean`, état `unreadOnlyScope`, `setUnreadOnlyAll(on)`, `setFeedUnreadOnly(key, on)`.
- Produces : `setUnreadFilter(on)` écrit selon la portée ; toute navigation sans filtre explicite suit la portée.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/stores/feedStore.test.ts`, insérer **juste avant** la ligne
`describe('feedStore.silentRefresh — keep the article being read (unread filter)', () => {`
le bloc suivant (les imports `vi`, `beforeEach`, `afterEach`, `Subscription`, `useFeedStore` et `useUiStore` existent déjà dans le fichier) :

```ts
describe('feedStore — filtre Non lus en portée « Tous les flux »', () => {
  const feedA = { id: 'feed/A', title: 'A' } as unknown as Subscription;
  const feedB = { id: 'feed/B', title: 'B' } as unknown as Subscription;

  beforeEach(() => {
    localStorage.clear();
    useFeedStore.setState({ loadArticles: vi.fn() as never, selectedFeed: null });
    useUiStore.setState({ unreadOnlyScope: 'all', unreadOnlyAll: false, unreadOnlyByFeed: { 'feed/B': false } });
  });

  afterEach(() => {
    // Les describe suivants supposent la portée par défaut.
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('setUnreadFilter writes the global state and leaves the per-feed table alone', () => {
    useFeedStore.setState({ selectedFeed: feedA as never });
    useFeedStore.getState().setUnreadFilter(true);
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
    expect(useUiStore.getState().unreadOnlyByFeed).toEqual({ 'feed/B': false });
    expect(useFeedStore.getState().filter).toBe('unread');
  });

  it('every view opens filtered, even a feed whose own choice was "all"', () => {
    useUiStore.setState({ unreadOnlyAll: true });
    useFeedStore.getState().selectView(feedB);
    expect(useFeedStore.getState().filter).toBe('unread');
    useFeedStore.getState().selectView(null);
    expect(useFeedStore.getState().filter).toBe('unread');
  });

  it('an explicit filter still wins over the global state', () => {
    useUiStore.setState({ unreadOnlyAll: true });
    useFeedStore.getState().selectView(feedA, 'starred');
    expect(useFeedStore.getState().filter).toBe('starred');
  });
});

```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/stores/feedStore.test.ts`
Expected: FAIL sur les deux premiers nouveaux tests (`unreadOnlyAll` reste `false`, `filter` vaut `'all'`) ; tous les anciens tests verts.

- [ ] **Step 3: Import dans `feedStore.ts`**

Remplacer `import { useUiStore } from './uiStore';` par :

```ts
import { useUiStore, isUnreadOnly } from './uiStore';
```

- [ ] **Step 4: État initial**

Remplacer :

```ts
  filter: useUiStore.getState().unreadOnlyByFeed[''] ? 'unread' : 'all',
```

par :

```ts
  filter: isUnreadOnly('') ? 'unread' : 'all',
```

- [ ] **Step 5: `setUnreadFilter`**

Remplacer :

```ts
  // Toggle the "unread only" reading mode for the CURRENT feed/label only:
  // persist the per-feed preference (synced, survives reloads) then apply it.
  setUnreadFilter: (on) => {
    const key = get().selectedFeed?.id ?? '';
    useUiStore.getState().setFeedUnreadOnly(key, on);
    get().setFilter(on ? 'unread' : 'all');
  },
```

par :

```ts
  // Toggle the "unread only" reading mode. Where the choice is stored depends
  // on the scope (Preferences → General): per feed, for the CURRENT feed/label
  // only; all feeds, one state for every view. Synced, survives reloads.
  setUnreadFilter: (on) => {
    const ui = useUiStore.getState();
    if (ui.unreadOnlyScope === 'all') ui.setUnreadOnlyAll(on);
    else ui.setFeedUnreadOnly(get().selectedFeed?.id ?? '', on);
    get().setFilter(on ? 'unread' : 'all');
  },
```

- [ ] **Step 6: `selectView`**

Remplacer :

```ts
    const f = filter ?? (useUiStore.getState().unreadOnlyByFeed[feed?.id ?? ''] ? 'unread' : 'all');
```

par :

```ts
    const f = filter ?? (isUnreadOnly(feed?.id ?? '') ? 'unread' : 'all');
```

- [ ] **Step 7: `prefetchView`**

Remplacer :

```ts
    const filter: Filter = useUiStore.getState().unreadOnlyByFeed[feed.id] ? 'unread' : 'all';
```

par :

```ts
    const filter: Filter = isUnreadOnly(feed.id) ? 'unread' : 'all';
```

- [ ] **Step 8: `App.tsx`**

Remplacer `import { useUiStore } from './stores/uiStore';` par :

```ts
import { useUiStore, isUnreadOnly } from './stores/uiStore';
```

Puis remplacer :

```ts
        const desired = useUiStore.getState().unreadOnlyByFeed[''] ? 'unread' : 'all';
```

par :

```ts
        const desired = isUnreadOnly('') ? 'unread' : 'all';
```

- [ ] **Step 9: Plus aucune lecture directe**

Run: `grep -rn "unreadOnlyByFeed\[" src --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "src/lib/unreadScope.ts\|src/stores/uiStore.ts"`
Expected: aucune sortie.

- [ ] **Step 10: Vérifier qu'ils passent**

Run: `npx vitest run src/stores/feedStore.test.ts src/stores/uiStore.test.ts src/lib/unreadScope.test.ts`
Expected: PASS, anciens et nouveaux.

- [ ] **Step 11: Gates, garde-fou, commit**

```bash
git add src/stores/feedStore.ts src/stores/feedStore.test.ts src/App.tsx
git commit -m "feat(filter): resolve the unread filter through its scope"
```

---

### Task 4: Le réglage dans Préférences → Général

**Files:**
- Modify: `src/components/Preferences/GeneralTab.tsx`
- Create: `src/components/Preferences/GeneralTab.test.tsx`
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`
- Modify: `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`

**Interfaces:**
- Consumes (tâche 2) : état `unreadOnlyScope`, `setUnreadOnlyScope(scope, currentKey)` ; `useFeedStore.getState().selectedFeed?.id`.
- Produces : clés i18n `preferences.general.unreadScope`, `.unreadScopeHint`, `.unreadScopeFeed`, `.unreadScopeAll`.

- [ ] **Step 1: Écrire le test de composant qui échoue**

`src/components/Preferences/GeneralTab.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// Translations aren't under test here — return the key so assertions are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
// The view on screen is feed/A; the real feedStore would pull in the API layer.
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: { getState: () => ({ selectedFeed: { id: 'feed/A' } }) },
}));

import GeneralTab from './GeneralTab';
import { useUiStore } from '../../stores/uiStore';

describe('GeneralTab — portée du filtre Non lus', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: { 'feed/A': true } });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('marks the active scope as checked', () => {
    const { getByRole } = render(<GeneralTab />);
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeFeed' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('false');
  });

  it('switching to all feeds takes the choice of the view on screen', () => {
    const { getByRole } = render(<GeneralTab />);
    fireEvent.click(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }));
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('all');
    expect(s.unreadOnlyAll).toBe(true); // feed/A, on screen, was unread-only
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('true');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `npx vitest run src/components/Preferences/GeneralTab.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "radio"`.

- [ ] **Step 3: Hooks et import dans `GeneralTab.tsx`**

Remplacer `import ToggleSwitch from '../ToggleSwitch';` par :

```ts
import ToggleSwitch from '../ToggleSwitch';
import { useFeedStore } from '../../stores/feedStore';
```

Puis remplacer :

```ts
  const inlineVideos = useUiStore((s) => s.inlineVideos);
```

par :

```ts
  const unreadOnlyScope = useUiStore((s) => s.unreadOnlyScope);
  const setUnreadOnlyScope = useUiStore((s) => s.setUnreadOnlyScope);
  const inlineVideos = useUiStore((s) => s.inlineVideos);
```

- [ ] **Step 4: Le contrôle segmenté**

Remplacer :

```tsx
        {/* Play YouTube videos in the article (click-to-load facade) */}
```

par :

```tsx
        {/* Scope of the "Unread" filter: per feed, or one state for all feeds */}
        <div className="select-none mt-4">
          <span className="text-xs block" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.general.unreadScope')}
            <span className="block text-[11px] opacity-70 mt-0.5">
              {t('preferences.general.unreadScopeHint')}
            </span>
          </span>
          {/* Segmented control — same markup as the authentication mode in
              AdminTab: plain buttons, so a single click always registers. */}
          <div
            className="flex gap-1 p-0.5 rounded-lg mt-2"
            role="radiogroup"
            aria-label={t('preferences.general.unreadScope')}
            style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)' }}
          >
            {([
              { scope: 'feed', label: t('preferences.general.unreadScopeFeed') },
              { scope: 'all', label: t('preferences.general.unreadScopeAll') },
            ] as const).map((opt) => {
              const selected = unreadOnlyScope === opt.scope;
              return (
                <button
                  key={opt.scope}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setUnreadOnlyScope(opt.scope, useFeedStore.getState().selectedFeed?.id ?? '')}
                  className="flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                  style={{
                    background: selected ? 'var(--accent)' : 'transparent',
                    color: selected ? '#fff' : 'var(--list-title)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Play YouTube videos in the article (click-to-load facade) */}
```

- [ ] **Step 5: Les 10 locales**

Run (script Node lu sur l'entrée standard ; les JSON font l'aller-retour avec `JSON.stringify(obj, null, 2) + "\n"`) :

```bash
node <<'EOF'
const fs = require('fs');
const add = {
  fr: { unreadScope: 'Filtre Non lus', unreadScopeFeed: 'Par flux', unreadScopeAll: 'Tous les flux',
    unreadScopeHint: "Par flux, chaque flux retient son choix. Tous les flux, le bouton Non lus s'applique partout ; revenir à Par flux repart de l'état actuel." },
  en: { unreadScope: 'Unread filter', unreadScopeFeed: 'Per feed', unreadScopeAll: 'All feeds',
    unreadScopeHint: 'Per feed, each feed keeps its own choice. All feeds, the Unread button applies everywhere; switching back to Per feed starts from the current state.' },
  de: { unreadScope: 'Ungelesen-Filter', unreadScopeFeed: 'Pro Feed', unreadScopeAll: 'Alle Feeds',
    unreadScopeHint: 'Pro Feed behält jeder Feed seine eigene Wahl. Bei „Alle Feeds“ gilt die Schaltfläche Ungelesen überall; zurück zu „Pro Feed“ geht vom aktuellen Zustand aus.' },
  es: { unreadScope: 'Filtro No leídos', unreadScopeFeed: 'Por fuente', unreadScopeAll: 'Todas las fuentes',
    unreadScopeHint: 'Por fuente, cada fuente conserva su propia elección. Con «Todas las fuentes», el botón No leídos se aplica en todas partes; volver a «Por fuente» parte del estado actual.' },
  it: { unreadScope: 'Filtro Non letti', unreadScopeFeed: 'Per feed', unreadScopeAll: 'Tutti i feed',
    unreadScopeHint: 'Per feed, ogni feed mantiene la propria scelta. Con «Tutti i feed», il pulsante Non letti vale ovunque; tornare a «Per feed» riparte dallo stato attuale.' },
  nl: { unreadScope: 'Filter Ongelezen', unreadScopeFeed: 'Per feed', unreadScopeAll: 'Alle feeds',
    unreadScopeHint: 'Per feed houdt elke feed zijn eigen keuze. Bij ‘Alle feeds’ geldt de knop Ongelezen overal; terug naar ‘Per feed’ gaat uit van de huidige stand.' },
  pl: { unreadScope: 'Filtr Nieprzeczytane', unreadScopeFeed: 'Osobno', unreadScopeAll: 'Wszystkie kanały',
    unreadScopeHint: 'W trybie „Osobno” każdy kanał zapamiętuje własny wybór. W trybie „Wszystkie kanały” przycisk Nieprzeczytane działa wszędzie; powrót do „Osobno” zaczyna od bieżącego stanu.' },
  pt: { unreadScope: 'Filtro Não lidos', unreadScopeFeed: 'Por fonte', unreadScopeAll: 'Todos os feeds',
    unreadScopeHint: 'Por fonte, cada fonte guarda a sua escolha. Com «Todos os feeds», o botão Não lidos aplica-se em todo o lado; voltar a «Por fonte» parte do estado atual.' },
  uk: { unreadScope: 'Фільтр «Непрочитані»', unreadScopeFeed: 'Окремо', unreadScopeAll: 'Усі стрічки',
    unreadScopeHint: '«Окремо» — кожна стрічка пам’ятає власний вибір. «Усі стрічки» — кнопка «Непрочитані» діє всюди; повернення до «Окремо» починається з поточного стану.' },
  zh: { unreadScope: '未读筛选', unreadScopeFeed: '按订阅源', unreadScopeAll: '全部订阅源',
    unreadScopeHint: '按订阅源：每个订阅源各自记住选择。全部订阅源：未读按钮对所有视图生效；切回“按订阅源”时以当前状态为起点。' },
};
for (const [l, v] of Object.entries(add)) {
  const p = `src/locales/${l}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(j.preferences.general, v);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
EOF
```

Expected: `ok`. Puis la parité (commande de `CLAUDE.md`) :

```bash
node -e 'const fs=require("fs");const L=["fr","en","de","es","it","nl","pl","pt","uk","zh"].filter(l=>fs.existsSync(`src/locales/${l}.json`));const f=(o,p="")=>Object.entries(o).reduce((a,[k,v])=>{v&&typeof v==="object"?Object.assign(a,f(v,p+k+".")):a[p+k]=v;return a},{});const K={};for(const l of L)K[l]=f(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8")));let bad=0;for(const l of L){if(l==="fr")continue;const m=Object.keys(K.fr).filter(x=>!(x in K[l])&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}console.log(bad?"PARITÉ CASSÉE":`parité ok (${L.length} locales : ${L.join(", ")})`)'
```

Expected: `parité ok (10 locales : fr, en, de, es, it, nl, pl, pt, uk, zh)`.

Et `git diff --stat src/locales` : 10 fichiers, 4 lignes ajoutées chacun (plus une virgule), aucune ligne retirée hors la virgule.

- [ ] **Step 6: Vérifier que le test passe**

Run: `npx vitest run src/components/Preferences/GeneralTab.test.tsx src/components/Preferences/settingsCoverage.test.ts`
Expected: PASS — y compris « fige 232 réglages » (le relevé n'a pas bougé).

- [ ] **Step 7: `docs/FEATURES.md`**

Remplacer la ligne `### Marquer lu au défilement` par :

```markdown
### Filtre Non lus
Le bouton **Non lus** de l'en-tête filtre la vue. Sa portée se règle dans
Préférences → Général (synchronisée) : **Par flux** (défaut) ou **Tous les
flux**.

- **Où** : `src/lib/unreadScope.ts` (la règle et les changements de portée,
  testés), `src/stores/uiStore.ts` (`unreadOnlyScope`, `unreadOnlyAll`,
  `unreadOnlyByFeed`, `isUnreadOnly`), `feedStore.setUnreadFilter`,
  `src/components/Preferences/GeneralTab.tsx`
- **Spec** : `docs/superpowers/specs/2026-09-10-unread-filter-scope-design.md`
- **Par flux** : chaque flux, catégorie et étiquette retient son choix
  (`unreadOnlyByFeed`, la clé `''` désignant la vue d'accueil). Le filtre a
  d'abord été un drapeau unique ; `6c19c36` (2026-07-31) l'a rendu par flux,
  parce qu'activer le filtre sur un flux l'activait partout. La discussion #13 a
  demandé l'inverse : les deux besoins existent, d'où la portée.
- **Tous les flux** : un seul état, `unreadOnlyAll`, pour toutes les vues ; la
  table par flux est ignorée. Le bouton de l'état vide « Tout est lu » désactive
  alors le filtre partout.
- **Une seule porte de lecture** : `isUnreadOnly(clé)`. Ne jamais relire
  `unreadOnlyByFeed` directement pour décider d'un filtre — c'est ce que
  faisaient les quatre sites d'origine, et un cinquième ignorerait la portée.
- **Piège — revenir à « Par flux » efface les choix par flux**, sur tous les
  appareils : chaque flux repart de l'état global du moment. Voulu (les anciens
  choix ne doivent pas ressurgir), mais irréversible.
- **Non-régression** : tant que le mode global n'a jamais servi,
  `unreadOnlyAll` vaut `false` et la règle rend exactement l'ancienne
  expression. Changer de portée ne recharge jamais la vue affichée.
- **Sans rapport avec la règle du ✓** (issue #10), qui lit `feedStore.filter`,
  l'état dérivé.

### Marquer lu au défilement
```

- [ ] **Step 8: `docs/RELEASE-NEXT.md`**

Sous `## Fonctionnalités`, remplacer `_(rien pour l'instant)_` par :

```markdown
- **Le filtre Non lus peut s'appliquer à tous les flux.** Préférences →
  Général, « Filtre Non lus » : *Par flux*, le fonctionnement actuel où chaque
  flux retient son choix, ou *Tous les flux*, où le bouton Non lus s'applique
  partout. Revenir à *Par flux* repart de l'état du moment : les choix par flux
  antérieurs sont effacés. Demandé dans la discussion #13.
```

- [ ] **Step 9: Gates, garde-fou, commit**

```bash
git add src/components/Preferences/GeneralTab.tsx src/components/Preferences/GeneralTab.test.tsx src/locales docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "feat(prefs): choose the unread filter scope, per feed or all feeds"
```

---

### Task 5: Vérification réelle et livraison sur `dev`

**Files:** aucun, sauf correction d'un défaut trouvé ici (nouveau commit, gates et garde-fou compris).

- [ ] **Step 1: Démarrer l'app de dev** avec les outils de prévisualisation du navigateur intégré (jamais via Bash), se connecter.

- [ ] **Step 2: Parcours fonctionnel, en portée « Par flux »** — activer Non lus sur un flux A, ouvrir un flux B : B n'est pas filtré. Rien n'a changé par rapport à la prod.

- [ ] **Step 3: Passage à « Tous les flux »** depuis le flux A filtré : la vue affichée ne bascule pas ; ouvrir B, une catégorie, une étiquette, la vue d'accueil — toutes filtrées. Désactiver Non lus sur B : toutes les vues repassent en « tout ». Les entrées fixes Favoris et À lire plus tard restent inchangées.

- [ ] **Step 4: Retour à « Par flux »** avec le filtre actif : toutes les vues restent filtrées ; désactiver sur un flux n'affecte que lui.

- [ ] **Step 5: Règle du ✓ (#10)** en portée « Tous les flux » : sous Non lus, cocher ✓ retire la ligne après confirmation serveur, comme avant.

- [ ] **Step 6: Mise en page** — contrôle segmenté à **320 px**, en tablette et en desktop, dans un thème clair et un thème sombre, en **fr, de, pl et uk** (libellés les plus longs). Mesurer avec `getBoundingClientRect()` : aucun bouton ne déborde du panneau, aucun libellé ne passe sous le bord. Mesurer aussi le contraste du texte blanc sur `var(--accent)` du bouton actif ; s'il est sous 4.5:1, **le signaler au propriétaire sans le corriger ici** — le même balisage vit déjà dans `AdminTab`, c'est un point d'accessibilité transversal consigné au backlog.

- [ ] **Step 7: Pousser `dev`** (autorisé sans demander une fois l'implémentation terminée, gates verts et garde-fou vide) :

```bash
git push origin dev
```

- [ ] **Step 8: Vérifier les deux workflows**

Run: `gh run list --branch dev --limit 2`
Expected: `CI` **et** `Publish image` en succès. Ne pas annoncer « terminé » sur la foi des seuls tests locaux. Le redéploiement est celui du propriétaire (Dockhand) — ne jamais déployer soi-même.
