# Offline Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make offline article images reliable (thumbnails included, prefetch no longer tied to extraction) and bounded (user-chosen budget, real usage shown, one-click purge).

**Architecture:** Three pure helpers in `src/lib/` carry the decisions (which URLs, how big a budget, in what order). `feedStore.prepareOffline` becomes: collect → prioritise → prefetch images in bounded parallel batches, stopping when the browser-reported storage delta reaches the budget. Preferences gain a preset picker, live usage/quota readout and a purge button. Workbox keeps a hard entry cap as a safety net.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest (+ @testing-library/react, jsdom), Workbox via vite-plugin-pwa, i18next (9 locales).

## Global Constraints

- **No AI mentions anywhere** — commit messages neutral/conventional, no `Co-Authored-By`, nothing referencing prompts/conversation.
- **Public repo — CI "Leak guard"**: never commit the personal domain name, internal IPs, ports, volume paths or config hashes, **including in docs**. Write the pattern with brackets (as the workflow itself does) so this very rule does not trip the guard. Verify before every commit:
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'` → must print nothing.
- **After every push, check BOTH workflows**: `CI` *and* `Publish image` (`gh run list --branch dev --limit 2`). A red `CI` from the leak guard means lint/typecheck/test never ran.
- **i18n**: every new UI string in all 9 locales `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`.
- **Gates before every commit**: `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **TDD**: pure logic in `src/lib/*.ts` with `*.test.ts`, test-first.
- **Opaque responses**: images are fetched cross-origin with `no-cors`, so their byte size is unreadable from JS and padded in Cache Storage. Never present sizes as exact — the UI says "environ" / "~". Budget enforcement watches `navigator.storage.estimate().usage` progression; it is an approximation by design.
- **No import cycles**: `feedStore` will import from `src/lib/offlineImages.ts`, so that file must **not** import from any store (pass values like the read-later label as parameters).

---

### Task 1: Pure helpers — URL collection, budget, priority

**Files:**
- Create: `src/lib/offlineImages.ts`
- Create: `src/lib/offlineImages.test.ts`

**Interfaces:**
- Produces:
  - `type OfflineImagePreset = 'none' | 'light' | 'standard' | 'max' | 'custom'`
  - `interface ImageBudget { bytes: number; perArticle: number }`
  - `imageBudget(preset: OfflineImagePreset, customMb: number): ImageBudget`
  - `collectImageUrls(html: string, limit: number): string[]`
  - `prioritizeForOffline(articles: Article[], readLaterLabel: string): Article[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/offlineImages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageBudget, collectImageUrls, prioritizeForOffline } from './offlineImages';
import type { Article } from '../types';

const MB = 1024 * 1024;

describe('imageBudget', () => {
  it('downloads nothing when disabled', () => {
    expect(imageBudget('none', 500)).toEqual({ bytes: 0, perArticle: 0 });
  });
  it('keeps only the thumbnail on the light preset', () => {
    expect(imageBudget('light', 500)).toEqual({ bytes: 200 * MB, perArticle: 1 });
  });
  it('allows body images on standard', () => {
    expect(imageBudget('standard', 500)).toEqual({ bytes: 500 * MB, perArticle: 6 });
  });
  it('allows more on max', () => {
    expect(imageBudget('max', 500)).toEqual({ bytes: 1000 * MB, perArticle: 10 });
  });
  it('honours a custom size', () => {
    expect(imageBudget('custom', 250)).toEqual({ bytes: 250 * MB, perArticle: 6 });
  });
  it('clamps a nonsensical custom size', () => {
    expect(imageBudget('custom', 0).bytes).toBe(50 * MB);
    expect(imageBudget('custom', 99999).bytes).toBe(5000 * MB);
  });
});

describe('collectImageUrls', () => {
  it('returns http(s) image sources in order', () => {
    const html = '<img src="https://a/1.jpg"><p>x</p><img src="http://b/2.png">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg', 'http://b/2.png']);
  });
  it('drops data: and relative sources', () => {
    const html = '<img src="data:image/png;base64,AAA"><img src="/local.jpg"><img src="https://a/1.jpg">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg']);
  });
  it('de-duplicates repeated sources', () => {
    const html = '<img src="https://a/1.jpg"><img src="https://a/1.jpg">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg']);
  });
  it('respects the limit', () => {
    const html = '<img src="https://a/1.jpg"><img src="https://a/2.jpg"><img src="https://a/3.jpg">';
    expect(collectImageUrls(html, 2)).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });
  it('returns nothing for a zero limit or empty html', () => {
    expect(collectImageUrls('<img src="https://a/1.jpg">', 0)).toEqual([]);
    expect(collectImageUrls('', 5)).toEqual([]);
  });
});

const art = (over: Partial<Article>): Article => ({
  id: 'x', title: 't', summary: '', content: '', author: '', url: 'u',
  source: 's', sourceId: 'f', published: 0, read: false, starred: false,
  labels: [], tags: [], ...over,
});

describe('prioritizeForOffline', () => {
  const LATER = 'user/-/label/Read later';

  it('puts read-later and starred first', () => {
    const later = art({ id: 'later', published: 1, read: true, labels: [LATER] });
    const starred = art({ id: 'starred', published: 2, starred: true, read: true });
    const unread = art({ id: 'unread', published: 9 });
    const out = prioritizeForOffline([unread, later, starred], LATER);
    expect(out.slice(0, 2).map((a) => a.id).sort()).toEqual(['later', 'starred']);
    expect(out[2].id).toBe('unread');
  });

  it('orders unread before read', () => {
    const read = art({ id: 'read', published: 10, read: true });
    const unread = art({ id: 'unread', published: 1 });
    expect(prioritizeForOffline([read, unread], LATER).map((a) => a.id)).toEqual(['unread', 'read']);
  });

  it('orders each group newest first', () => {
    const old = art({ id: 'old', published: 1 });
    const recent = art({ id: 'recent', published: 5 });
    expect(prioritizeForOffline([old, recent], LATER).map((a) => a.id)).toEqual(['recent', 'old']);
  });

  it('does not mutate the input array', () => {
    const input = [art({ id: 'a', published: 1 }), art({ id: 'b', published: 2 })];
    const copy = [...input];
    prioritizeForOffline(input, LATER);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/offlineImages.test.ts`
Expected: FAIL — cannot find module `./offlineImages`.

- [ ] **Step 3: Implement `src/lib/offlineImages.ts`**

```ts
import type { Article } from '../types';

const MB = 1024 * 1024;
const CUSTOM_MIN_MB = 50;
const CUSTOM_MAX_MB = 5000;

/** How much offline image data to keep, and how many images per article. */
export type OfflineImagePreset = 'none' | 'light' | 'standard' | 'max' | 'custom';

