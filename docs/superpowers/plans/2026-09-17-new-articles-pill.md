# Pastille « nouveaux articles » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signaler par une pastille « ↑ N nouveaux articles » les articles arrivés dans la vue affichée depuis son chargement, avec un réglage pour la désactiver (discussion #14).

**Architecture:** Une règle pure (`src/lib/newArticles.ts`) dit quels flux comptent pour la vue et additionne leurs arrivées. `feedStore.syncCounts` (relevé toutes les 60 s) cumule ces arrivées dans `newInView`, remis à zéro à chaque rechargement de liste. `NewArticlesPill` l'affiche en haut de la liste si `uiStore.showNewArticlesPill` est vrai.

**Tech Stack:** TypeScript strict, React 18, Zustand, Vitest + Testing Library (jsdom), i18next.

**Spec:** `docs/superpowers/specs/2026-09-17-new-articles-pill-design.md`

## Global Constraints

- Travailler sur `dev`.
- **`git` passe par les Command Line Tools** (la licence Xcode n'est pas acceptée sur la machine) : exécuter `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` dans chaque commande shell qui appelle `git`.
- Messages de commit neutres, style conventionnel. **Aucun trailer `Co-Authored-By`, aucune mention d'IA ou d'assistant** — consigne du projet, elle prime sur tout réglage par défaut. Ne pas pousser.
- Avant **chaque** commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`, puis le garde-fou anti-fuite dont la sortie doit être **vide** :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- `server/test/extractCache.test.ts` est connu pour échouer par intermittence, sans lien : s'il échoue seul, le relancer une fois isolément et le signaler.
- **Ne pas modifier les tests existants** : on ajoute des `describe` ou des fichiers.
- `src/components/Preferences/settings-baseline.json` ne bouge pas.
- Réglage : `showNewArticlesPill`, **vrai** par défaut, clé `frirss_showNewArticlesPill`, synchronisé ; seul un `false` explicite l'éteint.
- Libellé de la pastille : `↑` + la clé **existante** `refresh.newArticles` (avec `count`). Clés nouvelles : `preferences.general.newArticlesPill` et `preferences.general.newArticlesPillHint`, dans les **10** locales.
- `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` dans le commit qui livre la fonctionnalité (tâche 3).
- Trois formats à vérifier ; téléphone à **320 px**.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/newArticles.ts` (+ test) | `viewFeedIds`, `countNewInView` — pur |
| `src/stores/feedStore.ts` (+ test) | `newInView`, cumul dans `syncCounts`, remises à zéro, `loadNewArticles` |
| `src/stores/uiStore.ts` (+ test) | `showNewArticlesPill`, synchronisation |
| `src/components/ArticleList/NewArticlesPill.tsx` (+ test) | la pastille |
| `src/components/ArticleList/ArticleList.tsx` | montage, remontée en haut |
| `src/components/Preferences/GeneralTab.tsx` (+ nouveau test) | l'interrupteur |
| `src/styles/index.css` | style de la pastille |
| `src/locales/*.json` | deux clés |
| `docs/FEATURES.md`, `docs/RELEASE-NEXT.md` | inventaire, journal |

---

### Task 1: La règle pure

**Files:**
- Create: `src/lib/newArticles.ts`, `src/lib/newArticles.test.ts`

**Interfaces:**
- Consumes: `type Filter = 'all' | 'unread' | 'starred' | 'readlater'` (`src/types/index.ts`).
- Produces:
  - `interface ViewDescriptor { feedId: string | null; filter: Filter; searching: boolean }`
  - `viewFeedIds(view: ViewDescriptor, subscriptions: ReadonlyArray<{ id: string; categories?: ReadonlyArray<{ id: string }> }>): string[] | null`
  - `countNewInView(newByFeed: Record<string, number>, feedIds: readonly string[]): number`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/lib/newArticles.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { countNewInView, viewFeedIds, type ViewDescriptor } from './newArticles';

const subs = [
  { id: 'feed/A', categories: [{ id: 'user/-/label/Tech' }] },
  { id: 'feed/B', categories: [{ id: 'user/-/label/News' }] },
  { id: 'feed/C' },
];

const view = (over: Partial<ViewDescriptor> = {}): ViewDescriptor => ({
  feedId: null,
  filter: 'all',
  searching: false,
  ...over,
});

describe('viewFeedIds', () => {
  it('home view, all or unread: every subscription', () => {
    expect(viewFeedIds(view(), subs)).toEqual(['feed/A', 'feed/B', 'feed/C']);
    expect(viewFeedIds(view({ filter: 'unread' }), subs)).toEqual(['feed/A', 'feed/B', 'feed/C']);
  });

  it('a feed: that feed only', () => {
    expect(viewFeedIds(view({ feedId: 'feed/B', filter: 'unread' }), subs)).toEqual(['feed/B']);
  });

  it('a category: the feeds filed under it', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/label/Tech' }), subs)).toEqual(['feed/A']);
  });

  it('a label no feed is filed under: no pill', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/label/Later' }), subs)).toBeNull();
  });

  it('favourites and read later: no pill, even with a feed selected', () => {
    for (const filter of ['starred', 'readlater'] as const) {
      expect(viewFeedIds(view({ filter }), subs)).toBeNull();
      expect(viewFeedIds(view({ filter, feedId: 'feed/A' }), subs)).toBeNull();
    }
  });

  it('a search: no pill', () => {
    expect(viewFeedIds(view({ searching: true }), subs)).toBeNull();
    expect(viewFeedIds(view({ searching: true, feedId: 'feed/A' }), subs)).toBeNull();
  });

  it('any other stream: no pill', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/state/com.google/starred' }), subs)).toBeNull();
  });
});

