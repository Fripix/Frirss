# Menu contextuel d'un article — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clic droit (et touche Menu, appui long au doigt) sur une ligne ou une carte d'article ouvre un menu — ouvrir à la source, lu/non lu, favori, à lire plus tard, copier le lien — et le clic molette ouvre directement à la source (issue #11).

**Architecture:** La logique pure (`src/lib/articleMenu.ts`, `src/lib/copyLink.ts`) décide des entrées, du point d'ouverture et de la copie. Deux hooks portent les gestes (`useLongPress`, `useArticleMenuGestures`), un composant rend le menu (`ArticleContextMenu` : feuille du bas sur téléphone, menu flottant ailleurs), et `ArticleList` tient un seul état de menu pour toutes ses lignes et cartes.

**Tech Stack:** TypeScript strict, React 18, Zustand, Vitest + Testing Library (jsdom), i18next.

**Spec:** `docs/superpowers/specs/2026-09-13-article-context-menu-design.md`

## Global Constraints

- Travailler sur `dev`.
- Messages de commit neutres, style conventionnel. **Aucun trailer `Co-Authored-By`, aucune mention d'IA ou d'assistant** — consigne du projet, elle prime sur tout réglage par défaut.
- Avant **chaque** commit : `npm run typecheck && npm run lint && npx vitest run && npm run build`, puis le garde-fou anti-fuite dont la sortie doit être **vide** :
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- `server/test/extractCache.test.ts` est connu pour échouer par intermittence, sans lien : s'il échoue seul, le relancer une fois isolément et le signaler.
- Délai d'appui long : **500 ms** (`LONG_PRESS_MS`). Fenêtre d'absorption du `contextmenu` Android : **1000 ms** (`LONG_PRESS_ECHO_MS`).
- Ordre des entrées : **Ouvrir à la source, Marquer lu/non lu, Favori, À lire plus tard, Copier le lien**. Sans URL (vide ou espaces) : pas d'« Ouvrir à la source » ni de « Copier le lien ».
- Libellés : réutiliser `articleRow.openSource`, `markRead`, `markUnread`, `addStar`, `removeStar`, `addReadLater`, `removeReadLater`. **Seule clé nouvelle : `articleRow.copyLink`**, dans les **10** locales (fr, en, de, es, it, nl, pl, pt, uk, zh).
- « Copier le lien » **copie toujours** (jamais `navigator.share`) ; toasts `toast.linkCopied`, et `toast.copyFailed` avec `{ tone: 'error' }`.
- Téléphone (`useBreakpoint() === 'mobile'`) : `BottomSheet` titrée avec le titre de l'article. Ailleurs : menu flottant dans un portail, replacé par `clampToViewport()`.
- **Ne pas modifier** l'appui long des flux (`Sidebar.tsx`), `useFileGesture` ni les boutons de `ArticleActions.tsx`. **Ne pas modifier les tests existants** : on ajoute des fichiers de test.
- Pas de `role="menu"`.
- `docs/FEATURES.md` et `docs/RELEASE-NEXT.md` dans le commit qui livre la fonctionnalité (tâche 4).
- Trois formats à vérifier ; téléphone à **320 px**.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/articleMenu.ts` (+ test) | `articleMenuItems`, `menuAnchor` — pur |
| `src/lib/copyLink.ts` (+ test) | `copyLink(url, clipboard)` — pur, presse-papiers injecté |
| `src/hooks/useLongPress.ts` (+ test) | appui long 500 ms, clic avalé, `firedRecently()` |
| `src/hooks/useArticleMenuGestures.ts` (+ test) | clic droit / touche Menu / appui long → menu ; clic molette → source ; priorité aux boutons |
| `src/components/ArticleList/ArticleContextMenu.tsx` (+ test) | rendu feuille du bas / menu flottant, exécution et fermeture |
| `src/components/ArticleList/ArticleList.tsx` | état du menu, branchement des lignes et des cartes, copie du lien |
| `src/components/ArticleList/ArticleCard.tsx` | gestes sur la carte |
| `src/components/ArticleList/ArticleRow.menu.test.tsx`, `ArticleCard.menu.test.tsx` (nouveaux) | gestes branchés sur les vrais composants |
| `src/styles/index.css` | sélection iOS coupée sous `(hover: none)` |
| `src/locales/*.json` | `articleRow.copyLink` |
| `docs/FEATURES.md`, `docs/RELEASE-NEXT.md` | inventaire et journal du cycle |

---

### Task 1: Les entrées du menu et la copie du lien

**Files:**
- Create: `src/lib/articleMenu.ts`, `src/lib/articleMenu.test.ts`
- Create: `src/lib/copyLink.ts`, `src/lib/copyLink.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type ArticleMenuKind = 'openSource' | 'toggleRead' | 'toggleStar' | 'toggleReadLater' | 'copyLink'`
  - `interface ArticleMenuItem { kind: ArticleMenuKind; labelKey: string }`
  - `articleMenuItems(article: { url?: string; read: boolean; starred: boolean }, isReadLater: boolean): ArticleMenuItem[]`
  - `menuAnchor(event: { clientX: number; clientY: number }, rect: { left: number; bottom: number }): { x: number; y: number }`
  - `type CopyResult = 'copied' | 'failed'`, `interface ClipboardLike { writeText(text: string): Promise<void> }`
  - `copyLink(url: string, clipboard: ClipboardLike | null): Promise<CopyResult>`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/lib/articleMenu.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { articleMenuItems, menuAnchor } from './articleMenu';

const base = { url: 'https://example.com/a', read: false, starred: false };

describe('articleMenuItems', () => {
  it('lists the five entries in order for an unread, unstarred article with a URL', () => {
    expect(articleMenuItems(base, false)).toEqual([
      { kind: 'openSource', labelKey: 'articleRow.openSource' },
      { kind: 'toggleRead', labelKey: 'articleRow.markRead' },
      { kind: 'toggleStar', labelKey: 'articleRow.addStar' },
      { kind: 'toggleReadLater', labelKey: 'articleRow.addReadLater' },
      { kind: 'copyLink', labelKey: 'articleRow.copyLink' },
    ]);
  });

  it('labels follow the article state', () => {
    const labels = articleMenuItems({ ...base, read: true, starred: true }, true).map((i) => i.labelKey);
    expect(labels).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
    ]);
  });

  it('drops open-at-source and copy-link without a URL', () => {
    for (const url of ['', '   ', undefined]) {
      expect(articleMenuItems({ ...base, url }, false).map((i) => i.kind)).toEqual([
        'toggleRead',
        'toggleStar',
        'toggleReadLater',
      ]);
    }
  });
});

describe('menuAnchor', () => {
  it('opens at the pointer for a mouse right-click', () => {
    expect(menuAnchor({ clientX: 120, clientY: 45 }, { left: 10, bottom: 300 })).toEqual({ x: 120, y: 45 });
  });

  it('opens under the row when the keyboard Menu key fired it (clientX = clientY = 0)', () => {
    expect(menuAnchor({ clientX: 0, clientY: 0 }, { left: 10, bottom: 300 })).toEqual({ x: 10, y: 300 });
  });
});
```

`src/lib/copyLink.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import { copyLink } from './copyLink';

describe('copyLink', () => {
  it('writes the URL and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyLink('https://example.com/a', { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://example.com/a');
  });

  it('fails without a clipboard (non-secure context)', async () => {
    await expect(copyLink('https://example.com/a', null)).resolves.toBe('failed');
  });

  it('fails when the browser refuses the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await expect(copyLink('https://example.com/a', { writeText })).resolves.toBe('failed');
  });

  it('fails on an empty URL without touching the clipboard', async () => {
    const writeText = vi.fn();
    await expect(copyLink('   ', { writeText })).resolves.toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/lib/articleMenu.test.ts src/lib/copyLink.test.ts`
Expected: FAIL — `Failed to resolve import "./articleMenu"` et `"./copyLink"`.

- [ ] **Step 3: Implémenter**

`src/lib/articleMenu.ts` :

```ts
/**
 * Menu contextuel d'un article : ce qu'il contient, et où il s'ouvre.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 */
