# Saved Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user file saved articles into categories they create — at the moment of saving, from the sidebar, or by dragging — without inventing a new data model.

**Architecture:** A category is a prefixed sub-label (`À lire plus tard/Veille`). A pure lib derives the categories of a prefix, builds ids and filters them out of the ÉTIQUETTES section. The sidebar renders them under Favoris / À lire plus tard using the existing label row, which already accepts article drops. A compact picker offers "file it" at save time.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest, i18next (9 locales).

## Global Constraints

- **No AI mentions anywhere**; neutral conventional commits.
- **Public repo — CI "Leak guard"**: run the grep, **read it**, then commit.
- **After every push, watch BOTH workflows** (`CI` and `Publish image`).
- **i18n**: every new string in all 9 locales, then the parity audit must pass.
- **Gates before every commit**: `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **TDD**: pure logic in `src/lib/*.ts`, test-first.
- **Reuse, do not rebuild**: `groupLabels` already renders `Parent/Child`; `FilterItem` and the label row already accept `onArticleDrop`; the reading pane already creates labels on the fly.

---

### Task 1: Pure lib — derive, build, filter

**Files:** Create `src/lib/savedCategories.ts` and `src/lib/savedCategories.test.ts`.

**Interfaces:**
- `READ_LATER_PREFIX` = `'À lire plus tard'`, `STARRED_PREFIX` = `'Favoris'`
- `interface SavedCategory { id: string; name: string }`
- `savedCategories(labels: Tag[], prefix: string): SavedCategory[]`
- `categoryLabelId(prefix: string, name: string): string`
- `isSavedCategory(labelId: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  savedCategories, categoryLabelId, isSavedCategory,
  READ_LATER_PREFIX, STARRED_PREFIX,
} from './savedCategories';
import type { Tag } from '../types';

const tag = (name: string): Tag => ({ id: `user/-/label/${name}` } as Tag);

describe('savedCategories', () => {
  const labels = [
    tag(READ_LATER_PREFIX),
    tag(`${READ_LATER_PREFIX}/Veille`),
    tag(`${READ_LATER_PREFIX}/Recettes`),
    tag(`${STARRED_PREFIX}/Perso`),
    tag('Autre'),
  ];

  it('returns only the sub-labels of the prefix', () => {
    expect(savedCategories(labels, READ_LATER_PREFIX).map((c) => c.name))
      .toEqual(['Recettes', 'Veille']);
  });

  it('never returns the prefix label itself', () => {
    expect(savedCategories(labels, READ_LATER_PREFIX).some((c) => c.name === '')).toBe(false);
  });

  it('keeps the full label id', () => {
    expect(savedCategories(labels, STARRED_PREFIX)[0].id)
      .toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });

  it('sorts by name', () => {
    expect(savedCategories(labels, READ_LATER_PREFIX).map((c) => c.name))
      .toEqual(['Recettes', 'Veille']);
  });

  it('returns nothing for a prefix with no category', () => {
    expect(savedCategories([tag('Autre')], READ_LATER_PREFIX)).toEqual([]);
  });

  it('handles an empty label list', () => {
    expect(savedCategories([], READ_LATER_PREFIX)).toEqual([]);
  });
});

describe('categoryLabelId', () => {
  it('builds a prefixed id', () => {
    expect(categoryLabelId(STARRED_PREFIX, 'Perso')).toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });
  it('trims the name', () => {
    expect(categoryLabelId(STARRED_PREFIX, '  Perso  ')).toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });
  it('strips slashes, which would create a nested level', () => {
    expect(categoryLabelId(STARRED_PREFIX, 'A/B')).toBe(`user/-/label/${STARRED_PREFIX}/A B`);
  });
});

describe('isSavedCategory', () => {
  it('recognises both prefixes', () => {
    expect(isSavedCategory(`user/-/label/${READ_LATER_PREFIX}/Veille`)).toBe(true);
    expect(isSavedCategory(`user/-/label/${STARRED_PREFIX}/Perso`)).toBe(true);
  });
  it('does not match the prefix labels themselves', () => {
    expect(isSavedCategory(`user/-/label/${READ_LATER_PREFIX}`)).toBe(false);
  });
  it('does not match an unrelated label', () => {
    expect(isSavedCategory('user/-/label/Autre')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement `src/lib/savedCategories.ts`**

```ts
import type { Tag } from '../types';

// A category is a prefixed sub-label: the data model already supports it
// (groupLabels renders Parent/Child), so nothing new is introduced.
// The prefixes are literal and French, matching READ_LATER_LABEL which the app
// already hard-codes regardless of the interface language.
export const READ_LATER_PREFIX = 'À lire plus tard';
export const STARRED_PREFIX = 'Favoris';

export interface SavedCategory {
  id: string;
  name: string;
}

const BASE = 'user/-/label/';

/** Categories filed under a prefix, named without it, sorted. */
export function savedCategories(labels: Tag[], prefix: string): SavedCategory[] {
  const head = `${BASE}${prefix}/`;
  return labels
    .filter((t) => t.id.startsWith(head) && t.id.length > head.length)
    .map((t) => ({ id: t.id, name: t.id.slice(head.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Label id for a category. Slashes are stripped: one level only. */
export function categoryLabelId(prefix: string, name: string): string {
  return `${BASE}${prefix}/${name.trim().replace(/\//g, ' ')}`;
}

/** Is this label one of the saved-article categories (hidden from ÉTIQUETTES)? */
export function isSavedCategory(labelId: string): boolean {
  return [READ_LATER_PREFIX, STARRED_PREFIX].some(
    (p) => labelId.startsWith(`${BASE}${p}/`) && labelId.length > `${BASE}${p}/`.length,
  );
}
```

- [ ] **Step 4: Run to verify they pass** (13 tests).

- [ ] **Step 5: Gates, leak guard, commit** — `feat(saved): pure helpers for saved-article categories`

---

### Task 2: Categories in the sidebar

**Files:** Modify `src/components/Sidebar/Sidebar.tsx`, `src/stores/uiStore.ts`.

- [ ] **Step 1: Collapse state**

In `uiStore`, next to `labelsCollapsed`, add a synced pair:

```ts
  /** Collapsed state of the category lists under Favoris / À lire plus tard. */
  savedCollapsed: Record<string, boolean>;
  toggleSavedCollapsed: (prefix: string) => void;
```

```ts
  savedCollapsed: loadJson('frirss_savedCollapsed', {} as Record<string, boolean>),
  toggleSavedCollapsed: (prefix) => {
    set((state) => {
      const next = { ...state.savedCollapsed, [prefix]: !state.savedCollapsed[prefix] };
      localStorage.setItem('frirss_savedCollapsed', JSON.stringify(next));
      return { savedCollapsed: next };
    });
  },
```

Add `'savedCollapsed'` to the `jsonKeys` array **and** to `UI_SYNC_KEYS`.

- [ ] **Step 2: Render the categories**

In `Sidebar.tsx`, import:

```ts
import {
  savedCategories, categoryLabelId, isSavedCategory,
  READ_LATER_PREFIX, STARRED_PREFIX,
} from '../../lib/savedCategories';
```

After each of the two `FilterItem`s (starred, read-later), render its categories.
Both share one small component defined in this file:

```tsx
function SavedCategories({ prefix, filterKind }: { prefix: string; filterKind: 'starred' | 'readlater' }) {
  const { labels, selectedFeed, selectView, toggleArticleLabel } = useFeedStore();
  const collapsed = useUiStore((s) => s.savedCollapsed[prefix]);
  const cats = useMemo(() => savedCategories(labels, prefix), [labels, prefix]);
  if (collapsed || !cats.length) return null;
  return (
    <div className="ml-4">
      {cats.map((cat) => (
        <FilterItem
          key={cat.id}
          icon={<CategoryGlyph />}
          label={cat.name}
          active={selectedFeed?.id === cat.id}
          onClick={() => selectView({ id: cat.id, title: cat.name } as Subscription)}
          // Dropping an article files it here — the row already supports it.
          onArticleDrop={(article) => { toggleArticleLabel(article, cat.id); }}
        />
      ))}
    </div>
  );
}
```

> `filterKind` is unused for now; drop the prop if lint complains rather than
> keeping dead API surface.

Add a chevron to the two parent `FilterItem`s that calls `toggleSavedCollapsed(prefix)`, following the existing category-header chevron pattern in this file (`sidebar.expandCategory` / `sidebar.collapseCategory` already exist in all locales).

- [ ] **Step 3: Hide these labels from the ÉTIQUETTES section**

Where the labels list is built for that section, filter them out:

```ts
    () => groupLabels(labels.filter((t) => !isSavedCategory(t.id)), labelOrder, labelSortAlpha),
```

- [ ] **Step 4: Gates + commit** — `feat(saved): show saved categories under Favoris and Read later`

---

### Task 3: File it at save time

**Files:** Create `src/components/ArticleList/SavedCategoryPicker.tsx`; modify `src/components/ArticleList/ArticleActions.tsx`.

- [ ] **Step 1: The picker**

A small popover listing the categories of a prefix plus a "create" input.
Props: `{ prefix, article, onClose }`. It calls
`useFeedStore().toggleArticleLabel(article, categoryLabelId(prefix, name))` and
closes. Reuse the reading pane's create-label input as the model
(`ReadingPane.tsx` around the `newLabel` state).

- [ ] **Step 2: The secondary gesture**

In `ArticleActions.tsx`, `StarButton` and `ReadLaterButton` gain an optional
`onFile?: () => void`. A **long press** (touch, ~500 ms) or a **right-click**
opens the picker; a plain click keeps today's instant behaviour untouched.

```ts
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => { if (onFile) longPress.current = setTimeout(onFile, 500); };
  const cancel = () => { if (longPress.current) clearTimeout(longPress.current); };
```

wired as `onTouchStart={start} onTouchEnd={cancel} onTouchMove={cancel}
onContextMenu={(e) => { if (onFile) { e.preventDefault(); onFile(); } }}`.

- [ ] **Step 3: Gates + commit** — `feat(saved): file an article into a category as you save it`

---

### Task 4: i18n

- [ ] **Step 1: Add the strings to all 9 locales** — category glyph label, "New category", "File into…", the create placeholder.

- [ ] **Step 2: Run the parity audit**

```bash
node -e '
const fs=require("fs");
const langs=["fr","en","de","es","it","nl","pl","pt","uk"];
const flat=(o,p="")=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==="object"?flat(v,p+k+"."):[p+k]);
const k={}; for(const l of langs) k[l]=new Set(flat(JSON.parse(fs.readFileSync(`src/locales/${l}.json`,"utf8"))));
let bad=0; for(const l of langs){if(l==="fr")continue;const m=[...k.fr].filter(x=>!k[l].has(x)&&!/_(few|many)$/.test(x));if(m.length){bad++;console.log(l,m)}}
console.log(bad?"PARITY BROKEN":"parity ok");'
```

Expected: `parity ok`.

- [ ] **Step 3: Commit** — `feat(saved): translate the category strings`

---

### Task 5: Verify and deploy

- [ ] **Step 1: Full gates.**
- [ ] **Step 2: Browser verification** — exercise the pure lib through the real modules (categories of a prefix, id building, slash stripping, ÉTIQUETTES filtering) and check the console for new errors.
- [ ] **Step 3: Leak guard, read it, push.**
- [ ] **Step 4: Watch BOTH workflows to success.**
- [ ] **Step 5: Deploy the dev instance** (same env and labels; specifics live outside this repo; allow ~12 s before the health check).
- [ ] **Step 6: Hand off** — tell the user to create a category from a save, expand Favoris / À lire plus tard in the sidebar, and drag an article onto a category.

---

## Notes for the implementer

- **Nothing new in the data model**: a category is a label. If a step seems to
  need a new store or migration, it has gone off-plan.
- **Drag & drop is free**: the sidebar row already handles `onArticleDrop`.
  Reuse it rather than writing a second drop handler.
- **Never slow the plain click**: the long press must not delay or swallow it.