describe('countNewInView', () => {
  it('adds the arrivals of the feeds in view and ignores the others', () => {
    expect(countNewInView({ 'feed/A': 2, 'feed/B': 5, 'feed/C': 1 }, ['feed/A', 'feed/C'])).toBe(3);
  });

  it('is zero without arrivals or without feeds', () => {
    expect(countNewInView({}, ['feed/A'])).toBe(0);
    expect(countNewInView({ 'feed/A': 2 }, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/lib/newArticles.test.ts`
Expected: FAIL — `Failed to resolve import "./newArticles"`.

- [ ] **Step 3: Implémenter**

`src/lib/newArticles.ts` :

```ts
import type { Filter } from '../types';

/**
 * Pastille « N nouveaux articles » (discussion #14) : quels flux comptent pour
 * la vue affichée, et combien d'articles y sont arrivés.
 * Spec : docs/superpowers/specs/2026-09-17-new-articles-pill-design.md
 */
export interface ViewDescriptor {
  /** Id du flux, de la catégorie ou de l'étiquette sélectionnés ; `null` pour l'accueil. */
  feedId: string | null;
  filter: Filter;
  /** Une recherche est en cours. */
  searching: boolean;
}

const LABEL_PREFIX = 'user/-/label/';

/**
 * Flux dont les arrivées comptent pour la vue, ou `null` si la vue n'a pas de
 * pastille. Catégories et étiquettes partagent le préfixe `user/-/label/` : une
 * étiquette, qu'aucun abonnement ne porte comme catégorie, rend donc `null`.
 */
export function viewFeedIds(
  view: ViewDescriptor,
  subscriptions: ReadonlyArray<{ id: string; categories?: ReadonlyArray<{ id: string }> }>,
): string[] | null {
  if (view.searching) return null;
  if (view.filter === 'starred' || view.filter === 'readlater') return null;
  if (view.feedId === null) return subscriptions.map((s) => s.id);
  if (view.feedId.startsWith('feed/')) return [view.feedId];
  if (view.feedId.startsWith(LABEL_PREFIX)) {
    const ids = subscriptions
      .filter((s) => s.categories?.some((c) => c.id === view.feedId))
      .map((s) => s.id);
    return ids.length ? ids : null;
  }
  return null;
}

/** Somme des arrivées (`computeRefreshDelta().newByFeed`) des flux de la vue. */
export function countNewInView(newByFeed: Record<string, number>, feedIds: readonly string[]): number {
  let total = 0;
  for (const id of feedIds) total += newByFeed[id] ?? 0;
  return total;
}
```

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `npx vitest run src/lib/newArticles.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Gates, garde-fou, commit**

```bash
git add src/lib/newArticles.ts src/lib/newArticles.test.ts
git commit -m "feat(list): pure rule for the new-articles pill"
```

---

### Task 2: Les stores

**Files:**
- Modify: `src/stores/feedStore.ts`, `src/stores/uiStore.ts`
- Test: `src/stores/feedStore.test.ts` (nouveau `describe` uniquement), `src/stores/uiStore.test.ts` (nouveau `describe` en fin de fichier)

**Interfaces:**
- Consumes (tâche 1) : `viewFeedIds`, `countNewInView`. Existant : `computeRefreshDelta(before, after) → { totalNew, newByFeed }` (`src/lib/refreshDelta.ts`, déjà importé dans `feedStore.ts`).
- Produces :
  - `feedStore` : état `newInView: number` ; action `loadNewArticles(): Promise<void>`
  - `uiStore` : état `showNewArticlesPill: boolean` ; action `setShowNewArticlesPill(v: boolean): void`

Chaque « Remplacer … par … » est un remplacement exact qui doit correspondre **une seule fois** ; sinon, s'arrêter et le signaler (NEEDS_CONTEXT).

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/stores/feedStore.test.ts`, insérer **juste avant** la ligne `describe('pickPrefetchFeeds', () => {` (les imports `vi`, `beforeEach`, `afterEach`, `api`, `Subscription`, `useFeedStore` existent déjà) :

```ts
describe('feedStore — pastille « nouveaux articles »', () => {
  const feedA = { id: 'feed/A', title: 'A', categories: [{ id: 'user/-/label/Tech' }] } as unknown as Subscription;
  const feedB = { id: 'feed/B', title: 'B' } as unknown as Subscription;
  const counts = (m: Record<string, number>) => Object.entries(m).map(([id, count]) => ({ id, count })) as never;
  const real = {
    loadSpecialCounts: useFeedStore.getState().loadSpecialCounts,
    loadArticles: useFeedStore.getState().loadArticles,
  };

  beforeEach(() => {
    useFeedStore.setState({
      subscriptions: [feedA, feedB],
      selectedFeed: feedA,
      filter: 'unread',
      searchQuery: '',
      unreadCounts: { 'feed/A': 2, 'feed/B': 1 },
      newInView: 0,
      loadSpecialCounts: vi.fn() as never,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ ...real, selectedFeed: null, filter: 'all', newInView: 0 });
  });

  it('counts the arrivals of the feed on screen', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 5, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(3);
    expect(useFeedStore.getState().unreadCounts['feed/A']).toBe(5);
  });

  it('adds successive polls up', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 3, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 4, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(2);
  });

  it('ignores other feeds and decreases', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 1, 'feed/B': 4 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);
  });

  it('ignores a change the app already applied locally', async () => {
    // Marquer non lu dans FriRSS a déjà porté le compteur local à 3.
    useFeedStore.setState({ unreadCounts: { 'feed/A': 3, 'feed/B': 1 } });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 3, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);
  });

  it('counts nothing on the very first poll', async () => {
    useFeedStore.setState({ unreadCounts: {} });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 5, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);
  });

  it('the home view counts every feed; favourites count nothing', async () => {
    useFeedStore.setState({ selectedFeed: null, filter: 'all' });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 3, 'feed/B': 2 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(2);

    useFeedStore.setState({ filter: 'starred', newInView: 0 });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 6, 'feed/B': 2 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);
  });

  it('a category counts only its own feeds', async () => {
    useFeedStore.setState({ selectedFeed: { id: 'user/-/label/Tech', title: 'Tech' } as unknown as Subscription });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 4, 'feed/B': 3 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(2);
  });

  it('a search counts nothing', async () => {
    useFeedStore.setState({ searchQuery: 'kernel' });
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 9, 'feed/B': 1 }));
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);
  });

  it('reloading the list resets the count', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null } as never);
    useFeedStore.setState({ newInView: 4 });
    const pending = useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().newInView).toBe(0);
    await pending;
  });

  it('loadNewArticles resets the count and reloads the list', async () => {
    const loadArticles = vi.fn().mockResolvedValue(undefined);
    useFeedStore.setState({ newInView: 4, loadArticles: loadArticles as never });
    await useFeedStore.getState().loadNewArticles();
    expect(useFeedStore.getState().newInView).toBe(0);
    expect(loadArticles).toHaveBeenCalledTimes(1);
  });

  it('a silent refresh resets the count once the list is reloaded', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue(counts({ 'feed/A': 2, 'feed/B': 1 }));
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null } as never);
    useFeedStore.setState({ newInView: 4 });
    await useFeedStore.getState().silentRefresh();
    expect(useFeedStore.getState().newInView).toBe(0);
  });
});

