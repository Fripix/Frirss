# YouTube Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play YouTube videos from the reading pane through a click-to-load facade — restoring embedded videos that the sanitizer currently deletes, without contacting Google until the user asks to watch.

**Architecture:** A pure lib turns YouTube iframes/links in article HTML into facade markup made only of sanitizer-safe tags, injected **before** `sanitizeHtml`. A delegated click listener swaps a facade for a real `youtube-nocookie` iframe built via the DOM API. Feed-level video articles additionally get a head facade rendered as React.

**Tech Stack:** TypeScript (strict), React 18, Zustand, DOMPurify, Vitest, i18next (9 locales).

## Global Constraints

- **No AI mentions anywhere** — neutral conventional commits, no `Co-Authored-By`.
- **Public repo — CI "Leak guard"**: never commit the personal domain, internal IPs, ports, volume paths or config hashes, docs included. Run before every commit (read the output, then commit — an `if …; fi && git commit` chain does **not** block):
  `git grep -nI --untracked -e 'fri[h]ub' -e '10\.[3]\.0\.[0-9]' -- . ':(exclude).github/workflows/*' ':(exclude)package-lock.json'`
- **After every push, watch BOTH workflows**: `CI` *and* `Publish image`.
- **i18n**: every new string in all 9 locales.
- **Gates before every commit**: `npm run typecheck && npm run lint && npx vitest run && npm run build`.
- **TDD**: pure logic in `src/lib/*.ts`, test-first.
- **Verified facts, do not re-litigate**: DOMPurify (profile `html`) strips `<iframe>` silently; `div`/`data-*`/`img`/`button` survive sanitisation; nginx already sends `frame-src 'self' https:` so **no CSP change is needed**.
- **Order matters**: facade injection runs **before** `sanitizeHtml`, otherwise the iframes are already gone.

---

### Task 1: Pure lib — detect, thumbnail, inject facades

**Files:**
- Create: `src/lib/youtube.ts`
- Create: `src/lib/youtube.test.ts`

**Interfaces:**
- Produces:
  - `interface YouTubeRef { id: string; start?: number }`
  - `extractYouTubeId(url: string): YouTubeRef | null`
  - `youtubeThumbnail(id: string): string`
  - `injectVideoFacades(html: string): { html: string; ids: string[] }`
  - `facadeMarkup(ref: YouTubeRef, thumbnail: string, playLabel: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/youtube.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractYouTubeId, youtubeThumbnail, injectVideoFacades } from './youtube';

describe('extractYouTubeId', () => {
  it('reads the watch form', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the short form', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the embed form', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the shorts form', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the nocookie form', () => {
    expect(extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('keeps other query parameters out of the id', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('preserves a start time in seconds', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=90')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('preserves a start time written as 1m30s', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('accepts the start parameter', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42')).toEqual({ id: 'dQw4w9WgXcQ', start: 42 });
  });
  it('rejects non-YouTube urls', () => {
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('https://example.com/watch?v=abc')).toBeNull();
  });
  it('rejects a YouTube url without a video', () => {
    expect(extractYouTubeId('https://www.youtube.com/@channel')).toBeNull();
  });
  it('handles empty input', () => {
    expect(extractYouTubeId('')).toBeNull();
  });
});

describe('youtubeThumbnail', () => {
  it('builds the standard thumbnail url', () => {
    expect(youtubeThumbnail('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('injectVideoFacades', () => {
  it('replaces a YouTube iframe with facade markup', () => {
    const { html, ids } = injectVideoFacades('<p>a</p><iframe src="https://www.youtube.com/embed/abc123"></iframe>');
    expect(ids).toEqual(['abc123']);
    expect(html).toContain('data-yt-id="abc123"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<p>a</p>');
  });

  it('replaces a standalone YouTube link', () => {
    const { html, ids } = injectVideoFacades('<p><a href="https://youtu.be/abc123">Voir</a></p>');
    expect(ids).toEqual(['abc123']);
    expect(html).toContain('data-yt-id="abc123"');
  });

  it('carries the start time into the facade', () => {
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/abc123?start=42"></iframe>');
    expect(html).toContain('data-yt-start="42"');
  });

  it('leaves non-YouTube iframes untouched', () => {
    const src = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
    expect(injectVideoFacades(src).html).toBe(src);
  });

  it('reports each video once even when repeated', () => {
    const { ids } = injectVideoFacades(
      '<iframe src="https://www.youtube.com/embed/abc123"></iframe><a href="https://youtu.be/abc123">x</a>',
    );
    expect(ids).toEqual(['abc123']);
  });

  it('returns the html untouched when there is no video', () => {
    expect(injectVideoFacades('<p>rien</p>')).toEqual({ html: '<p>rien</p>', ids: [] });
  });

  it('handles empty input', () => {
    expect(injectVideoFacades('')).toEqual({ html: '', ids: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/youtube.test.ts`