export type ArticleMenuKind = 'openSource' | 'toggleRead' | 'toggleStar' | 'toggleReadLater' | 'copyLink';

export interface ArticleMenuItem {
  kind: ArticleMenuKind;
  /** Clé i18n du libellé ; elle suit l'état de l'article. */
  labelKey: string;
}

/**
 * Entrées du menu, dans l'ordre. Sans URL, « Ouvrir à la source » et « Copier le
 * lien » n'ont rien à ouvrir ni à copier : elles disparaissent.
 */
export function articleMenuItems(
  article: { url?: string; read: boolean; starred: boolean },
  isReadLater: boolean,
): ArticleMenuItem[] {
  const hasUrl = !!article.url?.trim();
  const items: ArticleMenuItem[] = [];
  if (hasUrl) items.push({ kind: 'openSource', labelKey: 'articleRow.openSource' });
  items.push({ kind: 'toggleRead', labelKey: article.read ? 'articleRow.markUnread' : 'articleRow.markRead' });
  items.push({ kind: 'toggleStar', labelKey: article.starred ? 'articleRow.removeStar' : 'articleRow.addStar' });
  items.push({ kind: 'toggleReadLater', labelKey: isReadLater ? 'articleRow.removeReadLater' : 'articleRow.addReadLater' });
  if (hasUrl) items.push({ kind: 'copyLink', labelKey: 'articleRow.copyLink' });
  return items;
}

/**
 * Point d'ouverture du menu. La touche Menu (ou Maj+F10) émet `contextmenu` sur
 * l'élément focalisé avec `clientX = clientY = 0` : sans ce cas, le menu
 * s'ouvrirait dans le coin de la fenêtre. Il s'ouvre alors sous la ligne.
 */
export function menuAnchor(
  event: { clientX: number; clientY: number },
  rect: { left: number; bottom: number },
): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) return { x: rect.left, y: rect.bottom };
  return { x: event.clientX, y: event.clientY };
}
```

`src/lib/copyLink.ts` :

```ts
export type CopyResult = 'copied' | 'failed';

/** Ce dont on a besoin de `navigator.clipboard` — injecté, pour être testable. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Copie un lien dans le presse-papiers.
 *
 * `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS, localhost) :
 * l'appelant passe `navigator.clipboard ?? null`, et son absence est un échec
 * annoncé, jamais une exception.
 */