```

À la **fin** de `src/stores/uiStore.test.ts` (les imports `useUiStore`, `UI_SYNC_KEYS`, `beforeEach` existent déjà) :

```ts
describe('uiStore — pastille « nouveaux articles »', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  it('persists a change', () => {
    useUiStore.getState().setShowNewArticlesPill(false);
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
    expect(localStorage.getItem('frirss_showNewArticlesPill')).toBe('false');
  });

  it('syncs across devices, and only an explicit false turns it off', () => {
    expect(UI_SYNC_KEYS).toContain('showNewArticlesPill');
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: false });
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: 'false' });
    expect(useUiStore.getState().showNewArticlesPill).toBe(true);
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: false });
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: true });
    expect(useUiStore.getState().showNewArticlesPill).toBe(true);
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/stores/feedStore.test.ts src/stores/uiStore.test.ts`
Expected: FAIL sur les nouveaux tests (`newInView` indéfini, `loadNewArticles` / `setShowNewArticlesPill` absents) ; tous les anciens restent verts.

- [ ] **Step 3: `feedStore.ts`**

Remplacer `import { computeRefreshDelta } from '../lib/refreshDelta';` par :

```ts
import { computeRefreshDelta } from '../lib/refreshDelta';
import { countNewInView, viewFeedIds } from '../lib/newArticles';
```

Remplacer :

```ts
  refreshResult: { totalNew: number; newByFeed: Record<string, number>; at: number } | null;