Expected: FAIL — cannot find module `./youtube`.

- [ ] **Step 3: Implement `src/lib/youtube.ts`**

```ts
export interface YouTubeRef {
  id: string;
  /** Start offset in seconds, when the URL carries one. */
  start?: number;
}

const ID = '[A-Za-z0-9_-]{11}';
const PATTERNS = [
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/(?:embed|shorts|v)/(${ID})`, 'i'),
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com)/watch\\?(?:[^"']*&)?v=(${ID})`, 'i'),
  new RegExp(`youtu\\.be/(${ID})`, 'i'),
];

/** "90", "1m30s", "1h2m3s" → seconds. */
function parseStart(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const [h, min, s] = m.slice(1).map((v) => Number(v || 0));
  return h * 3600 + min * 60 + s;
}

/** Video id (and start time) for any YouTube URL form, or null. */
export function extractYouTubeId(url: string): YouTubeRef | null {
  if (!url) return null;
  let id: string | null = null;
  for (const re of PATTERNS) {
    const m = url.match(re);
    if (m) { id = m[1]; break; }
  }
  if (!id) return null;
  const t = url.match(/[?&](?:t|start)=([^&"'\s]+)/i);
  const start = parseStart(t ? t[1] : null);
  return start === undefined ? { id } : { id, start };
}

/** Fallback thumbnail, used when the article provides none. */
export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

const escapeAttr = (s: string): string => s.replace(/"/g, '&quot;');

/**
 * Click-to-load placeholder. Built only from tags DOMPurify keeps, so it
 * survives sanitisation — unlike the <iframe> it replaces, which is deleted
 * silently (that is why embedded videos are invisible today).
 */
export function facadeMarkup(ref: YouTubeRef, thumbnail: string, playLabel: string): string {
  const start = ref.start ? ` data-yt-start="${ref.start}"` : '';
  return (
    `<div class="yt-facade" data-yt-id="${escapeAttr(ref.id)}"${start}>` +
      `<img class="yt-facade__thumb" src="${escapeAttr(thumbnail)}" alt="" loading="lazy">` +
      `<button type="button" class="yt-facade__play" aria-label="${escapeAttr(playLabel)}">` +
        '<svg viewBox="0 0 68 48" aria-hidden="true" focusable="false">' +
          '<path class="yt-facade__bg" d="M66.5 7.7a8 8 0 0 0-5.6-5.7C56 .7 34 .7 34 .7s-22 0-26.9 1.3a8 8 0 0 0-5.6 5.7A83 83 0 0 0 .5 24a83 83 0 0 0 1 16.3 8 8 0 0 0 5.6 5.7C12 47.3 34 47.3 34 47.3s22 0 26.9-1.3a8 8 0 0 0 5.6-5.7A83 83 0 0 0 67.5 24a83 83 0 0 0-1-16.3z"/>' +
          '<path class="yt-facade__arrow" d="M45 24 27 14v20z"/>' +
        '</svg>' +
      '</button>' +
    '</div>'
  );
}

const IFRAME_RE = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/iframe>|<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi;
const LINK_RE = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>.*?<\/a>/gi;

/**
 * Turn YouTube iframes and links in article HTML into facades, in place.
 * Must run BEFORE sanitizeHtml — afterwards the iframes no longer exist.
 * Returns the ids found so the caller can avoid showing the same video twice.
 */
export function injectVideoFacades(html: string): { html: string; ids: string[] } {
  if (!html) return { html: '', ids: [] };
  const ids: string[] = [];

  const toFacade = (whole: string, url: string): string => {
    const ref = extractYouTubeId(url);
    if (!ref) return whole;
    if (!ids.includes(ref.id)) ids.push(ref.id);
    return facadeMarkup(ref, youtubeThumbnail(ref.id), 'Play');
  };

  let out = html.replace(IFRAME_RE, (whole, a, b) => toFacade(whole, a || b || ''));
  out = out.replace(LINK_RE, (whole, href) => toFacade(whole, href || ''));
  return { html: out, ids };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/youtube.test.ts`
Expected: PASS (20 tests). If the link regex also swallows link text that is not a video, only YouTube hrefs convert — non-matching links are returned unchanged by `toFacade`.

- [ ] **Step 5: Gates + leak guard + commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add src/lib/youtube.ts src/lib/youtube.test.ts
git commit -m "feat(youtube): detect videos and build click-to-load facades"
```

---

### Task 2: Facade + play badge styles

**Files:**
- Modify: `src/styles/index.css` (append)

- [ ] **Step 1: Append the styles**

```css
/* ── YouTube facade: thumbnail + play button, the iframe loads only on click ── */
.yt-facade {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 14px 0;
  border-radius: var(--radius, 8px);
  overflow: hidden;
  background: var(--list-hover);
  cursor: pointer;
}
.yt-facade__thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.yt-facade__play {
  position: absolute; inset: 0; margin: auto;
  width: 68px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: 0; padding: 0; cursor: pointer;
}
.yt-facade__play svg { width: 100%; height: 100%; }
.yt-facade__bg { fill: #212121; fill-opacity: 0.8; transition: fill-opacity 0.15s ease; }
.yt-facade__arrow { fill: #fff; }
.yt-facade:hover .yt-facade__bg { fill: #f00; fill-opacity: 1; }
.yt-facade__frame { width: 100%; height: 100%; border: 0; display: block; }
/* Offline: the video cannot load, say so instead of showing a broken frame. */
.yt-facade__offline {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 6px 10px; font-size: 11px; text-align: center;
  background: rgba(0, 0, 0, 0.65); color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .yt-facade__bg { transition: none; }
}

/* Play badge on cards whose article is a video */
.article-card__play {
  position: absolute; right: 8px; bottom: 8px;
  width: 26px; height: 26px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.65); color: #fff;
  pointer-events: none;
}
.article-card__play svg { width: 13px; height: 13px; }
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/styles/index.css
git commit -m "feat(youtube): facade and play badge styles"
```

---

### Task 3: Preference + i18n

**Files:**
- Modify: `src/stores/uiStore.ts`
- Modify: `src/components/Preferences/Preferences.tsx` (`GeneralTab`)
- Modify: `src/locales/*.json` (×9)

**Interfaces:**
- Produces: `inlineVideos: boolean`, `setInlineVideos(v: boolean)` — synced per user, default `true`.

- [ ] **Step 1: Add the store field**

In `interface UiState`, after the `confirmMarkAllRead` pair:

```ts
  // Show a click-to-load player for YouTube videos. Off → a plain link.
  inlineVideos: boolean;
  setInlineVideos: (v: boolean) => void;
```

In the store body, after `setConfirmMarkAllRead`:

```ts
  inlineVideos: loadJson('frirss_inlineVideos', true),
  setInlineVideos: (v) => {
    localStorage.setItem('frirss_inlineVideos', JSON.stringify(v));
    set({ inlineVideos: v });
  },
```

Add `'inlineVideos'` to the `jsonKeys` array in `applyServerPrefs` **and** to the exported `UI_SYNC_KEYS` (both currently end with `'confirmMarkAllRead', 'offlineImagePreset',`).

- [ ] **Step 2: Add the strings to all 9 locales**

```bash
node -e '
const fs=require("fs");
const add={
 inlineVideos:{fr:"Lire les vidéos dans l’article",en:"Play videos in the article",de:"Videos im Artikel abspielen",es:"Reproducir los vídeos en el artículo",it:"Riprodurre i video nell’articolo",nl:"Videos in het artikel afspelen",pl:"Odtwarzaj filmy w artykule",pt:"Reproduzir os vídeos no artigo",uk:"Відтворювати відео у статті"},
 inlineVideosHint:{fr:"Affiche la miniature ; la vidéo n’est chargée qu’au clic. Désactivé, un lien vers YouTube s’affiche.",en:"Shows the thumbnail; the video loads only on click. Off, a link to YouTube is shown instead.",de:"Zeigt das Vorschaubild; das Video lädt erst beim Klick. Aus: stattdessen ein Link zu YouTube.",es:"Muestra la miniatura; el vídeo se carga solo al hacer clic. Desactivado, se muestra un enlace a YouTube.",it:"Mostra la miniatura; il video si carica solo al clic. Disattivato, viene mostrato un link a YouTube.",nl:"Toont de miniatuur; de video laadt pas bij klikken. Uit: een link naar YouTube.",pl:"Pokazuje miniaturę; wideo ładuje się dopiero po kliknięciu. Wyłączone: link do YouTube.",pt:"Mostra a miniatura; o vídeo só carrega ao clicar. Desativado, é apresentado um link para o YouTube.",uk:"Показує мініатюру; відео завантажується лише після кліку. Вимкнено — показується посилання на YouTube."},
 videoPlay:{fr:"Lire la vidéo",en:"Play video",de:"Video abspielen",es:"Reproducir el vídeo",it:"Riproduci il video",nl:"Video afspelen",pl:"Odtwórz wideo",pt:"Reproduzir o vídeo",uk:"Відтворити відео"},
 videoOpen:{fr:"Ouvrir sur YouTube",en:"Open on YouTube",de:"Auf YouTube öffnen",es:"Abrir en YouTube",it:"Apri su YouTube",nl:"Openen op YouTube",pl:"Otwórz w YouTube",pt:"Abrir no YouTube",uk:"Відкрити на YouTube"},
 videoOffline:{fr:"Vidéo indisponible hors ligne",en:"Video unavailable offline",de:"Video offline nicht verfügbar",es:"Vídeo no disponible sin conexión",it:"Video non disponibile offline",nl:"Video offline niet beschikbaar",pl:"Wideo niedostępne offline",pt:"Vídeo indisponível offline",uk:"Відео недоступне офлайн"},
};
for(const lng of ["fr","en","de","es","it","nl","pl","pt","uk"]){
  const p=`src/locales/${lng}.json`;
  const o=JSON.parse(fs.readFileSync(p,"utf8"));
  o.preferences.general=o.preferences.general||{};
  o.preferences.general.inlineVideos=add.inlineVideos[lng];
  o.preferences.general.inlineVideosHint=add.inlineVideosHint[lng];
  o.readingPane=o.readingPane||{};
  o.readingPane.videoPlay=add.videoPlay[lng];
  o.readingPane.videoOpen=add.videoOpen[lng];
  o.readingPane.videoOffline=add.videoOffline[lng];
  fs.writeFileSync(p, JSON.stringify(o,null,2)+"\n");
}
console.log("locales updated");
'
```

- [ ] **Step 3: Add the toggle to the General tab**

In `GeneralTab` (the tab holding `confirmMarkAllRead`), add a row mirroring the existing one:

```tsx
      <div className="flex items-start justify-between gap-4 select-none">
        <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.general.inlineVideos')}
          <span className="block text-[11px] opacity-70 mt-0.5">{t('preferences.general.inlineVideosHint')}</span>
        </span>
        <span className="mt-0.5">
          <ToggleSwitch checked={inlineVideos} onChange={setInlineVideos} ariaLabel={t('preferences.general.inlineVideos')} />
        </span>
      </div>
```

with `const inlineVideos = useUiStore((s) => s.inlineVideos);` and `const setInlineVideos = useUiStore((s) => s.setInlineVideos);` added to that component.

- [ ] **Step 4: Verify locales + gates + commit**

```bash
node -e 'for(const l of ["fr","en","de","es","it","nl","pl","pt","uk"]){const o=require("./src/locales/"+l+".json"); if(!o.preferences.general.inlineVideos||!o.readingPane.videoPlay||!o.readingPane.videoOffline){console.error("MISSING",l);process.exit(1)}} console.log("all 9 ok")'
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/stores/uiStore.ts src/components/Preferences/Preferences.tsx src/locales
git commit -m "feat(youtube): preference to play videos in the article"
```

---

### Task 4: Wire the reading pane

The core: inject facades before sanitising, add the head facade for video articles, and swap a facade for a real iframe on click.

**Files:**
- Modify: `src/components/ReadingPane/ReadingPane.tsx`

**Interfaces:**
- Consumes: `extractYouTubeId`, `injectVideoFacades`, `facadeMarkup`, `youtubeThumbnail` (Task 1); `inlineVideos` (Task 3).

- [ ] **Step 1: Imports and preference**

```ts
import { extractYouTubeId, injectVideoFacades, facadeMarkup, youtubeThumbnail } from '../../lib/youtube';
```

and inside the component: `const inlineVideos = useUiStore((s) => s.inlineVideos);`

- [ ] **Step 2: Inject facades into the content pipeline**

Replace the `finalContent` computation (currently at ~line 634):

```ts
  const finalContent = reserveImgAspect(sanitizeHtml(displayContent || ''))
    .replace(/<img(?!\s+loading=)/gi, (m) => ++_imgIdx <= 2 ? m : '<img loading="lazy"');
```

with:

```ts
  // Facades must be injected BEFORE sanitising: DOMPurify deletes <iframe>
  // outright, which is why embedded videos are invisible without this.
  const withVideos = inlineVideos ? injectVideoFacades(displayContent || '') : { html: displayContent || '', ids: [] };
  const finalContent = reserveImgAspect(sanitizeHtml(withVideos.html))
    .replace(/<img(?!\s+loading=)/gi, (m) => ++_imgIdx <= 2 ? m : '<img loading="lazy"');
```

- [ ] **Step 3: Head facade for feed-level video articles**

Add above the return, after `finalContent`:

```ts
  // A YouTube-feed article IS the video: show it first, unless the body already
  // carries the same one (which the injection above would have turned into a
  // facade).
  const articleVideo = inlineVideos ? extractYouTubeId(selectedArticle?.url || '') : null;
  const headVideo = articleVideo && !withVideos.ids.includes(articleVideo.id) ? articleVideo : null;
  const headFacadeHtml = headVideo
    ? facadeMarkup(headVideo, youtubeThumbnail(headVideo.id), t('readingPane.videoPlay'))
    : '';
```

Then render it just before the body block (the `{awaitingExtract ? … : …}` at ~line 1031):

```tsx
          {headFacadeHtml && (
            <div className="article-content" dangerouslySetInnerHTML={{ __html: headFacadeHtml }} />
          )}
```

- [ ] **Step 4: Delegated click handler**

Add inside the component:

```ts
  // One listener for every facade (head + inline): swap in the real player.
  // The iframe is built through the DOM API, so the sanitizer never sees it.
  const handleVideoClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const facade = (e.target as Element).closest?.('.yt-facade') as HTMLElement | null;
    if (!facade) return;
    const id = facade.getAttribute('data-yt-id');
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!facade.querySelector('.yt-facade__offline')) {
        const note = document.createElement('div');
        note.className = 'yt-facade__offline';
        note.textContent = t('readingPane.videoOffline');
        facade.appendChild(note);
      }
      return;
    }

    const start = facade.getAttribute('data-yt-start');
    const params = new URLSearchParams({ autoplay: '1' });
    if (start) params.set('start', start);
    const frame = document.createElement('iframe');
    frame.className = 'yt-facade__frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
    frame.allow = 'accelerometer; encrypted-media; picture-in-picture; fullscreen';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    facade.replaceChildren(frame);
  }, [t]);
```

Attach it to **both** the head facade wrapper and the body container by adding `onClick={handleVideoClick}` to each of those two `<div>`s.

> `useCallback` and `MouseEvent as ReactMouseEvent` must be imported in this
> file — check the existing import line before adding.

- [ ] **Step 5: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/components/ReadingPane/ReadingPane.tsx
git commit -m "feat(youtube): play videos from the reading pane through a facade"
```

---

### Task 5: Play badge on cards

**Files:**
- Modify: `src/components/ArticleList/ArticleCard.tsx`

- [ ] **Step 1: Flag video articles**

Add the import and derive the flag:

```ts
import { extractYouTubeId } from '../../lib/youtube';
```

```ts
  const isVideo = !!extractYouTubeId(article.url || '');
```

- [ ] **Step 2: Render the badge**

Inside `.article-card__thumb`, next to the unread dot:

```tsx
        {isVideo && (
          <span className="article-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        )}
```

- [ ] **Step 3: Gates + commit**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git add src/components/ArticleList/ArticleCard.tsx
git commit -m "feat(youtube): mark video articles in the grid"
```

---

### Task 6: Verify and deploy

- [ ] **Step 1: Full gates**

`npm run typecheck && npm run lint && npx vitest run && npm run build`

- [ ] **Step 2: Browser verification**

With the preview running, verify through the real modules:
- `injectVideoFacades` on a sample containing an iframe → facade markup, and that markup **survives `sanitizeHtml`** (this is the load-bearing behaviour).
- A non-YouTube iframe is left alone.
- `read_console_messages` shows no new errors (`/api/*` 500s are expected with the front-end-only dev server).

- [ ] **Step 3: Leak guard, then push**

Run the leak-guard grep, read its output, then `git push origin dev`.

- [ ] **Step 4: Watch BOTH workflows**

`gh run list --branch dev --limit 2`, then watch `CI` and `Publish image` to success.

- [ ] **Step 5: Deploy the dev instance**

Recreate the dev container from the freshly built image, reusing its exact env and all compose labels (specifics live outside this repo — see the operator's notes). Allow ~12 s before the health check; the backend is not up immediately. Verify `/api/health` reports the expected version.

- [ ] **Step 6: Hand off**

Tell the user to test: a channel-feed article (player at the top), a blog post embedding a video (player in place — previously invisible), the play badge in grid view, the preference toggle, and offline behaviour.

---

## Notes for the implementer

- **Injection order is the whole trick.** After `sanitizeHtml` the iframes are gone; the facade must be created before it.
- **Never inject the iframe as HTML.** It would be stripped. Build it with `document.createElement` on click.
- **No CSP change**: nginx already sends `frame-src 'self' https:`.
- The head facade and the body content are two separate containers — the click handler must be attached to both.