export interface ImageBudget {
  /** Approximate byte budget — enforced against navigator.storage estimates. */
  bytes: number;
  /** Images downloaded per article (1 = thumbnail only). */
  perArticle: number;
}

export function imageBudget(preset: OfflineImagePreset, customMb: number): ImageBudget {
  switch (preset) {
    case 'none':
      return { bytes: 0, perArticle: 0 };
    case 'light':
      return { bytes: 200 * MB, perArticle: 1 };
    case 'max':
      return { bytes: 1000 * MB, perArticle: 10 };
    case 'custom': {
      const mb = Math.min(CUSTOM_MAX_MB, Math.max(CUSTOM_MIN_MB, Math.round(customMb) || 0));
      return { bytes: mb * MB, perArticle: 6 };
    }
    case 'standard':
    default:
      return { bytes: 500 * MB, perArticle: 6 };
  }
}

/**
 * Absolute image URLs found in a fragment of article HTML, de-duplicated and
 * capped. Relative and data: sources are skipped — only what a browser would
 * fetch over the network is worth pre-caching.
 */
export function collectImageUrls(html: string, limit: number): string[] {
  if (!html || limit <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (!/^https?:\/\//i.test(src) || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Fill order when the budget runs out: things the user deliberately kept
 * (read-later, starred), then unread newest-first, then everything else.
 */
export function prioritizeForOffline(articles: Article[], readLaterLabel: string): Article[] {
  const rank = (a: Article): number => {
    if (a.starred || a.labels?.includes(readLaterLabel)) return 0;
    if (!a.read) return 1;
    return 2;
  };
  return [...articles].sort((a, b) => rank(a) - rank(b) || b.published - a.published);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/offlineImages.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck && npm run lint && npx vitest run`

```bash
git add src/lib/offlineImages.ts src/lib/offlineImages.test.ts
git commit -m "feat(offline): pure helpers for image budget, URL collection and priority"
```

---

### Task 2: Storage estimate helper

**Files:**
- Create: `src/lib/storageEstimate.ts`
- Create: `src/lib/storageEstimate.test.ts`

**Interfaces:**
- Produces:
  - `getStorageEstimate(): Promise<{ usage: number; quota: number } | null>` — `null` when the API is unavailable.
  - `formatBytes(bytes: number): string` — e.g. `"340 Mo"`, `"1,2 Go"`.
  - `IMAGE_CACHE_NAME` (`'frirss-images'`) and `clearImageCache(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/storageEstimate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes } from './storageEstimate';

describe('formatBytes', () => {
  it('renders megabytes below a gigabyte', () => {
    expect(formatBytes(340 * 1024 * 1024)).toBe('340 Mo');
  });
  it('renders gigabytes with one decimal', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1,3 Go');
  });
  it('renders small sizes as 0 Mo rather than a fraction', () => {
    expect(formatBytes(1024)).toBe('0 Mo');
  });
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 Mo');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/storageEstimate.test.ts`
Expected: FAIL — cannot find module `./storageEstimate`.

- [ ] **Step 3: Implement `src/lib/storageEstimate.ts`**

```ts
/** Workbox runtime cache holding article images (see vite.config.js). */
export const IMAGE_CACHE_NAME = 'frirss-images';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Browser-reported storage for this origin. Covers everything (precache,
 * IndexedDB, image cache) — cross-origin images are opaque, so their real size
 * is never readable; this is the honest approximation. `null` when unsupported.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}

/** Human size, rounded — never presented as exact. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} Go`;
  return `${Math.round(bytes / MB)} Mo`;
}

/** Drop every cached image (the user-facing "empty the images" action). */
export async function clearImageCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete(IMAGE_CACHE_NAME);
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/storageEstimate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck && npm run lint && npx vitest run`

```bash
git add src/lib/storageEstimate.ts src/lib/storageEstimate.test.ts
git commit -m "feat(offline): storage estimate + image cache helpers"
```

---

### Task 3: Preferences in the store

**Files:**
- Modify: `src/stores/uiStore.ts`

**Interfaces:**
- Consumes: `OfflineImagePreset` (Task 1).
- Produces: `offlineImagePreset: OfflineImagePreset`, `setOfflineImagePreset(p)`, `offlineImageCustomMb: number`, `setOfflineImageCustomMb(mb)` — both synced per user.

- [ ] **Step 1: Add the import and the state fields**

At the top of `src/stores/uiStore.ts`, next to the other imports:

```ts
import type { OfflineImagePreset } from '../lib/offlineImages';
```

In `interface UiState`, right after the existing `autoOffline` pair (`autoOffline: boolean; setAutoOffline: (v: boolean) => void;`):

```ts
  // How much offline image data to keep (per user, synced). 'none' disables
  // image prefetch entirely; 'custom' uses offlineImageCustomMb.
  offlineImagePreset: OfflineImagePreset;
  setOfflineImagePreset: (p: OfflineImagePreset) => void;
  offlineImageCustomMb: number;
  setOfflineImageCustomMb: (mb: number) => void;
```

- [ ] **Step 2: Add the implementation**

In the store body, right after the `setAutoOffline` implementation (currently around lines 270-274):

```ts
  offlineImagePreset: loadJson<OfflineImagePreset>('frirss_offlineImagePreset', 'standard'),
  setOfflineImagePreset: (p) => {
    localStorage.setItem('frirss_offlineImagePreset', JSON.stringify(p));
    set({ offlineImagePreset: p });
  },
  offlineImageCustomMb: loadJson('frirss_offlineImageCustomMb', 500),
  setOfflineImageCustomMb: (mb) => {
    localStorage.setItem('frirss_offlineImageCustomMb', JSON.stringify(mb));
    set({ offlineImageCustomMb: mb });
  },
```

- [ ] **Step 3: Sync both keys**

In `applyServerPrefs`, add them to the `jsonKeys` array (the array starting `'showFavicons', 'topbarVisible', …`):

```ts
      'confirmMarkAllRead', 'offlineImagePreset', 'offlineImageCustomMb',
```

(replacing the existing `'confirmMarkAllRead',` line in that array)

And in the exported `UI_SYNC_KEYS`, replace the existing `'confirmMarkAllRead',` entry with:

```ts
  'confirmMarkAllRead', 'offlineImagePreset', 'offlineImageCustomMb',
```

- [ ] **Step 4: Gates + commit**

Run: `npm run typecheck && npm run lint && npx vitest run`

```bash
git add src/stores/uiStore.ts
git commit -m "feat(offline): store the offline image budget preference"
```

---

### Task 4: Rework the prefetch in feedStore

The heart of the change: image prefetch stops depending on extraction, covers RSS thumbnails, runs in bounded parallel batches, follows the priority order and stops at the budget.

**Files:**
- Modify: `src/stores/feedStore.ts`

**Interfaces:**
- Consumes: `collectImageUrls`, `imageBudget`, `prioritizeForOffline` (Task 1); `getStorageEstimate` (Task 2); `offlineImagePreset` / `offlineImageCustomMb` (Task 3).

- [ ] **Step 1: Add the imports**

Near the other `src/lib` imports in `src/stores/feedStore.ts`:

```ts
import { collectImageUrls, imageBudget, prioritizeForOffline } from '../lib/offlineImages';
import { getStorageEstimate } from '../lib/storageEstimate';
```

`useUiStore` must also be reachable; if `feedStore` does not already import it, add:

```ts
import { useUiStore } from './uiStore';
```

(If that import creates a cycle warning at build time, read the preference lazily instead via `(await import('./uiStore')).useUiStore.getState()` inside `prepareOffline`.)

- [ ] **Step 2: Replace `prefetchImages` with an article-aware, parallel version**

Replace the whole existing function (currently `async function prefetchImages(html: string): Promise<void> { … }`, around lines 230-244) with:

```ts
// Fetch images so the service worker caches them for offline viewing
// (CacheFirst). Cross-origin images are opaque: we cannot read their size, so
// the caller enforces the budget from storage estimates. Best-effort.
async function fetchImages(urls: string[]): Promise<void> {
  const BATCH = 4;
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map((src) =>
        fetch(src, { mode: 'no-cors', cache: 'force-cache' }).catch(() => undefined),
      ),
    );
  }
}

/**
 * Image URLs worth caching for one article: the RSS thumbnail first (it is what
 * the list and the grid render), then body images from the extracted content.
 */
function articleImageUrls(rssHtml: string, extractedHtml: string | null, perArticle: number): string[] {
  if (perArticle <= 0) return [];
  const thumb = collectImageUrls(rssHtml, 1);
  if (perArticle === 1) return thumb;
  const body = collectImageUrls(extractedHtml || rssHtml, perArticle);
  return Array.from(new Set([...thumb, ...body])).slice(0, perArticle);
}
```

- [ ] **Step 3: Rewrite phase 2 of `prepareOffline`**

In `prepareOffline`, replace the whole "Phase 2" block — from the line
`    // Phase 2 — extract + cache + prefetch images.` down to and including the
closing of its `for` loop and the final `set({ offlinePrep: { running: false, phase: 'done', done, total: collected.length } });` — with:

```ts
    // Phase 2 — extract, cache, and prefetch images.
    // Images are prefetched whether or not the extract was already cached (the
    // two used to be coupled, which silently skipped images), in priority order,
    // and stop as soon as the storage budget is reached.
    const ui = useUiStore.getState();
    const budget = imageBudget(ui.offlineImagePreset, ui.offlineImageCustomMb);
    const ordered = prioritizeForOffline(collected, READ_LATER_LABEL);
    const baseline = (await getStorageEstimate())?.usage ?? 0;
    let budgetReached = budget.bytes <= 0;

    set({ offlinePrep: { running: true, phase: 'articles', done: 0, total: ordered.length } });
    const { extractFullContent } = await import('../utils/extractContent');
    let done = 0;
    for (const a of ordered) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;

      let extracted: string | null = peekExtract(a.id)?.content ?? null;
      if (a.url && !extracted) {
        const stored = await getExtract(a.id);
        extracted = stored?.content ?? null;
        if (!extracted) {
          try {
            const content = await extractFullContent(a.url);
            await putExtract(a.id, content);
            extracted = content.content;
          } catch { /* keep the RSS content */ }
        }
      }

      if (!budgetReached) {
        await fetchImages(articleImageUrls(a.content, extracted, budget.perArticle));
        // Re-check every few articles — estimates are coarse, so polling often
        // costs more than it buys.
        if (done % 10 === 9) {
          const usage = (await getStorageEstimate())?.usage ?? 0;
          if (usage - baseline >= budget.bytes) budgetReached = true;
        }
      }

      done++;
      if (done % 5 === 0 || done === ordered.length) {
        set({ offlinePrep: { running: true, phase: 'articles', done, total: ordered.length } });
      }
    }
    set({ offlinePrep: { running: false, phase: 'done', done, total: ordered.length } });
```

> `peekExtract` / `getExtract` / `putExtract` are already imported by `feedStore`.
> Both `peekExtract` and `getExtract` return `ExtractedContent | undefined`, and
> `ExtractedContent` (in `src/utils/extractContent.ts`) has a `content: string`
> field — so the `?.content` reads above are correct as written.

- [ ] **Step 4: Remove the now-unused old call site**

Search for any remaining `prefetchImages(` reference in `src/stores/feedStore.ts` and remove or convert it — `npm run lint` fails on unused functions, so the file must have no leftovers.

Run: `grep -n "prefetchImages" src/stores/feedStore.ts`
Expected: no output.

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`

```bash
git add src/stores/feedStore.ts
git commit -m "feat(offline): prefetch images independently of extraction, in priority order"
```

---

### Task 5: Preferences UI — preset, usage, purge

**Files:**
- Modify: `src/components/Preferences/Preferences.tsx` (`OfflineTab`, currently around line 2778)
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk}.json`

**Interfaces:**
- Consumes: `imageBudget` (Task 1); `getStorageEstimate`, `formatBytes`, `clearImageCache` (Task 2); the store preference (Task 3).

- [ ] **Step 1: Add the strings to all 9 locales**

```bash
node -e '
const fs=require("fs");
const add={
 imagesTitle:{fr:"Images hors ligne",en:"Offline images",de:"Offline-Bilder",es:"Imágenes sin conexión",it:"Immagini offline",nl:"Offline afbeeldingen",pl:"Obrazy offline",pt:"Imagens offline",uk:"Зображення офлайн"},
 imagesHint:{fr:"Quantité d’images conservées pour la lecture hors ligne. Les tailles sont approximatives.",en:"How many images are kept for offline reading. Sizes are approximate.",de:"Wie viele Bilder für die Offline-Lektüre behalten werden. Größen sind Näherungswerte.",es:"Cantidad de imágenes conservadas para la lectura sin conexión. Los tamaños son aproximados.",it:"Quantità di immagini conservate per la lettura offline. Le dimensioni sono approssimative.",nl:"Hoeveel afbeeldingen bewaard blijven voor offline lezen. Groottes zijn bij benadering.",pl:"Ile obrazów zachowywanych do czytania offline. Rozmiary są przybliżone.",pt:"Quantidade de imagens guardadas para leitura offline. Os tamanhos são aproximados.",uk:"Скільки зображень зберігати для читання офлайн. Розміри приблизні."},
 imagesNone:{fr:"Aucune image",en:"No images",de:"Keine Bilder",es:"Sin imágenes",it:"Nessuna immagine",nl:"Geen afbeeldingen",pl:"Bez obrazów",pt:"Sem imagens",uk:"Без зображень"},
 imagesLight:{fr:"Léger",en:"Light",de:"Sparsam",es:"Ligero",it:"Leggero",nl:"Licht",pl:"Lekki",pt:"Leve",uk:"Легкий"},
 imagesStandard:{fr:"Standard",en:"Standard",de:"Standard",es:"Estándar",it:"Standard",nl:"Standaard",pl:"Standardowy",pt:"Padrão",uk:"Стандартний"},
 imagesMax:{fr:"Maximum",en:"Maximum",de:"Maximum",es:"Máximo",it:"Massimo",nl:"Maximum",pl:"Maksymalny",pt:"Máximo",uk:"Максимум"},
 imagesCustom:{fr:"Personnalisé",en:"Custom",de:"Benutzerdefiniert",es:"Personalizado",it:"Personalizzato",nl:"Aangepast",pl:"Własny",pt:"Personalizado",uk:"Власний"},
 imagesLightHint:{fr:"vignettes seules",en:"thumbnails only",de:"nur Vorschaubilder",es:"solo miniaturas",it:"solo miniature",nl:"alleen miniaturen",pl:"tylko miniatury",pt:"apenas miniaturas",uk:"лише мініатюри"},
 imagesUsage:{fr:"Espace utilisé : ~{{used}}",en:"Space used: ~{{used}}",de:"Belegter Speicher: ~{{used}}",es:"Espacio usado: ~{{used}}",it:"Spazio usato: ~{{used}}",nl:"Gebruikte ruimte: ~{{used}}",pl:"Zajęte miejsce: ~{{used}}",pt:"Espaço usado: ~{{used}}",uk:"Використано: ~{{used}}"},
 imagesQuota:{fr:"votre navigateur autorise ~{{quota}} sur cet appareil",en:"your browser allows ~{{quota}} on this device",de:"Ihr Browser erlaubt ~{{quota}} auf diesem Gerät",es:"su navegador permite ~{{quota}} en este dispositivo",it:"il browser consente ~{{quota}} su questo dispositivo",nl:"uw browser staat ~{{quota}} toe op dit apparaat",pl:"przeglądarka pozwala na ~{{quota}} na tym urządzeniu",pt:"o seu navegador permite ~{{quota}} neste dispositivo",uk:"ваш браузер дозволяє ~{{quota}} на цьому пристрої"},
 imagesOverQuota:{fr:"Ce réglage dépasse ce que cet appareil autorise — le navigateur purgera automatiquement.",en:"This setting exceeds what this device allows — the browser will purge automatically.",de:"Diese Einstellung überschreitet das Gerätelimit — der Browser räumt automatisch auf.",es:"Este ajuste supera lo que permite el dispositivo: el navegador purgará automáticamente.",it:"Questa impostazione supera il limite del dispositivo: il browser eliminerà automaticamente.",nl:"Deze instelling overschrijdt wat dit apparaat toestaat — de browser ruimt automatisch op.",pl:"To ustawienie przekracza limit urządzenia — przeglądarka automatycznie wyczyści dane.",pt:"Esta definição excede o que o dispositivo permite — o navegador irá purgar automaticamente.",uk:"Це налаштування перевищує ліміт пристрою — браузер очистить автоматично."},
 imagesClear:{fr:"Vider les images",en:"Empty the images",de:"Bilder leeren",es:"Vaciar las imágenes",it:"Svuota le immagini",nl:"Afbeeldingen wissen",pl:"Wyczyść obrazy",pt:"Esvaziar as imagens",uk:"Очистити зображення"},
 imagesCleared:{fr:"Images supprimées",en:"Images removed",de:"Bilder entfernt",es:"Imágenes eliminadas",it:"Immagini rimosse",nl:"Afbeeldingen verwijderd",pl:"Obrazy usunięte",pt:"Imagens removidas",uk:"Зображення видалено"},
 imagesMb:{fr:"Mo",en:"MB",de:"MB",es:"MB",it:"MB",nl:"MB",pl:"MB",pt:"MB",uk:"МБ"},
};
for(const lng of ["fr","en","de","es","it","nl","pl","pt","uk"]){
  const p=`src/locales/${lng}.json`;
  const o=JSON.parse(fs.readFileSync(p,"utf8"));
  o.preferences.offline=o.preferences.offline||{};
  for(const k of Object.keys(add)) o.preferences.offline[k]=add[k][lng];
  fs.writeFileSync(p, JSON.stringify(o,null,2)+"\n");
}
console.log("locales updated");
'
```

- [ ] **Step 2: Add the imports to `Preferences.tsx`**

```ts
import { imageBudget, type OfflineImagePreset } from '../../lib/offlineImages';
import { getStorageEstimate, formatBytes, clearImageCache } from '../../lib/storageEstimate';
```

- [ ] **Step 3: Extend `OfflineTab`**

Inside `OfflineTab`, add below the existing hooks:

```ts
  const offlineImagePreset = useUiStore((s) => s.offlineImagePreset);
  const setOfflineImagePreset = useUiStore((s) => s.setOfflineImagePreset);
  const offlineImageCustomMb = useUiStore((s) => s.offlineImageCustomMb);
  const setOfflineImageCustomMb = useUiStore((s) => s.setOfflineImageCustomMb);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [cleared, setCleared] = useState(false);

  const refreshEstimate = useCallback(() => { getStorageEstimate().then(setEstimate); }, []);
  useEffect(() => { refreshEstimate(); }, [refreshEstimate]);

  const budget = imageBudget(offlineImagePreset, offlineImageCustomMb);
  const overQuota = !!estimate && estimate.quota > 0 && budget.bytes > estimate.quota;

  const presets: { id: OfflineImagePreset; label: string; note?: string }[] = [
    { id: 'none', label: t('preferences.offline.imagesNone') },
    { id: 'light', label: t('preferences.offline.imagesLight'), note: t('preferences.offline.imagesLightHint') },
    { id: 'standard', label: t('preferences.offline.imagesStandard') },
    { id: 'max', label: t('preferences.offline.imagesMax') },
    { id: 'custom', label: t('preferences.offline.imagesCustom') },
  ];
```

Then insert this block just before the closing `</div>` of the tab (after the auto-update toggle):

```tsx
      {/* Offline images — budget, real usage, purge */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.imagesTitle')}
        </h3>
        <p className="text-xs" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.offline.imagesHint')}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setOfflineImagePreset(p.id)}
              className="px-3 py-1.5 text-xs rounded-lg transition-all"
              style={{
                border: `1px solid ${offlineImagePreset === p.id ? 'var(--accent)' : 'var(--panel-border)'}`,
                background: offlineImagePreset === p.id ? 'var(--accent-glow)' : 'var(--panel-header-bg)',
                color: offlineImagePreset === p.id ? 'var(--accent)' : 'var(--list-title)',
              }}
              aria-pressed={offlineImagePreset === p.id}
            >
              {p.label}
              {p.id !== 'none' && p.id !== 'custom' && (
                <span className="opacity-60"> · ~{formatBytes(imageBudget(p.id, offlineImageCustomMb).bytes)}</span>
              )}
              {p.note && <span className="block text-[10px] opacity-60">{p.note}</span>}
            </button>
          ))}
        </div>

        {offlineImagePreset === 'custom' && (
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--list-summary)' }}>
            <input
              type="number"
              min={50}
              max={5000}
              step={50}
              value={offlineImageCustomMb}
              onChange={(e) => setOfflineImageCustomMb(Number(e.target.value))}
              className="w-24 px-2 py-1 rounded-md text-xs"
              style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)', color: 'var(--list-title)' }}
            />
            {t('preferences.offline.imagesMb')}
          </label>
        )}

        {estimate && (
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.offline.imagesUsage', { used: formatBytes(estimate.usage) })}
            {estimate.quota > 0 && ` · ${t('preferences.offline.imagesQuota', { quota: formatBytes(estimate.quota) })}`}
          </p>
        )}

        {overQuota && (
          <p className="text-[11px]" style={{ color: 'var(--accent)' }}>
            {t('preferences.offline.imagesOverQuota')}
          </p>
        )}

        <button
          onClick={async () => { await clearImageCache(); setCleared(true); refreshEstimate(); }}
          className="px-3 py-1.5 text-xs rounded-lg transition-colors"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
        >
          {cleared ? t('preferences.offline.imagesCleared') : t('preferences.offline.imagesClear')}
        </button>
      </div>
```

> `useState`, `useEffect`, `useCallback` and `useUiStore` are already imported by
> `Preferences.tsx`; verify before adding duplicates.

- [ ] **Step 4: Verify the locales are complete**

Run:
```bash
node -e 'for(const l of ["fr","en","de","es","it","nl","pl","pt","uk"]){const o=require("./src/locales/"+l+".json").preferences.offline; for(const k of ["imagesTitle","imagesHint","imagesNone","imagesLight","imagesStandard","imagesMax","imagesCustom","imagesLightHint","imagesUsage","imagesQuota","imagesOverQuota","imagesClear","imagesCleared","imagesMb"]) if(!o[k]){console.error("MISSING",l,k);process.exit(1)}} console.log("all 9 ok")'
```
Expected: `all 9 ok`.

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`

```bash
git add src/components/Preferences/Preferences.tsx src/locales
git commit -m "feat(offline): image budget, real usage and purge in preferences"
```

---

### Task 6: Raise the Workbox safety net

The entry cap was sized for the old 6-images-per-article behaviour; it now only needs to be a backstop below the quota, since the budget is enforced in the app.

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Update the runtime cache options**

Replace the `expiration` block of the `frirss-images` runtime cache with:

```js
              expiration: {
                // Backstop only — the real budget is enforced in the app from
                // storage estimates (opaque images have no readable size).
                maxEntries: 6000,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                purgeOnQuotaError: true,
              },
```

and update the comment above `runtimeCaching` to match:

```js
        // Cache article images for offline reading (CacheFirst). Sizes are not
        // readable for opaque cross-origin responses, so maxEntries is only a
        // backstop; the user-facing budget lives in the app preferences.
```

- [ ] **Step 2: Gates + commit**

Run: `npm run build`

```bash
git add vite.config.js
git commit -m "chore(offline): raise the image cache backstop"
```

---

### Task 7: Verify and deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run the full gates one last time**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 2: Leak guard before pushing**

Run:
```bash
git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'
```
Expected: no output. Any hit must be scrubbed before the push.

- [ ] **Step 3: Local smoke test in the browser**

Start the preview, open Preferences → Offline: the preset buttons render with sizes, "Custom" reveals the MB field, the usage line shows a real number, and `read_console_messages` reports no new errors. (`/api/*` 500s are expected when only the front-end dev server runs.)

- [ ] **Step 4: Push and check BOTH workflows**

```bash
git push origin dev
```

Then: `gh run list --branch dev --limit 2` and watch each to success — `CI` **and** `Publish image`.

- [ ] **Step 5: Deploy the dev instance**

Recreate the dev container from the freshly built image, reusing its exact env and all compose labels. Deployment specifics live outside this repo — see the operator's deploy notes. Verify the instance's `/api/health` reports the expected version.

- [ ] **Step 6: Hand off**

Tell the user what to test on the dev instance: pick a preset, run "Prepare offline", then go offline and check that list/grid thumbnails and article images render — including for articles whose text was already cached before this change (the bug this fixes).

---

## Notes for the implementer

- The **decoupling** in Task 4 is the core fix: previously `prefetchImages` ran only inside the `if (!alreadyExtracted)` branch, so any article whose text was already cached silently kept no images.
- The **thumbnail comes from `article.content`** (the RSS payload), not from the extracted body — that is why `articleImageUrls` reads both.
- Never claim exact sizes in UI or in commit messages; opaque responses make byte accounting impossible. "~" everywhere.