```

par :

```ts
  refreshResult: { totalNew: number; newByFeed: Record<string, number>; at: number } | null;
  /** Articles arrivés dans la vue affichée depuis son chargement (pastille, discussion #14). */
  newInView: number;
```

Remplacer :

```ts
  silentRefresh: () => Promise<void>;
```

par :

```ts
  silentRefresh: () => Promise<void>;
  /** Remet `newInView` à zéro et recharge la liste. */
  loadNewArticles: () => Promise<void>;
```

Remplacer :

```ts
  refreshResult: null,
  refreshPhase: 'idle',
```

par :

```ts
  refreshResult: null,
  newInView: 0,
  refreshPhase: 'idle',
```

Dans `loadArticles`, remplacer :

```ts
    set({ loading: !cached, revalidating: true });
```

par :

```ts
    // La liste repart du serveur : ce qui était signalé comme nouveau y sera.
    set({ loading: !cached, revalidating: true, newInView: 0 });
```

Dans `syncCounts`, remplacer :

```ts
      counts.forEach((c) => { countMap[c.id] = c.count; });
      set({ unreadCounts: applyZeroFloor(countMap) });
```

par :

```ts
      counts.forEach((c) => { countMap[c.id] = c.count; });
      const next = applyZeroFloor(countMap);
      // Pastille « nouveaux articles » (discussion #14) : seules les HAUSSES des
      // flux de la vue affichée comptent. Une action locale a déjà mis le
      // compteur à jour, elle ne produit donc aucune hausse ici. Sans compteur
      // connu (premier relevé), rien n'est compté : tout le stock passerait
      // pour une arrivée.
      const { selectedFeed, filter, searchQuery, subscriptions, unreadCounts } = get();
      const feedIds = viewFeedIds(
        { feedId: selectedFeed?.id ?? null, filter, searching: !!searchQuery },
        subscriptions,
      );
      const arrived = feedIds && Object.keys(unreadCounts).length
        ? countNewInView(computeRefreshDelta(unreadCounts, next).newByFeed, feedIds)
        : 0;
      set((s) => ({ unreadCounts: next, newInView: s.newInView + arrived }));
```

Dans `silentRefresh`, remplacer :

```ts
        return {
          articles,
          continuation: result.continuation,
          selectedArticle: updatedSelected,
        };
```

par :

```ts
        return {
          articles,
          continuation: result.continuation,
          selectedArticle: updatedSelected,
          // La liste vient d'être rechargée : plus rien de nouveau à signaler.
          newInView: 0,
        };
```

Remplacer :

```ts
  setHasRefreshToken: (v: boolean) => set({ hasRefreshToken: v }),