export async function copyLink(url: string, clipboard: ClipboardLike | null): Promise<CopyResult> {
  if (!url.trim() || !clipboard) return 'failed';
  try {
    await clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
```

- [ ] **Step 4: Vérifier qu'ils passent**

Run: `npx vitest run src/lib/articleMenu.test.ts src/lib/copyLink.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Gates, garde-fou, commit**

```bash
git add src/lib/articleMenu.ts src/lib/articleMenu.test.ts src/lib/copyLink.ts src/lib/copyLink.test.ts
git commit -m "feat(articles): menu entries and link copy for the article menu"
```

---

### Task 2: Les gestes

**Files:**
- Create: `src/hooks/useLongPress.ts`, `src/hooks/useLongPress.test.tsx`
- Create: `src/hooks/useArticleMenuGestures.ts`, `src/hooks/useArticleMenuGestures.test.tsx`

**Interfaces:**
- Consumes (tâche 1) : `menuAnchor(event, rect)`.
- Produces:
  - `LONG_PRESS_MS = 500`, `LONG_PRESS_ECHO_MS = 1000`, `interface PressPoint { x: number; y: number }`
  - `useLongPress(onLongPress: (point: PressPoint) => void): { onTouchStart, onTouchMove, onTouchEnd, onClickCapture, firedRecently: () => boolean }`
  - `useArticleMenuGestures(onOpenMenu: ((point: PressPoint) => void) | undefined, onOpenSource: (e: ReactMouseEvent) => void)` → objet à étaler sur la racine d'une ligne ou d'une carte : `{ onContextMenu, onTouchStart, onTouchMove, onTouchEnd, onClickCapture, onMouseDown, onAuxClick }`

- [ ] **Step 1: Écrire les tests qui échouent**

`src/hooks/useLongPress.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useLongPress, LONG_PRESS_MS, LONG_PRESS_ECHO_MS, type PressPoint } from './useLongPress';

let firedRecently: () => boolean = () => false;

function Harness({ onLongPress, onClick }: { onLongPress: (p: PressPoint) => void; onClick: () => void }) {
  const lp = useLongPress(onLongPress);
  firedRecently = lp.firedRecently;
  return (
    <div
      role="button"
      onTouchStart={lp.onTouchStart}
      onTouchMove={lp.onTouchMove}
      onTouchEnd={lp.onTouchEnd}
      onClickCapture={lp.onClickCapture}
      onClick={onClick}
    >
      row
    </div>
  );
}

function setup() {
  const onLongPress = vi.fn();
  const onClick = vi.fn();
  const c = render(<Harness onLongPress={onLongPress} onClick={onClick} />);
  return { onLongPress, onClick, row: c.getByRole('button') };
}

const at = { touches: [{ clientX: 12, clientY: 34 }] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('useLongPress', () => {
  it('fires after the delay, at the touch point', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it('does not fire before the delay', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled as soon as the finger moves — a scroll or a swipe must not open the menu', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled when the finger lifts before the delay', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchEnd(row);
    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('swallows the click that ends a completed press', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cancels the compatibility click at the source when a press completed, not after a short tap', () => {
    // Sur téléphone, ce clic tomberait sur le fond de la feuille du bas qui
    // vient de s'ouvrir sous le doigt, et la refermerait aussitôt.
    const { row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fireEvent.touchEnd(row)).toBe(false);
    fireEvent.touchStart(row, at);
    expect(fireEvent.touchEnd(row)).toBe(true);
  });

  it('lets a short tap click', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a new touch clears a swallow that no click consumed', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.touchStart(row, at);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reports a recent press for the echo window only', () => {
    const { row } = setup();
    expect(firedRecently()).toBe(false);
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(firedRecently()).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_ECHO_MS);
    expect(firedRecently()).toBe(false);
  });
});
```

`src/hooks/useArticleMenuGestures.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useArticleMenuGestures } from './useArticleMenuGestures';
import { LONG_PRESS_MS, type PressPoint } from './useLongPress';

function Harness({ onOpenMenu, onOpenSource, onSelect, onButtonContextMenu }: {
  onOpenMenu?: (p: PressPoint) => void;
  onOpenSource: () => void;
  onSelect: () => void;
  onButtonContextMenu: () => void;
}) {
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource);
  return (
    <div role="button" data-testid="row" {...gestures} onClick={onSelect}>
      <span>Hello</span>
      {/* Stands in for the Star button: its own right-click already calls preventDefault. */}
      <button type="button" onContextMenu={(e) => { e.preventDefault(); onButtonContextMenu(); }}>star</button>
    </div>
  );
}

function setup(withMenu = true) {
  const spies = { onOpenMenu: vi.fn(), onOpenSource: vi.fn(), onSelect: vi.fn(), onButtonContextMenu: vi.fn() };
  const c = render(<Harness {...spies} onOpenMenu={withMenu ? spies.onOpenMenu : undefined} />);
  return { ...spies, row: c.getByTestId('row'), button: c.getByRole('button', { name: 'star' }) };
}

function middleClick(el: Element) {
  return el.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('useArticleMenuGestures', () => {
  it('opens the menu at the pointer on right-click, and keeps the browser menu closed', () => {
    const { onOpenMenu, row } = setup();
    const notPrevented = fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(notPrevented).toBe(false);
  });

  it('opens under the row when the keyboard Menu key fired it', () => {
    const { onOpenMenu, row } = setup();
    row.getBoundingClientRect = () => ({ left: 7, bottom: 90, top: 60, right: 300, width: 293, height: 30, x: 7, y: 60, toJSON: () => ({}) }) as DOMRect;
    fireEvent.contextMenu(row, { clientX: 0, clientY: 0 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 7, y: 90 });
  });

  it('leaves a right-click the Star button already handled to that button', () => {
    const { onOpenMenu, onButtonContextMenu, button } = setup();
    fireEvent.contextMenu(button, { clientX: 5, clientY: 5 });
    expect(onButtonContextMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('without a menu, leaves the browser menu alone', () => {
    const { row } = setup(false);
    expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })).toBe(true);
  });

  it('opens the menu on a long press and does not select the article on release', () => {
    const { onOpenMenu, onSelect, row } = setup();
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a long press that starts on a button belongs to that button', () => {
    const { onOpenMenu, button } = setup();
    fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('absorbs the contextmenu Chrome Android sends right after a long press', () => {
    const { onOpenMenu, row } = setup();
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const notPrevented = fireEvent.contextMenu(row, { clientX: 21, clientY: 31 });
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it('opens at the source on a middle click, without selecting', () => {
    const { onOpenSource, onSelect, row } = setup();
    middleClick(row);
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('prevents the middle-button autoscroll on mousedown', () => {
    const { row } = setup();
    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(false);
    expect(fireEvent.mouseDown(row, { button: 0 })).toBe(true);
  });

  it('ignores a middle click on a button of the row', () => {
    const { onOpenSource, button } = setup();
    middleClick(button);
    expect(onOpenSource).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/hooks/useLongPress.test.tsx src/hooks/useArticleMenuGestures.test.tsx`
Expected: FAIL — `Failed to resolve import "./useLongPress"` et `"./useArticleMenuGestures"`.

- [ ] **Step 3: Implémenter `useLongPress`**

`src/hooks/useLongPress.ts` :

```ts
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';

/** Durée d'appui qui ouvre le menu d'un article au doigt — la même que pour un flux. */
export const LONG_PRESS_MS = 500;

/** Durée pendant laquelle un `contextmenu` qui suit un appui long est absorbé (Chrome Android). */
export const LONG_PRESS_ECHO_MS = 1000;

export interface PressPoint {
  x: number;
  y: number;
}

/**
 * Appui long au doigt.
 *
 * ⚠️ Troisième implémentation d'un appui long de 500 ms, assumée : celle d'une
 * ligne de flux (`FeedItem`, `Sidebar.tsx`) et `useFileGesture`
 * (`ArticleActions.tsx`) fonctionnent et viennent d'être validées sur appareil.
 * Les unifier est au backlog, pas dans ce changement.
 *
 * - `touchmove` et `touchend` annulent : un défilement ou un balayage de ligne
 *   n'ouvre rien ;
 * - le `touchend` d'un appui abouti est `preventDefault()` : le clic de
 *   compatibilité n'est pas émis (sur téléphone il refermerait la feuille du
 *   bas ouverte sous le doigt). Filet en plus : le clic qui arriverait quand
 *   même est avalé en phase de capture — sans cela, le menu s'ouvrirait ET
 *   l'article se sélectionnerait derrière. Un nouveau contact efface cette
 *   consigne si aucun clic ne l'a consommée ;
 * - `firedRecently()` sert au piège de Chrome Android, qui émet aussi
 *   `contextmenu` sur un appui long.
 */
export function useLongPress(onLongPress: (point: PressPoint) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const firedAt = useRef<number | null>(null);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const touch = e.touches[0];
    const point = { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    fired.current = false;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      firedAt.current = Date.now();
      callback.current(point);
    }, LONG_PRESS_MS);
  }, [cancel]);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const firedRecently = useCallback(
    () => firedAt.current !== null && Date.now() - firedAt.current < LONG_PRESS_ECHO_MS,
    [],
  );

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    cancel();
    // Appui abouti : supprimer le clic de compatibilité à la source. Sur
    // téléphone, la feuille du bas vient de s'ouvrir SOUS le doigt, et ce clic
    // tomberait sur son fond — qui la refermerait aussitôt. La capture ci-dessus
    // ne le rattraperait pas : il ne viserait plus la ligne.
    if (fired.current && e.cancelable) e.preventDefault();
  }, [cancel]);

  return { onTouchStart, onTouchMove: cancel, onTouchEnd, onClickCapture, firedRecently };
}
```

- [ ] **Step 4: Implémenter `useArticleMenuGestures`**

`src/hooks/useArticleMenuGestures.ts` :

```ts
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { useLongPress, type PressPoint } from './useLongPress';
import { menuAnchor } from '../lib/articleMenu';

/** Un geste parti d'un bouton de la ligne appartient à ce bouton. */
function fromButton(e: { target: EventTarget | null }): boolean {
  return e.target instanceof Element && e.target.closest('button') !== null;
}

/**
 * Gestes d'une ligne ou d'une carte d'article : clic droit, touche Menu et appui
 * long ouvrent le menu ; le clic molette ouvre l'article à sa source.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 *
 * ⚠️ Le clic droit des boutons Favori et À lire plus tard reste prioritaire :
 * leur rangement par catégorie (`useFileGesture`) appelle déjà
 * `preventDefault()`, et on sort sur `defaultPrevented` — les boutons ne sont
 * pas modifiés. Même règle pour l'appui long et le clic molette : un geste
 * parti d'un bouton lui appartient.
 */
export function useArticleMenuGestures(
  onOpenMenu: ((point: PressPoint) => void) | undefined,
  onOpenSource: (e: ReactMouseEvent) => void,
) {
  const longPress = useLongPress((point) => onOpenMenu?.(point));

  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (!onOpenMenu || e.defaultPrevented) return;
      e.preventDefault();
      // Chrome Android émet aussi `contextmenu` sur l'appui long qui vient
      // d'ouvrir le menu : on l'absorbe sans rouvrir.
      if (longPress.firedRecently()) return;
      onOpenMenu(menuAnchor(e, e.currentTarget.getBoundingClientRect()));
    },
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      if (!onOpenMenu || fromButton(e)) return;
      longPress.onTouchStart(e);
    },
    onTouchMove: longPress.onTouchMove,
    onTouchEnd: longPress.onTouchEnd,
    onClickCapture: longPress.onClickCapture,
    // Clic molette : empêcher le défilement automatique (Windows, Linux)…
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button === 1 && !fromButton(e)) e.preventDefault();
    },
    // …puis ouvrir à la source, exactement comme l'icône.
    onAuxClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (e.button !== 1 || fromButton(e)) return;
      e.preventDefault();
      onOpenSource(e);
    },
  };
}
```

- [ ] **Step 5: Vérifier qu'ils passent**

Run: `npx vitest run src/hooks/useLongPress.test.tsx src/hooks/useArticleMenuGestures.test.tsx`
Expected: PASS — 19 tests.

- [ ] **Step 6: Gates, garde-fou, commit**

```bash
git add src/hooks/useLongPress.ts src/hooks/useLongPress.test.tsx src/hooks/useArticleMenuGestures.ts src/hooks/useArticleMenuGestures.test.tsx
git commit -m "feat(articles): gestures that open the article menu"
```

---

### Task 3: Le composant du menu

**Files:**
- Create: `src/components/ArticleList/ArticleContextMenu.tsx`, `src/components/ArticleList/ArticleContextMenu.test.tsx`
- Modify: `src/locales/{fr,en,de,es,it,nl,pl,pt,uk,zh}.json` (clé `articleRow.copyLink`)

**Interfaces:**
- Consumes (tâche 1) : `articleMenuItems`, `ArticleMenuKind` ; existants : `BottomSheet` (`src/components/BottomSheet.tsx`, props `open`, `onClose`, `title`, `children`), `clampToViewport` (`src/lib/clampToViewport.ts`).
- Produces: `export default function ArticleContextMenu(props: { article: Article; isReadLater: boolean; x: number; y: number; sheet: boolean; onClose: () => void; onOpenSource: () => void; onToggleRead: () => void; onToggleStar: () => void; onToggleReadLater: () => void; onCopyLink: () => void })`

- [ ] **Step 1: Écrire le test qui échoue**

`src/components/ArticleList/ArticleContextMenu.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import ArticleContextMenu from './ArticleContextMenu';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

const article = {
  id: 'a1', title: 'Hello World', url: 'https://example.com/1', read: false, starred: false, labels: [],
} as unknown as Article;

function setup(over: { article?: Partial<Article>; isReadLater?: boolean; sheet?: boolean } = {}) {
  const handlers = {
    onClose: vi.fn(), onOpenSource: vi.fn(), onToggleRead: vi.fn(),
    onToggleStar: vi.fn(), onToggleReadLater: vi.fn(), onCopyLink: vi.fn(),
  };
  render(
    <ArticleContextMenu
      article={{ ...article, ...over.article }}
      isReadLater={over.isReadLater ?? false}
      x={30}
      y={40}
      sheet={over.sheet ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ArticleContextMenu', () => {
  it('shows the five entries in order', () => {
    setup();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'articleRow.openSource', 'articleRow.markRead', 'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.copyLink',
    ]);
  });

  it('runs each entry through its own handler, then closes', () => {
    const cases: [string, 'onOpenSource' | 'onToggleRead' | 'onToggleStar' | 'onToggleReadLater' | 'onCopyLink'][] = [
      ['articleRow.openSource', 'onOpenSource'],
      ['articleRow.markRead', 'onToggleRead'],
      ['articleRow.addStar', 'onToggleStar'],
      ['articleRow.addReadLater', 'onToggleReadLater'],
      ['articleRow.copyLink', 'onCopyLink'],
    ];
    for (const [label, handler] of cases) {
      const h = setup();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(h[handler]).toHaveBeenCalledTimes(1);
      expect(h.onClose).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('labels follow the article state', () => {
    setup({ article: { read: true, starred: true }, isReadLater: true });
    expect(screen.getByRole('button', { name: 'articleRow.markUnread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'articleRow.removeStar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'articleRow.removeReadLater' })).toBeTruthy();
  });

  it('has no open-at-source nor copy-link without a URL', () => {
    setup({ article: { url: '' } });
    expect(screen.queryByRole('button', { name: 'articleRow.openSource' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'articleRow.copyLink' })).toBeNull();
  });

  it('closes on Escape', () => {
    const h = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a pointerdown outside, not inside', () => {
    const h = setup();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'articleRow.markRead' }));
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('on a phone, renders a bottom sheet titled with the article', () => {
    const h = setup({ sheet: true });
    expect(screen.getByRole('dialog', { name: 'Hello World' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'articleRow.addStar' }));
    expect(h.onToggleStar).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `npx vitest run src/components/ArticleList/ArticleContextMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./ArticleContextMenu"`.

- [ ] **Step 3: Implémenter le composant**

`src/components/ArticleList/ArticleContextMenu.tsx` :

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Article } from '../../types';
import BottomSheet from '../BottomSheet';
import { articleMenuItems, type ArticleMenuKind } from '../../lib/articleMenu';
import { clampToViewport } from '../../lib/clampToViewport';

interface ArticleContextMenuProps {
  article: Article;
  isReadLater: boolean;
  /** Point d'ouverture, en coordonnées de fenêtre (ignoré en feuille du bas). */
  x: number;
  y: number;
  /** Téléphone : feuille du bas. Ailleurs : menu flottant. */
  sheet: boolean;
  onClose: () => void;
  onOpenSource: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleReadLater: () => void;
  onCopyLink: () => void;
}

/**
 * Menu contextuel d'un article — clic droit, touche Menu, appui long.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 *
 * Boutons simples, pas `role="menu"` : aucun menu de l'application ne l'a, et ce
 * rôle promet une navigation aux flèches qu'on ne fournit pas.
 * Le menu flottant est rendu dans un portail : un ancêtre transformé (les
 * animations de la liste) rendrait sinon `position: fixed` relatif à lui.
 */
export default function ArticleContextMenu({
  article, isReadLater, x, y, sheet,
  onClose, onOpenSource, onToggleRead, onToggleStar, onToggleReadLater, onCopyLink,
}: ArticleContextMenuProps) {
  const { t } = useTranslation();
  const items = articleMenuItems(article, isReadLater);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const actions: Record<ArticleMenuKind, () => void> = {
    openSource: onOpenSource,
    toggleRead: onToggleRead,
    toggleStar: onToggleStar,
    toggleReadLater: onToggleReadLater,
    copyLink: onCopyLink,
  };
  const run = (kind: ArticleMenuKind) => {
    actions[kind]();
    onClose();
  };

  // Menu flottant : fermeture au `pointerdown` extérieur — pas `mousedown`, qu'iOS
  // n'émet pas avant le clic — et à Échap. La feuille du bas gère les siens.
  useEffect(() => {
    if (sheet) return;
    function onPointerDown(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [sheet, onClose]);

  // Replacé dans la fenêtre APRÈS mesure : la largeur dépend du plus long libellé
  // traduit. `useLayoutEffect` corrige avant la peinture, sans saut visible.
  useLayoutEffect(() => {
    if (sheet) return;
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(clampToViewport({
      x, y, w: r.width, h: r.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
  }, [sheet, x, y, items.length]);

  if (sheet) {
    return (
      <BottomSheet open onClose={onClose} title={article.title}>
        {items.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => run(item.kind)}
            className="sheet-row w-full flex items-center px-4 py-2.5 text-left font-medium transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-title)' }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </BottomSheet>
    );
  }

  const style: CSSProperties = {
    position: 'fixed', left: pos.left, top: pos.top, zIndex: 100,
    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    minWidth: '200px', overflow: 'hidden',
  };

  return createPortal(
    <div ref={menuRef} style={style} className="py-1">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          onClick={() => run(item.kind)}
          className="w-full flex items-center px-3 py-2 text-xs text-left transition-colors hover:bg-black/5"
          style={{ color: 'var(--list-title)' }}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: La clé `articleRow.copyLink` dans les 10 locales**

Mêmes valeurs que `readingPane.copyLink`, déjà traduites :

```bash
node <<'EOF'
const fs = require('fs');
const values = {
  fr: 'Copier le lien', en: 'Copy link', de: 'Link kopieren', es: 'Copiar enlace', it: 'Copia link',
  nl: 'Link kopiëren', pl: 'Kopiuj link', pt: 'Copiar ligação', uk: 'Копіювати посилання', zh: '复制链接',
};
for (const [l, v] of Object.entries(values)) {
  const p = `src/locales/${l}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.readingPane.copyLink !== v) throw new Error(`${l}: readingPane.copyLink is "${j.readingPane.copyLink}", expected "${v}"`);
  j.articleRow.copyLink = v;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
console.log('ok');
EOF
```

Expected: `ok`. Puis la commande de parité de `CLAUDE.md` → `parité ok (10 locales : fr, en, de, es, it, nl, pl, pt, uk, zh)`, et `git diff --numstat src/locales` : chaque fichier `2	1` (la virgule de la clé précédente et la nouvelle ligne).

- [ ] **Step 5: Vérifier que le test passe**

Run: `npx vitest run src/components/ArticleList/ArticleContextMenu.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 6: Gates, garde-fou, commit**

```bash
git add src/components/ArticleList/ArticleContextMenu.tsx src/components/ArticleList/ArticleContextMenu.test.tsx src/locales
git commit -m "feat(articles): article context menu component"
```

---

### Task 4: Brancher les lignes, les cartes et la liste

**Files:**
- Modify: `src/components/ArticleList/ArticleList.tsx`
- Modify: `src/components/ArticleList/ArticleCard.tsx`
- Modify: `src/styles/index.css`
- Create: `src/components/ArticleList/ArticleRow.menu.test.tsx`, `src/components/ArticleList/ArticleCard.menu.test.tsx`
- Modify: `docs/FEATURES.md`, `docs/RELEASE-NEXT.md`

**Interfaces:**
- Consumes : `useArticleMenuGestures(onOpenMenu, onOpenSource)` (tâche 2), `ArticleContextMenu` (tâche 3), `copyLink(url, clipboard)` (tâche 1). Existants dans `ArticleList` : `articles`, `selectedFeed`, `filter`, `toggleRead`, `toggleStar`, `toggleReadLater`, `pushToast`, `t`, `isMobile`, `selectArticleAtSource`, `openArticleAtSource`, `READ_LATER_LABEL`.
- Produces : prop optionnelle `onOpenMenu?: (point: { x: number; y: number }) => void` sur `ArticleRow` et `ArticleCard`.

Chaque « Remplacer … par … » est un remplacement exact qui doit correspondre **une seule fois** ; sinon, s'arrêter et le signaler.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/components/ArticleList/ArticleRow.menu.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
// Le rangement par catégorie ouvert par le clic droit sur l'étoile n'est pas sous test.
vi.mock('./SavedCategoryPicker', () => ({ default: () => null, SavedCategoryPicker: () => null }));

const base = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

function renderRow(viewMode: string, withMenu = true) {
  const spies = { onSelect: vi.fn(), onOpenSource: vi.fn(), onOpenMenu: vi.fn() };
  const c = render(
    <ArticleRow
      article={base}
      viewMode={viewMode}
      showSource
      rowActions={DEFAULT_ROW_ACTIONS}
      active={false}
      onSelect={spies.onSelect}
      onToggleStar={() => {}}
      onToggleRead={() => {}}
      onToggleReadLater={() => {}}
      onOpenSource={spies.onOpenSource}
      onOpenMenu={withMenu ? spies.onOpenMenu : undefined}
    />,
  );
  const row = c.container.querySelector('[data-article-id="a1"]') as HTMLElement;
  return { ...spies, c, row };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

for (const viewMode of ['compact', 'normal']) {
  describe(`ArticleRow (${viewMode}) — menu`, () => {
    it('right-click opens the article menu at the pointer', () => {
      const { onOpenMenu, row } = renderRow(viewMode);
      fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
      expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
    });

    it("right-click on the Star button keeps that button's own gesture", () => {
      const { onOpenMenu, c } = renderRow(viewMode);
      const star = c.getByTitle('articleRow.addStar — saved.holdHint');
      fireEvent.contextMenu(star, { clientX: 5, clientY: 5 });
      expect(onOpenMenu).not.toHaveBeenCalled();
    });

    it('middle click opens at the source without selecting', () => {
      const { onOpenSource, onSelect, row } = renderRow(viewMode);
      row.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      expect(onOpenSource).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('long press opens the menu and the release does not select', () => {
      const { onOpenMenu, onSelect, row } = renderRow(viewMode);
      fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      fireEvent.touchEnd(row);
      fireEvent.click(row);
      expect(onOpenMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('a plain click still selects the article', () => {
      const { onSelect, row } = renderRow(viewMode);
      fireEvent.click(row);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('without onOpenMenu, the browser keeps its own menu', () => {
      const { row } = renderRow(viewMode, false);
      expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })).toBe(true);
    });
  });
}
```

`src/components/ArticleList/ArticleCard.menu.test.tsx` :

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ArticleCard from './ArticleCard';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('./SavedCategoryPicker', () => ({ default: () => null, SavedCategoryPicker: () => null }));

afterEach(cleanup);

const base = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

function renderCard() {
  const spies = { onSelect: vi.fn(), onOpenSource: vi.fn(), onOpenMenu: vi.fn() };
  const c = render(
    <ArticleCard
      article={base}
      showSource
      rowActions={DEFAULT_ROW_ACTIONS}
      active={false}
      onSelect={spies.onSelect}
      onToggleStar={() => {}}
      onToggleRead={() => {}}
      onToggleReadLater={() => {}}
      onOpenSource={spies.onOpenSource}
      onOpenMenu={spies.onOpenMenu}
    />,
  );
  return { ...spies, card: c.container.querySelector('[data-article-id="a1"]') as HTMLElement };
}

describe('ArticleCard — menu', () => {
  it('right-click opens the article menu at the pointer', () => {
    const { onOpenMenu, card } = renderCard();
    fireEvent.contextMenu(card, { clientX: 40, clientY: 50 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
  });

  it('middle click opens at the source without selecting', () => {
    const { onOpenSource, onSelect, card } = renderCard();
    card.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `npx vitest run src/components/ArticleList/ArticleRow.menu.test.tsx src/components/ArticleList/ArticleCard.menu.test.tsx`
Expected: FAIL — `onOpenMenu` jamais appelé et `onOpenSource` jamais appelé (le typecheck signalera aussi la prop inconnue) ; le test « without onOpenMenu » et « a plain click still selects » passent déjà. Le test de l'étoile passe aussi avant le changement — c'est attendu : il protège contre une régression, il ne pilote pas l'implémentation.

- [ ] **Step 3: `ArticleCard.tsx`**

Remplacer `import { ArticleRowActions } from './ArticleActions';` par :

```ts
import { ArticleRowActions } from './ArticleActions';
import { useArticleMenuGestures } from '../../hooks/useArticleMenuGestures';
```

Remplacer :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
}

export default function ArticleCard({
  article, showSource, rowActions, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource,
}: ArticleCardProps) {
  const { t } = useTranslation();
```

par :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
  /** Clic droit, touche Menu ou appui long : ouvre le menu de l'article. Absent, le navigateur garde son menu. */
  onOpenMenu?: (point: { x: number; y: number }) => void;
}

export default function ArticleCard({
  article, showSource, rowActions, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource, onOpenMenu,
}: ArticleCardProps) {
  const { t } = useTranslation();
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource);
```

Remplacer :

```tsx
      data-article-id={article.id}
      onClick={onSelect}
```

par :

```tsx
      data-article-id={article.id}
      {...gestures}
      onClick={onSelect}
```

- [ ] **Step 4: `ArticleRow` dans `ArticleList.tsx`**

Remplacer :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
}

/**
 * Exporté pour les tests
```

par :

```ts
  onOpenSource: (e: ReactMouseEvent) => void;
  /** Clic droit, touche Menu ou appui long : ouvre le menu de l'article. Absent, le navigateur garde son menu. */
  onOpenMenu?: (point: { x: number; y: number }) => void;
}

/**
 * Exporté pour les tests
```

Remplacer :

```ts
export function ArticleRow({ article, viewMode, showSource, rowActions, favicon, staggerIndex, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource }: ArticleRowProps) {
  const { t } = useTranslation();
```

par :

```ts
export function ArticleRow({ article, viewMode, showSource, rowActions, favicon, staggerIndex, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource, onOpenMenu }: ArticleRowProps) {
  const { t } = useTranslation();
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource);
```

Ligne compacte — remplacer (8 espaces d'indentation) :

```tsx
        draggable
        onDragStart={handleDragStart}
        onClick={onSelect}
```

par :

```tsx
        draggable
        onDragStart={handleDragStart}
        {...gestures}
        onClick={onSelect}
```

Ligne normale — remplacer (6 espaces d'indentation) :

```tsx
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
```

par :

```tsx
      draggable
      onDragStart={handleDragStart}
      {...gestures}
      onClick={onSelect}
```

- [ ] **Step 5: L'état du menu dans `ArticleList`**

Remplacer `import BottomSheet from '../BottomSheet';` par :

```ts
import BottomSheet from '../BottomSheet';
import ArticleContextMenu from './ArticleContextMenu';
import { useArticleMenuGestures } from '../../hooks/useArticleMenuGestures';
import { copyLink } from '../../lib/copyLink';
```

Remplacer :

```ts
  const [optionsOpen, setOptionsOpen] = useState(false); // mobile view-options sheet
```

par :

```ts
  const [optionsOpen, setOptionsOpen] = useState(false); // mobile view-options sheet
  // Menu contextuel d'un article (clic droit, touche Menu, appui long) — voir
  // `ArticleContextMenu`. On garde l'id et la vue, pas l'objet : le menu relit
  // l'article courant, et disparaît si l'article quitte la liste ou si la vue
  // change.
  const [articleMenu, setArticleMenu] = useState<{ articleId: string; view: string; x: number; y: number } | null>(null);
  const closeArticleMenu = useCallback(() => setArticleMenu(null), []);
  const currentView = `${selectedFeed?.id ?? ''}:${filter}`;
  const menuArticle = articleMenu && articleMenu.view === currentView
    ? articles.find((a) => a.id === articleMenu.articleId) ?? null
    : null;
  const copyArticleLink = useCallback(async (url: string) => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard ?? null : null;
    if (await copyLink(url, clipboard) === 'copied') pushToast(t('toast.linkCopied'));
    else pushToast(t('toast.copyFailed'), { tone: 'error' });
  }, [pushToast, t]);
```

Dans `renderCard`, remplacer (indentation de `renderCard`, 8 puis 6 puis 4 espaces) :

```tsx
        openArticleAtSource(article, selectArticleAtSource);
      }}
    />
  );
```

par :

```tsx
        openArticleAtSource(article, selectArticleAtSource);
      }}
      onOpenMenu={(point) => setArticleMenu({ articleId: article.id, view: currentView, ...point })}
    />
  );
```

Dans les lignes, remplacer (24 puis 22 puis 20 espaces) :

```tsx
                        openArticleAtSource(article, selectArticleAtSource);
                      }}
                    />
```

par :

```tsx
                        openArticleAtSource(article, selectArticleAtSource);
                      }}
                      onOpenMenu={(point) => setArticleMenu({ articleId: article.id, view: currentView, ...point })}
                    />
```

Monter le menu à l'ouverture du conteneur principal — remplacer :

```tsx
    <div className="article-list h-full flex flex-col overflow-x-hidden" style={{ background: 'var(--panel-bg)' }}>
      {/* Header */}
```

par :

```tsx
    <div className="article-list h-full flex flex-col overflow-x-hidden" style={{ background: 'var(--panel-bg)' }}>
      {menuArticle && articleMenu && (
        <ArticleContextMenu
          article={menuArticle}
          isReadLater={!!menuArticle.labels?.includes(READ_LATER_LABEL)}
          x={articleMenu.x}
          y={articleMenu.y}
          sheet={isMobile}
          onClose={closeArticleMenu}
          onOpenSource={() => openArticleAtSource(menuArticle, selectArticleAtSource)}
          onToggleRead={() => { void toggleRead(menuArticle); }}
          onToggleStar={() => { void toggleStar(menuArticle); }}
          onToggleReadLater={() => { void toggleReadLater(menuArticle); }}
          onCopyLink={() => { void copyArticleLink(menuArticle.url); }}
        />
      )}
      {/* Header */}
```

⚠️ `useArticleMenuGestures` est importé dans `ArticleList.tsx` pour `ArticleRow`, qui vit dans ce fichier.

- [ ] **Step 6: La sélection iOS**

Dans `src/styles/index.css`, remplacer la ligne `.article-card--read { opacity: 0.62; }` par :

```css
.article-card--read { opacity: 0.62; }

/* ⚠️ L'appui long qui ouvre le menu d'un article déclencherait AUSSI la
   sélection de texte d'iOS, par-dessus le menu — le piège déjà rencontré sur
   `.sidebar-feed-item`. Les deux propriétés sont nécessaires : la première
   seule laisse le surlignage, la seconde seule laisse la bulle. Seulement là
   où le survol n'existe pas : le bureau garde la sélection de texte. */
@media (hover: none) {
  .article-row,
  .article-card {
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
}
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `npx vitest run src/components/ArticleList/ src/hooks/ src/lib/articleMenu.test.ts src/lib/copyLink.test.ts`
Expected: PASS, anciens et nouveaux (dont `ArticleRow.compact.test.tsx` et `ArticleCard.test.tsx` inchangés).

- [ ] **Step 8: `docs/FEATURES.md`**

Remplacer la ligne `### Filtre Non lus` par :

```markdown
### Menu d'un article
Clic droit sur une ligne (normale ou compacte) ou une carte de la grille,
touche Menu du clavier, ou **appui long** au doigt : un menu propose **Ouvrir
à la source**, **Marquer lu / non lu**, **Favori**, **À lire plus tard** et
**Copier le lien**. Le **clic molette** ouvre directement à la source. Demandé
dans l'issue #11 : le réflexe vient de FreshRSS, où le titre est un vrai lien.

- **Où** : `src/components/ArticleList/ArticleContextMenu.tsx` (rendu),
  `src/hooks/useArticleMenuGestures.ts` (gestes), `src/hooks/useLongPress.ts`,
  `src/lib/articleMenu.ts` (entrées, point d'ouverture),
  `src/lib/copyLink.ts` ; état du menu dans `ArticleList.tsx`
- **Spec** : `docs/superpowers/specs/2026-09-13-article-context-menu-design.md`
- **Présentation** : feuille du bas sur téléphone (`useBreakpoint() ===
  'mobile'`), menu flottant ailleurs, rendu dans un portail et replacé par
  `clampToViewport()`. Un iPad au trackpad reçoit le menu flottant : le choix
  suit le format, pas le pointeur.
- **Les actions sont celles des icônes** : « Ouvrir à la source » passe par
  `openArticleAtSource()` (sélection, la ligne garde sa place), « Marquer lu »
  par `toggleRead` (retrait sous « Non lus » compris). Sans URL, « Ouvrir à la
  source » et « Copier le lien » disparaissent.
- **« Copier le lien » copie toujours**, même là où `navigator.share` existe :
  l'entrée dit « copier ». `navigator.clipboard` n'existe qu'en contexte
  sécurisé ; son absence est un échec annoncé (`toast.copyFailed`).
- **Piège — le clic droit des boutons Favori et À lire plus tard est
  prioritaire** : leur rangement par catégorie (`useFileGesture`) appelle
  `preventDefault()`, et le menu sort sur `defaultPrevented`. Un appui long ou
  un clic molette partis d'un bouton lui appartiennent aussi.
- **Piège — Chrome Android émet `contextmenu` sur un appui long** : dans la
  seconde qui suit un appui long abouti, il est absorbé sans rouvrir le menu
  (`firedRecently()`).
- **Piège — touche Menu** : `contextmenu` arrive avec `clientX = clientY = 0` ;
  le menu s'ouvre alors sous la ligne (`menuAnchor()`), pas dans le coin de la
  fenêtre.
- **Appui long** : 500 ms, annulé par `touchmove` et `touchend` (défilement,
  balayage de ligne).
- **Piège — le clic de compatibilité après un appui long** : sur téléphone, la
  feuille du bas s'ouvre SOUS le doigt, et le clic émis au relâchement tombait
  sur son fond, qui la refermait aussitôt. Le `touchend` d'un appui abouti est
  donc `preventDefault()` ; le clic qui passerait quand même est avalé en phase
  de capture sur la ligne.
- **Sélection iOS** : sous `(hover: none)`, lignes et cartes coupent la sélection de texte d'iOS
  (`-webkit-touch-callout` ET `user-select`, comme `.sidebar-feed-item`).
  Troisième implémentation d'un appui long, assumée — celle des flux et
  `useFileGesture` n'ont pas été touchées ; leur unification est au backlog.
- **Fermeture** : après chaque action, au `pointerdown` extérieur, à Échap, et
  quand la vue change (le menu garde l'id de l'article et la vue, pas l'objet).
- **Pas de `role="menu"`** : il promettrait une navigation aux flèches
  qu'aucun menu de l'application ne fournit.

### Filtre Non lus
```

- [ ] **Step 9: `docs/RELEASE-NEXT.md`**

Remplacer :

```markdown
  antérieurs sont effacés. Demandé dans la discussion #13.
```

par :

```markdown
  antérieurs sont effacés. Demandé dans la discussion #13.
- **Clic droit sur un article.** Un menu ouvre l'article à la source dans un
  nouvel onglet, le marque lu ou non lu, l'ajoute aux favoris ou à lire plus
  tard, ou copie son lien. Au doigt, un appui long ouvre le même menu, en
  feuille du bas sur téléphone. Le clic molette ouvre directement l'article à
  la source. Demandé dans l'issue #11.
```

- [ ] **Step 10: Gates, garde-fou, commit**

```bash
git add src/components/ArticleList/ArticleList.tsx src/components/ArticleList/ArticleCard.tsx src/components/ArticleList/ArticleRow.menu.test.tsx src/components/ArticleList/ArticleCard.menu.test.tsx src/styles/index.css docs/FEATURES.md docs/RELEASE-NEXT.md
git commit -m "feat(articles): open an article menu by right-click, long press or middle click"
```

---

### Task 5: Vérification réelle et livraison (contrôleur)

**Files:** aucun, sauf correction d'un défaut trouvé ici (nouveau commit, gates et garde-fou compris).

- [ ] **Step 1: Rendu isolé local** — monter `ArticleContextMenu` dans le navigateur intégré contre la feuille de styles réelle : à **320 px** en feuille du bas (rangées ≥ 44 pt, rien de coupé en fr, de, pl, uk), et en menu flottant sur tablette et desktop, replacé près d'un bord de fenêtre. Thème clair et sombre (juger les couleurs sur capture : les transitions ne progressent pas dans un onglet d'aperçu en arrière-plan).
- [ ] **Step 2: Pousser `dev`** puis `gh run list --branch dev --limit 2` → **CI** et **Publish image** en succès.
- [ ] **Step 3: Après redéploiement par le propriétaire**, sur l'instance de dev dans le vrai Chrome : clic droit sur une ligne normale, une ligne compacte et une carte ; chaque entrée (et remise en état de ce qui a été modifié) ; « Copier le lien » et son toast ; clic droit sur l'étoile → rangement, pas le menu ; clic molette → nouvel onglet ; Échap et clic extérieur ferment.
- [ ] **Step 4: Dire ce qui n'est pas vérifié** : l'appui long sur un vrai iPhone et le piège de Chrome Android ne sont confirmables que sur appareil.