```

par :

```ts
  loadNewArticles: async () => {
    set({ newInView: 0 });
    await get().loadArticles();
  },

  setHasRefreshToken: (v: boolean) => set({ hasRefreshToken: v }),
```

- [ ] **Step 4: `uiStore.ts`**

Remplacer :

```ts
  markReadOnScroll: boolean;
  setMarkReadOnScroll: (v: boolean) => void;
```

par :

```ts
  markReadOnScroll: boolean;
  setMarkReadOnScroll: (v: boolean) => void;
  // Pastille « N nouveaux articles » en haut de la liste (discussion #14).
  // Activée par défaut : elle signale, elle n'écrit rien. Synchronisé.
  showNewArticlesPill: boolean;
  setShowNewArticlesPill: (v: boolean) => void;
```

Remplacer :

```ts
  setMarkReadOnScroll: (v) => {
    localStorage.setItem('frirss_markReadOnScroll', JSON.stringify(v));
    set({ markReadOnScroll: v });
  },
```

par :

```ts
  setMarkReadOnScroll: (v) => {
    localStorage.setItem('frirss_markReadOnScroll', JSON.stringify(v));
    set({ markReadOnScroll: v });
  },

  // Seul un `false` explicite l'éteint : c'est le défaut qui doit gagner.
  showNewArticlesPill: loadJson<boolean>('frirss_showNewArticlesPill', true) !== false,
  setShowNewArticlesPill: (v) => {
    localStorage.setItem('frirss_showNewArticlesPill', JSON.stringify(v));
    set({ showNewArticlesPill: v });
  },
```

La chaîne `'markReadOnScroll', 'showListFavicons'` apparaît **exactement deux fois** (clés JSON d'`applyServerPrefs` et `UI_SYNC_KEYS`) : remplacer **les deux** par `'markReadOnScroll', 'showNewArticlesPill', 'showListFavicons'`. Vérifier : `grep -c "'showNewArticlesPill', 'showListFavicons'" src/stores/uiStore.ts` → `2`.

Puis remplacer :

```ts
          : k === 'unreadOnlyAll' ? prefs[k] === true
```

par :

```ts
          : k === 'unreadOnlyAll' ? prefs[k] === true
          : k === 'showNewArticlesPill' ? prefs[k] !== false
```

- [ ] **Step 5: Vérifier qu'ils passent**

Run: `npx vitest run src/stores/feedStore.test.ts src/stores/uiStore.test.ts src/lib/newArticles.test.ts`
Expected: PASS, anciens et nouveaux.

- [ ] **Step 6: Gates, garde-fou, commit**

```bash
git add src/stores/feedStore.ts src/stores/feedStore.test.ts src/stores/uiStore.ts src/stores/uiStore.test.ts
git commit -m "feat(list): count articles that arrive in the view on screen"
```

---

### Task 3: La pastille, le réglage, la documentation

**Files:**
- Create: `src/components/ArticleList/NewArticlesPill.tsx`, `src/components/ArticleList/NewArticlesPill.test.tsx`, `src/components/Preferences/GeneralTab.newArticles.test.tsx`
- Modify: `src/components/ArticleList/ArticleList.tsx`, `src/components/Preferences/GeneralTab.tsx`, `src/styles/index.css`, `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json`, `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`

**Interfaces:**
- Consumes (tâche 2) : `feedStore.newInView`, `feedStore.loadNewArticles()`, `uiStore.showNewArticlesPill`, `uiStore.setShowNewArticlesPill(v)`. Existants : `prefersReducedMotion()` (déjà importé dans `ArticleList.tsx`), `ToggleSwitch` (props `checked`, `onChange`, `ariaLabel`).
- Produces : `export default function NewArticlesPill(props: { count: number; onClick: () => void })`.

Chaque « Remplacer … par … » doit correspondre **une seule fois** ; sinon, s'arrêter et le signaler (NEEDS_CONTEXT).

- [ ] **Step 1: Écrire les tests qui échouent**

`src/components/ArticleList/NewArticlesPill.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import NewArticlesPill from './NewArticlesPill';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

describe('NewArticlesPill', () => {
  it('shows nothing at zero, but keeps its live region mounted', () => {
    const { container } = render(<NewArticlesPill count={0} onClick={() => {}} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the count and runs the action on click', () => {
    const onClick = vi.fn();
    render(<NewArticlesPill count={3} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh\.newArticles:3/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the same button when the count changes, so the entrance does not replay', () => {
    const { rerender } = render(<NewArticlesPill count={3} onClick={() => {}} />);
    const first = screen.getByRole('button');
    rerender(<NewArticlesPill count={5} onClick={() => {}} />);
    expect(screen.getByRole('button')).toBe(first);
    expect(first.textContent).toContain('refresh.newArticles:5');
  });
});
```

`src/components/Preferences/GeneralTab.newArticles.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: { getState: () => ({ selectedFeed: null }) },
}));

import GeneralTab from './GeneralTab';
import { useUiStore } from '../../stores/uiStore';

describe('GeneralTab — signaler les nouveaux articles', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  it('shows the setting on, and turns it off', () => {
    render(<GeneralTab />);
    const toggle = screen.getByLabelText('preferences.general.newArticlesPill');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/components/ArticleList/NewArticlesPill.test.tsx src/components/Preferences/GeneralTab.newArticles.test.tsx`
Expected: FAIL — `Failed to resolve import "./NewArticlesPill"` et `Unable to find a label with the text of: preferences.general.newArticlesPill`.

- [ ] **Step 3: La pastille**

`src/components/ArticleList/NewArticlesPill.tsx` :

```tsx
import { useTranslation } from 'react-i18next';

interface NewArticlesPillProps {
  /** Articles arrivés dans la vue depuis son chargement (`feedStore.newInView`). */
  count: number;
  onClick: () => void;
}

/**
 * Pastille « ↑ N nouveaux articles » (discussion #14).
 * Spec : docs/superpowers/specs/2026-09-17-new-articles-pill-design.md
 *
 * L'emplacement est `sticky` et de hauteur nulle : il colle en haut de la liste
 * sans rien décaler. La région `aria-live` reste montée même à zéro, sinon le
 * premier nombre ne serait pas annoncé. Le bouton reste le MÊME élément quand
 * le nombre change : l'animation d'entrée ne se rejoue pas.
 */
export default function NewArticlesPill({ count, onClick }: NewArticlesPillProps) {
  const { t } = useTranslation();
  return (
    <div className="new-articles-slot" aria-live="polite">
      {count > 0 && (
        <button type="button" className="new-articles-pill" onClick={onClick}>
          <span aria-hidden="true">↑</span>
          <span>{t('refresh.newArticles', { count })}</span>
        </button>
      )}
    </div>
  );
}
```

Dans `src/styles/index.css`, ajouter **à la fin du fichier** :

```css

/* ── Pastille « nouveaux articles » (discussion #14) ─────────────────── */
/* Emplacement collant de hauteur nulle : la pastille flotte en haut de la
   liste sans décaler les lignes. Couleurs de l'accent, texte `--on-accent`
   (le blanc sur l'accent par défaut ne fait que 1,9:1). Entrée animée une
   seule fois ; rien sous « réduire les animations ». */
.new-articles-slot {
  position: sticky;
  top: 0;
  z-index: 15;
  height: 0;
  display: flex;
  justify-content: center;
}
.new-articles-pill {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  animation: new-articles-in 0.3s ease-out;
}
@keyframes new-articles-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .new-articles-pill { animation: none; }
}
@media (pointer: coarse) {
  .new-articles-pill { min-height: 44px; }
}
```

- [ ] **Step 4: Monter la pastille dans `ArticleList.tsx`**

Remplacer `import ArticleContextMenu from './ArticleContextMenu';` par :

```ts
import ArticleContextMenu from './ArticleContextMenu';
import NewArticlesPill from './NewArticlesPill';
```

Remplacer :

```ts
  const pushToast = useUiStore((s) => s.pushToast);
```

par :

```ts
  const pushToast = useUiStore((s) => s.pushToast);
  const showNewArticlesPill = useUiStore((s) => s.showNewArticlesPill);
  const newInView = useFeedStore((s) => s.newInView);
  const loadNewArticles = useFeedStore((s) => s.loadNewArticles);
```

Remplacer :

```tsx
      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden nice-scroll relative">
        {/* Pull-to-refresh spinner */}
```

par :

```tsx
      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden nice-scroll relative">
        {showNewArticlesPill && (
          <NewArticlesPill
            count={newInView}
            onClick={() => {
              void loadNewArticles();
              listRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            }}
          />
        )}
        {/* Pull-to-refresh spinner */}
```

- [ ] **Step 5: L'interrupteur dans `GeneralTab.tsx`**

Remplacer :

```ts
  const setMarkReadOnScroll = useUiStore((s) => s.setMarkReadOnScroll);
```

par :

```ts
  const setMarkReadOnScroll = useUiStore((s) => s.setMarkReadOnScroll);
  const showNewArticlesPill = useUiStore((s) => s.showNewArticlesPill);
  const setShowNewArticlesPill = useUiStore((s) => s.setShowNewArticlesPill);
```

Remplacer :

```tsx
        {/* Play YouTube videos in the article (click-to-load facade) */}
```

par :

```tsx
        {/* Signal articles that arrived since the list was loaded (discussion #14) */}
        <div className="flex items-start justify-between gap-4 select-none mt-4">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.general.newArticlesPill')}
            <span className="block text-[11px] opacity-70 mt-0.5">
              {t('preferences.general.newArticlesPillHint')}
            </span>
          </span>
          <span className="mt-0.5">
            <ToggleSwitch
              checked={showNewArticlesPill}
              onChange={setShowNewArticlesPill}
              ariaLabel={t('preferences.general.newArticlesPill')}
            />
          </span>
        </div>

        {/* Play YouTube videos in the article (click-to-load facade) */}
```

- [ ] **Step 6: Les 10 locales**

```bash
node <<'EOF'
const fs = require('fs');
const add = {
  fr: ['Signaler les nouveaux articles', "Une pastille en haut de la liste compte les articles arrivés depuis son chargement et les affiche d'un clic. La liste ne change jamais d'elle-même."],
  en: ['Show new articles', 'A pill at the top of the list counts the articles that arrived since it loaded, and shows them in one click. The list never changes on its own.'],
  de: ['Neue Artikel anzeigen', 'Ein Hinweis oben in der Liste zählt die seit dem Laden eingetroffenen Artikel und zeigt sie mit einem Klick an. Die Liste ändert sich nie von selbst.'],
  es: ['Avisar de artículos nuevos', 'Una etiqueta en la parte superior de la lista cuenta los artículos llegados desde que se cargó y los muestra con un clic. La lista nunca cambia por sí sola.'],
  it: ['Segnala nuovi articoli', "Un'etichetta in cima alla lista conta gli articoli arrivati da quando è stata caricata e li mostra con un clic. La lista non cambia mai da sola."],
  nl: ['Nieuwe artikelen melden', 'Een label boven aan de lijst telt de artikelen die sinds het laden zijn binnengekomen en toont ze met één klik. De lijst verandert nooit vanzelf.'],
  pl: ['Informuj o nowych artykułach', 'Plakietka u góry listy liczy artykuły, które przyszły od jej wczytania, i pokazuje je jednym kliknięciem. Lista nigdy nie zmienia się sama.'],
  pt: ['Assinalar novos artigos', 'Uma etiqueta no topo da lista conta os artigos que chegaram desde que foi carregada e mostra-os com um clique. A lista nunca muda sozinha.'],
  uk: ['Повідомляти про нові статті', 'Позначка вгорі списку рахує статті, що надійшли після його завантаження, і показує їх одним натисканням. Список ніколи не змінюється сам.'],
  zh: ['提示新文章', '列表顶部的标签会统计列表加载后新到的文章，点一下即可显示。列表不会自行变化。'],
};
for (const [l, [label, hint]] of Object.entries(add)) {
  const p = `src/locales/${l}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if ('newArticlesPill' in j.preferences.general) throw new Error(`${l}: key already present`);
  j.preferences.general.newArticlesPill = label;
  j.preferences.general.newArticlesPillHint = hint;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
EOF
```

Expected: `ok`. Puis la commande de parité de `CLAUDE.md` → `parité ok (10 locales : …)`, et `git diff --numstat src/locales` : chaque fichier `3	1`.

- [ ] **Step 7: Vérifier que les tests passent**

Run: `npx vitest run src/components/ArticleList/ src/components/Preferences/ src/stores/ src/lib/newArticles.test.ts src/lib/i18nCoverage.test.ts src/lib/featuresDoc.test.ts`
Expected: PASS — dont « fige 232 réglages ».

- [ ] **Step 8: `docs/FEATURES.md`**

Remplacer la ligne `### Marquer lu au défilement` par :

```markdown
### Pastille « nouveaux articles »
Une pastille « ↑ N nouveaux articles » en haut de la liste signale les articles
arrivés dans la vue affichée depuis son chargement ; un clic les charge et
remonte en haut. La liste ne change jamais d'elle-même. Réglage « Signaler les
nouveaux articles » (Préférences → Général, synchronisé, **activé** par
défaut). Demandé dans la discussion #14.

- **Où** : `src/lib/newArticles.ts` (`viewFeedIds`, `countNewInView`, testés),
  `feedStore.newInView` et `loadNewArticles` (cumul dans `syncCounts`),
  `src/components/ArticleList/NewArticlesPill.tsx`,
  `uiStore.showNewArticlesPill`
- **Spec** : `docs/superpowers/specs/2026-09-17-new-articles-pill-design.md`
- **Le signal** : à chaque relevé des compteurs (60 s), `computeRefreshDelta()`
  compare les compteurs du serveur à ceux du store ; seules les hausses des
  flux de la vue comptent. Une action locale a déjà mis le compteur à jour :
  elle ne produit aucune hausse. Au premier relevé, sans compteur connu, rien
  n'est compté — tout le stock passerait pour une arrivée.
- **Vues** : un flux, une catégorie (ses flux), l'accueil en `all` ou
  `unread`. Pas d'étiquette, de Favoris, d'À lire plus tard ni de recherche.
- **Remise à zéro** : `loadArticles` (changement de vue, Rafraîchir), fin d'un
  `silentRefresh` (retour sur l'onglet), `loadNewArticles`.
- **Limite** : un article marqué non lu sur un autre appareil compte comme une
  arrivée ; des arrivées et des lectures faites ailleurs dans le même
  intervalle, sur le même flux, peuvent s'annuler.
- **Discrète par construction** : l'emplacement est `sticky` et de hauteur
  nulle (rien ne se décale) ; l'entrée n'est animée qu'une fois, le bouton
  restant le même élément quand le nombre change ; aucune animation sous
  `prefers-reduced-motion` ; région `aria-live="polite"` toujours montée ;
  44 px de haut au doigt ; texte `--on-accent` sur l'accent.
- **À ne pas confondre** avec `RefreshBanner`, la notification de 5 s qui suit
  un clic sur Rafraîchir.

### Marquer lu au défilement
```

- [ ] **Step 9: `docs/RELEASE-NEXT.md`**

Remplacer :

```markdown
## Fonctionnalités

_(rien pour l'instant)_
```

par :

```markdown
## Fonctionnalités

- **Une pastille signale les nouveaux articles.** Quand de nouveaux articles
  arrivent dans la vue affichée, « ↑ N nouveaux articles » apparaît en haut de
  la liste ; un clic les charge. La liste ne change jamais d'elle-même.
  Désactivable dans Préférences → Général. Demandé dans la discussion #14.
```

- [ ] **Step 10: Gates, garde-fou, commit**

```bash
git add src/components/ArticleList/NewArticlesPill.tsx src/components/ArticleList/NewArticlesPill.test.tsx src/components/ArticleList/ArticleList.tsx src/components/Preferences/GeneralTab.tsx src/components/Preferences/GeneralTab.newArticles.test.tsx src/styles/index.css src/locales docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "feat(list): show a new-articles pill, with a setting to turn it off"
```

---

### Task 4: Vérification réelle et livraison (contrôleur)

**Files:** aucun, sauf correction d'un défaut trouvé ici (nouveau commit, gates et garde-fou compris).

- [ ] **Step 1: Rendu local** — monter `NewArticlesPill` contre la feuille de styles réelle : à **320 px**, sur tablette et desktop, thème clair et sombre ; mesurer que l'emplacement ne décale rien (hauteur 0) et que la pastille fait 44 px au doigt.
- [ ] **Step 2: Pousser `dev`**, puis `gh run list --branch dev --limit 2` → **CI** et **Publish image** en succès.
- [ ] **Step 3: Après redéploiement par le propriétaire**, sur l'instance de dev : forcer une hausse (marquer non lu un article du flux affiché **depuis un autre onglet**, attendre le relevé) → la pastille apparaît ; un clic recharge et la fait disparaître ; désactiver le réglage → plus de pastille ; remettre en état tout ce qui a été modifié.
