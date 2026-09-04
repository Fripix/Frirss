import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal, flushSync } from 'react-dom';
import { useFeedStore, READ_LATER_LABEL } from '../../stores/feedStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { buildArticleBody, displayedHtml, reserveImgAspect, readingMinutes } from '../../lib/articleBody';
import { readingBodyKind, showsSkeleton, showsReadingTime } from '../../lib/readingBody';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { readProgressPercent } from '../../lib/readProgress';
import type { Article } from '../../types';
import type { ExtractedContent } from '../../utils/extractContent';
import { peekExtract, getExtract, putExtract, revalidateIfStale } from '../../lib/extractCache';
import { isFocusToggleTarget } from '../../lib/readingFocus';
import { extractYouTubeId, facadeMarkup, youtubeThumbnail } from '../../lib/youtube';
import { READ_LATER_PREFIX, STARRED_PREFIX } from '../../lib/savedCategories';
import { readableTextOn } from '../../lib/readableText';
import { planHeroWarm, runHeroWarm } from '../../lib/heroWarm';
import { rememberImageSize } from '../../lib/imageAspect';
import { formatArticleDate } from '../../utils/dates';
import { IMAGE_CACHE_NAME } from '../../lib/storageEstimate';
import SavedCategoryPicker from '../ArticleList/SavedCategoryPicker';
import BottomSheet from '../BottomSheet';
// extractFullContent is loaded on demand (code-split) — see handleExtract.

// Body placeholder shown while an auto-extract feed loads the full text.
// La prop d'injection est un objet de MODULE, pas un littéral dans le JSX :
// React 19 réécrit `innerHTML` dès que l'objet `dangerouslySetInnerHTML`
// change d'identité, même à contenu identique (voir `src/lib/articleBody.ts`).
const SKELETON_HTML =
  '<div class="reading-skeleton">' +
    '<div class="rs-img"></div>' +
    ['96%', '88%', '92%', '70%', '90%', '85%', '94%', '60%']
      .map((w) => `<div class="rs-line" style="width:${w}"></div>`)
      .join('') +
  '</div>';
const SKELETON_PROP = { __html: SKELETON_HTML };

/**
 * L'image est-elle déjà dans le cache du service worker ?
 *
 * `caches.match(url, { cacheName })` plutôt que `caches.open()` : la seconde
 * CRÉERAIT le cache s'il n'existe pas encore. `caches` est absent de jsdom et
 * d'un contexte non sécurisé — l'absence vaut « non », jamais une erreur.
 */
async function isImageCached(url: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    return !!(await caches.match(url, { cacheName: IMAGE_CACHE_NAME }));
  } catch {
    return false;
  }
}

/**
 * Charger une image **exactement comme le rendu le ferait** : en affectant
 * `src` sur un élément `<img>` détaché. La requête porte alors
 * `destination === 'image'`, donc la route Workbox la met en cache — ce qu'un
 * `fetch()` programmatique ne produit pas, et que la CSP (`connect-src 'self'`)
 * bloquerait de toute façon en cross-origin.
 *
 * Renvoie les dimensions naturelles mesurées, ou `null` si l'image a échoué —
 * ce qu'un hébergeur qui refuse le lien direct fait couramment.
 *
 * Le délai de garde n'annule rien : il rend seulement sa place au runner. Une
 * requête qui ne répond jamais immobiliserait sinon l'une des deux voies pour
 * la durée de la session, et chaque article traversé en laisserait une de plus.
 */
const WARM_IMAGE_TIMEOUT = 10_000;

function warmImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    let done = false;
    const finish = (value: { width: number; height: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    const guard = setTimeout(() => finish(null), WARM_IMAGE_TIMEOUT);
    img.decoding = 'async';
    img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => finish(null);
    img.src = url;
  });
}

interface SwipeTouch {
  startX?: number;
  startY?: number;
  decided?: boolean;
  active?: boolean;
  preview?: HTMLDivElement | null;
  previewSide?: number;
  adj?: Article;
}

interface ReadingPaneProps {
  showBack?: boolean;
}

export default function ReadingPane({ showBack }: ReadingPaneProps) {
  const { t } = useTranslation();
  const { selectedArticle, selectArticle, toggleRead, toggleStar, toggleReadLater, categoryIds, selectNextArticle, selectPrevArticle } = useFeedStore();
  const theme = useThemeStore((s) => s.theme);
  const getLabelColor = useThemeStore((s) => s.getLabelColor);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const feedSettings = useUiStore((s) => s.feedSettings);
  const readingFocus = useUiStore((s) => s.readingFocus);
  const inlineVideos = useUiStore((s) => s.inlineVideos);
  // Which saved-category picker is open (null = none).
  const [filing, setFiling] = useState<{ prefix: string; x: number; y: number } | null>(null);
  const toggleReadingFocus = useUiStore((s) => s.toggleReadingFocus);
  const mobileReadingFontSize = useUiStore((s) => s.mobileReadingFontSize);
  const setMobileReadingFontSize = useUiStore((s) => s.setMobileReadingFontSize);
  const bodySize = parseInt(theme.fontSizes['reading-body']) || 14;

  // Partager / copier le lien. Le volet ne proposait que « ouvrir l'original » :
  // dans la PWA iOS installée, envoyer un article à quelqu'un obligeait à
  // l'ouvrir d'abord dans Safari. `navigator.share` là où il existe, le
  // presse-papiers partout ailleurs.
  const pushToast = useUiStore((s) => s.pushToast);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const shareArticle = useCallback(async (article: Article) => {
    if (!article.url) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: article.title, url: article.url });
        return;
      }
      await navigator.clipboard.writeText(article.url);
      pushToast(t('toast.linkCopied'));
    } catch (err) {
      // Un partage refusé par l'utilisateur n'est pas une erreur à annoncer.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      pushToast(t('toast.copyFailed'), { tone: 'error' });
    }
  }, [pushToast, t]);

  // Full content extraction state
  const [extractedContent, setExtractedContent] = useState<ExtractedContent | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const lastExtractedId = useRef<string | null>(null);

  // Reading progress
  const [readProgress, setReadProgress] = useState(0);
  const [readSettingsOpen, setReadSettingsOpen] = useState(false); // mobile text-size popover
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const slideDirRef = useRef<string | null>(null); // mirrors slideDir state for use in effects

  // Reset extraction state when article changes. If we already have the
  // extracted content cached (e.g. returning to a previously-read article),
  // show it immediately — no null flash, no re-extraction delay.
  useEffect(() => {
    const id = selectedArticle?.id;
    if (!id || id === lastExtractedId.current) return;
    const cached = peekExtract(id);
    if (cached) {
      lastExtractedId.current = id;
      setExtractedContent(cached);
    } else {
      setExtractedContent(null);
    }
    setExtractError(null);
    setExtracting(false);
  }, [selectedArticle?.id]);

  // Article change — fade animation on tap, no animation on swipe
  const prevArticleIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedArticle?.id) return;
    setReadProgress(0);
    if (!slideDirRef.current) {
      // Tap: trigger fade-in animation + scroll to top
      const el = articleRef.current;
      if (el) {
        // Sens du mouvement : l'animation était un fondu d'opacité pur, sans
        // déplacement — rien ne disait qu'on avançait dans une liste, ni dans
        // quel sens. Un article situé plus haut dans la liste entre par le
        // haut. Position inconnue (recherche, ouverture directe) : on garde le
        // sens par défaut plutôt que d'inventer un mouvement.
        const list = useFeedStore.getState().articles;
        const from = list.findIndex((a) => a.id === prevArticleIdRef.current);
        const to = list.findIndex((a) => a.id === selectedArticle.id);
        el.dataset.enter = from >= 0 && to >= 0 && to < from ? 'up' : 'down';
        el.classList.remove('article-enter');
        void el.offsetWidth; // force reflow to re-trigger animation
        el.classList.add('article-enter');
      }
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    }
    prevArticleIdRef.current = selectedArticle.id;
    // Swipe: scroll + animation handled by the swipe handler
  }, [selectedArticle?.id]);

  // Auto-extract for feeds with autoExtract enabled
  useEffect(() => {
    if (!selectedArticle?.url || !selectedArticle?.sourceId) return;
    if (lastExtractedId.current === selectedArticle.id) return;
    const autoExtract = feedSettings[selectedArticle.sourceId]?.autoExtract;
    if (autoExtract) {
      const timer = setTimeout(() => {
        handleExtract();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedArticle?.id, selectedArticle?.sourceId, feedSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Préchargement de fond : préparer les articles suivants pour que passer à
  // eux soit instantané. Uniquement sur les flux à extraction automatique (les
  // autres ont déjà leur corps en mémoire). Séquentiel et différé pour ne pas
  // concurrencer l'article courant ; l'extrait rejoint le cache LRU borné, donc
  // la mémoire reste plafonnée.
  //
  // Deux travaux, deux portées, et la différence est celle du TRANSPORT :
  //
  //  • Le TEXTE, sur DIX articles (N+1 … N+10), et sur les seuls flux à
  //    extraction automatique. Il passe par le **proxy backend**, plafonné par
  //    utilisateur et par minute, où l'extraction de fond puise déjà — d'où la
  //    boucle SÉQUENTIELLE : une requête à la fois, et rien ne part si le
  //    balayage reprend. Ce qui avait saturé le proxy plus tôt dans le cycle
  //    1.4.10 n'était pas la taille de cette fenêtre mais le téléchargement des
  //    images du corps *par le même proxy* : dix extractions plus quatre
  //    requêtes d'image chacune partaient d'un coup, et le balayage suivant
  //    attendait derrière la file — 2 à 7 s sur iPhone au lieu de ~0,9 s. Les
  //    images ont quitté le proxy (ci-dessous) ; le texte seul y tient, une
  //    requête par article. **Ne pas élargir davantage, ni paralléliser.**
  //
  //  • Les IMAGES d'en-tête, sur DIX articles, et **hors du proxy**. Rien ne
  //    réécrit le `src` d'une image d'article : le navigateur va la chercher
  //    directement à son origine, et le service worker la met en cache
  //    (`destination === 'image'`). Réchauffer, c'est faire exactement cela sur
  //    une `new Image()` détachée. Aucun octet ne traverse le backend, d'où une
  //    fenêtre généreuse et un plafond de deux requêtes en vol qui suffit.
  //
  // Le délai d'une seconde couvre les deux : pendant un balayage rapide,
  // l'effet est démonté avant que quoi que ce soit ne parte.
  useEffect(() => {
    const cur = selectedArticle;
    if (!cur?.id) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const { articles } = useFeedStore.getState();
      const fs = useUiStore.getState().feedSettings;
      const idx = articles.findIndex((a) => a.id === cur.id);
      if (idx < 0) return;

      // Images : lancé sans être attendu, il n'a rien à voir avec l'extraction
      // et n'emprunte pas le même chemin.
      void runHeroWarm(
        planHeroWarm({ articles, currentId: cur.id }),
        {
          isCached: isImageCached,
          warm: warmImage,
          remember: (url, m) => rememberImageSize(url, m.width, m.height),
          cancelled: () => cancelled,
        },
      );

      const upcoming = articles
        .slice(idx + 1, idx + 11) // N+1 … N+10, comme les images
        .filter((a) => a.url && fs[a.sourceId]?.autoExtract && !peekExtract(a.id));
      if (upcoming.length === 0) return;
      const { extractFullContent } = await import('../../utils/extractContent');
      for (const a of upcoming) {
        if (cancelled) break;
        if (peekExtract(a.id)) continue;
        // Déjà persisté ? Le remonter en mémoire et épargner le réseau.
        if (await getExtract(a.id)) continue;
        try {
          const result = await extractFullContent(a.url!);
          if (!cancelled) await putExtract(a.id, result);
        } catch { /* échecs de préchargement ignorés */ }
      }
    }, 1000); // laisser l'article courant se charger d'abord
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedArticle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reading progress tracking
  //
  // Une mesure par IMAGE, pas par événement de défilement. Le défilement par
  // inertie d'iOS émet ses événements plus vite que le rendu, et chacun
  // lisait `scrollHeight`/`clientHeight` (donc forçait un recalcul de mise en
  // page) avant de poser un état qui re-rendait tout le volet. Coalescer sur
  // `requestAnimationFrame` borne le travail à ce que l'écran peut montrer.
  // Ce n'est PAS ce qui causait le clignotement — voir `articleBody.ts` — mais
  // c'est du travail que personne ne voyait.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight } = container;
      setReadProgress(readProgressPercent(scrollTop, scrollHeight, clientHeight));
    };
    function handleScroll() {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [selectedArticle?.id]);

  const breakpoint = useBreakpoint();
  const isMobileOrTablet = breakpoint !== 'desktop';

  // Dynamic theme-color for Safari status bar
  useEffect(() => {
    if (!isMobileOrTablet || !selectedArticle) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const prev = meta.getAttribute('content');
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim();
    meta.setAttribute('content', accent || '#4cd4a1');
    return () => meta.setAttribute('content', prev || '#ffffff');
  }, [isMobileOrTablet, !!selectedArticle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swipe left/right for next/prev article (mobile/tablet) ──────
  // 100% DOM-based — no React state for positions/animations to avoid conflicts
  const swipeXRef = useRef(0);
  const swipeTouchRef = useRef<SwipeTouch>({});
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  // Touch handlers — native for passive:false on touchmove
  useEffect(() => {
    if (!isMobileOrTablet) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    function cleanupPreview(t?: SwipeTouch) {
      if (t?.preview?.parentElement) t.preview.parentElement.removeChild(t.preview);
      if (t) t.preview = null;
    }

    function esc(s: string | null | undefined): string {
      if (!s) return '';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function onTouchStart(e: TouchEvent) {
      if (animatingRef.current) return;
      // Remove any lingering ghost from a previous swipe still waiting on
      // extraction — snaps it to its end so two swipes never overlap.
      contentWrapperRef.current?.querySelectorAll('.swipe-ghost').forEach((g) => g.remove());
      swipeTouchRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        decided: false,
        active: false,
        preview: null,
        previewSide: 0,
      };
    }

    function onTouchMove(e: TouchEvent) {
      const t = swipeTouchRef.current;
      if (t.startX === undefined || t.startY === undefined) return;

      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;

      if (!t.decided) {
        // Generous horizontal swipe detection:
        // - Lower threshold (8px) for faster decision
        // - Accept any gesture that's even slightly more horizontal than vertical
        //   (~55° cone: adx > ady * 0.7)
        // - CRITICAL: when decided horizontal, fall through to e.preventDefault()
        //   on the SAME touchmove event — otherwise browser starts vertical scroll
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        // Wait for a clearer gesture before committing — deciding on the very
        // first pixels mis-locks an intended horizontal swipe to "vertical"
        // whenever the finger jitters down at the start.
        if (adx < 12 && ady < 12) return;

        if (adx > ady * 0.7) {
          t.decided = true;
          t.active = true;            // horizontal-ish (generous ~55° cone) → swipe
        } else if (ady > adx * 1.4) {
          t.decided = true;
          t.active = false;           // clearly vertical → native scroll
          return;
        } else {
          return;                     // still ambiguous → keep waiting, don't lock
        }

        // Pre-render adjacent article when swipe direction is decided
        if (contentWrapperRef.current) {
          const state = useFeedStore.getState();
          const idx = state.articles.findIndex(a => a.id === state.selectedArticle?.id);
          const goingNext = dx < 0;
          const adj = goingNext ? state.articles[idx + 1] : state.articles[idx - 1];
          const w = contentWrapperRef.current.clientWidth;

          if (adj) {
            const side = goingNext ? 1 : -1;
            const preview = document.createElement('div');
            preview.className = 'swipe-ghost';
            preview.style.cssText = `
              position:absolute;inset:0;
              transform:translateX(${side * w}px);
              background:var(--panel-bg);
              z-index:1;overflow-y:auto;pointer-events:none;
            `;
            const adjDate = formatArticleDate(adj.published);
            // Le fantôme montre EXACTEMENT ce que le rendu montrera : même
            // décision (`readingBodyKind`), même contenu (`displayedHtml`),
            // extrait compris s'il est déjà en mémoire — sinon le contenu du
            // flux, qui l'est toujours. Avant la 1.4.10, un flux à extraction
            // automatique donnait ici un squelette : on balayait d'un article
            // gris à l'autre alors que le texte était disponible.
            const adjAuto = !!useUiStore.getState().feedSettings[adj.sourceId]?.autoExtract;
            const adjExtract = peekExtract(adj.id)?.content ?? null;
            const adjKind = readingBodyKind({ rssHtml: adj.content, extractedHtml: adjExtract, autoExtract: adjAuto });
            const adjHtml = adjKind === 'skeleton' ? '' : displayedHtml(adj.content, adjExtract);
            // Durée de lecture du contenu réellement montré, comme dans le rendu.
            const wc = adjHtml.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
            const rt = readingMinutes(wc);
            // Tags — use same Tailwind classes as React render
            const tags = adj.tags || [];
            const tagsHtml = tags.length > 0
              ? '<div class="flex flex-wrap gap-1.5 mb-5">' +
                  tags.map(function(tag) {
                    return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium" style="background:var(--list-active);color:var(--reading-meta);border:1px solid var(--panel-border)">' + esc(tag) + '</span>';
                  }).join('') +
                '</div>'
              : '';
            // Use exact same Tailwind classes as the React-rendered article
            preview.innerHTML =
              '<div class="px-4 py-4">' +
                // ── Mobile header: same classes as React render ──
                '<div class="flex items-stretch gap-3 mb-3">' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="text-xs font-semibold uppercase tracking-wide truncate" style="color:var(--list-source)">' +
                      esc(adj.source) +
                    '</div>' +
                    '<div class="text-xs truncate mt-0.5" style="color:var(--reading-meta)">' +
                      (adj.author ? esc(adj.author) + ' &middot; ' : '') + adjDate +
                    '</div>' +
                  '</div>' +
                  (adjKind === 'skeleton' ? '' :
                    '<span class="flex items-center gap-1 px-2.5 rounded-lg text-[11px] font-medium flex-shrink-0" style="color:var(--accent);background:var(--accent-glow)">' +
                      '<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
                      rt + '&nbsp;min' +
                    '</span>') +
                '</div>' +
                // ── Title — same classes as React render ──
                '<h1 class="font-bold leading-tight mb-4" style="color:var(--reading-title);font-size:var(--fs-reading-title)">' +
                  esc(adj.title) +
                '</h1>' +
                // ── Tags ──
                tagsHtml +
                // ── Contenu — le même que celui que le rendu posera ──
                (adjKind === 'skeleton'
                  ? SKELETON_HTML
                  : '<div class="article-content leading-relaxed" style="color:var(--reading-text);font-size:var(--fs-reading-body)">' +
                      reserveImgAspect(sanitizeHtml(adjHtml)) +
                    '</div>') +
              '</div>';
            contentWrapperRef.current.appendChild(preview);
            t.preview = preview;
            t.previewSide = side;
            t.adj = adj; // navigate to THIS exact article on commit (avoids
                         // index drift between preview and the React render)
          }
        }
        // Fall through to e.preventDefault() below ↓
      }
      if (!t.active) return;

      e.preventDefault(); // Block vertical scroll during horizontal swipe
      swipeXRef.current = dx;

      // Move main container + preview via DOM (instant, no React)
      const w = contentWrapperRef.current?.clientWidth || window.innerWidth;
      const realEl = scrollContainerRef.current;
      if (realEl) {
        realEl.style.transition = 'none';
        realEl.style.transform = 'translateX(' + dx + 'px)';
      }
      if (t.preview) {
        t.preview.style.transition = 'none';
        t.preview.style.transform = 'translateX(' + ((t.previewSide ?? 0) * w + dx) + 'px)';
      }
    }

    function onTouchEnd() {
      const t = swipeTouchRef.current;
      swipeTouchRef.current = {};
      if (!t.active) return;

      const currentX = swipeXRef.current;
      const w = contentWrapperRef.current?.clientWidth || window.innerWidth;
      const threshold = w * 0.2;
      const realEl = scrollContainerRef.current;
      if (!realEl) return;

      const state = useFeedStore.getState();
      const idx = state.articles.findIndex(a => a.id === state.selectedArticle?.id);
      const hasNext = idx >= 0 && idx < state.articles.length - 1;
      const hasPrev = idx > 0;

      if ((currentX < -threshold && hasNext) || (currentX > threshold && hasPrev)) {
        const goingNext = currentX < -threshold;
        animatingRef.current = true;
        const dur = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';

        // Animate current article out, preview in — same timing = lockstep
        realEl.style.transition = dur;
        realEl.style.transform = 'translateX(' + (goingNext ? -w : w) + 'px)';
        if (t.preview) {
          t.preview.style.transition = dur;
          t.preview.style.transform = 'translateX(0)';
        }

        // After animation: swap React content, keep preview while images load
        setTimeout(() => {
          slideDirRef.current = goingNext ? 'left' : 'right';
          let seededFromCache = false;
          // Commit the new article SYNCHRONOUSLY so the real container shows it
          // before we reset the transform and fade the preview — otherwise the
          // preview fade briefly reveals the OLD article ("flash then reload").
          flushSync(() => {
            // Swap the extracted content IN THE SAME commit as the navigation.
            // If the incoming article is already cached, show it straight away
            // (instant, no preview hold); otherwise clear so we don't render the
            // OLD extracted body for a frame (wrong article / reading time).
            const cached = t.adj ? peekExtract(t.adj.id) : undefined;
            if (cached && t.adj) {
              lastExtractedId.current = t.adj.id;
              setExtractedContent(cached);
              seededFromCache = true;
            } else {
              setExtractedContent(null);
            }
            setExtractError(null);
            if (t.adj) useFeedStore.getState().selectArticle(t.adj);
            else if (goingNext) selectNextArticle(); else selectPrevArticle();
          });

          // Wait for React to render new article behind the preview
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const el2 = scrollContainerRef.current;
              if (el2) {
                el2.scrollTop = 0;
                el2.style.transition = 'none';
                el2.style.transform = '';
              }
              swipeXRef.current = 0;
              slideDirRef.current = null;
              // Release the gesture lock as soon as the new article is in
              // place — don't make the next swipe wait for images to load.
              animatingRef.current = false;

              // Fade the preview once the real article is settled.
              // `immediate` skips the image-load wait — used when the content is
              // already cached (the article was rendered before → reveal now).
              const startFade = (immediate = false) => {
                const done = () => {
                  if (t.preview) {
                    t.preview.style.transition = 'opacity 0.12s ease';
                    t.preview.style.opacity = '0';
                    setTimeout(() => cleanupPreview(t), 130);
                  }
                };
                // L'attente porte sur le CHARGEMENT des premières images, pas
                // sur leur décodage : attendre `decode()` retenait le fantôme
                // bien plus longtemps sur iPhone, et le glissement paraissait
                // bloqué.
                const imgs = el2 ? el2.querySelectorAll<HTMLImageElement>('.article-content img') : [];
                const visible = Array.from(imgs).slice(0, 3);
                if (immediate || visible.length === 0 || visible.every(i => i.complete)) {
                  done();
                } else {
                  let settled = false;
                  const finish = () => { if (!settled) { settled = true; done(); } };
                  visible.forEach(i => {
                    if (!i.complete) {
                      i.addEventListener('load', finish, { once: true });
                      i.addEventListener('error', finish, { once: true });
                    }
                  });
                  setTimeout(finish, 1500); // repli
                }
              };

              // Cached incoming article → reveal immediately (no image wait).
              if (seededFromCache) {
                requestAnimationFrame(() => requestAnimationFrame(() => startFade(true)));
                return;
              }

              // If the feed auto-extracts, keep the preview up until the full
              // content is in (or 1.5s), so we reveal the extracted article
              // directly instead of flashing the RSS body then reflowing.
              const newArt = useFeedStore.getState().selectedArticle;
              const fs = useUiStore.getState().feedSettings;
              const needsExtract = newArt && fs[newArt.sourceId]?.autoExtract
                && lastExtractedId.current !== newArt.id;
              if (needsExtract) {
                const t0 = Date.now();
                const poll = setInterval(() => {
                  if (lastExtractedId.current === newArt.id || Date.now() - t0 > 1500
                      || !t.preview || !t.preview.parentElement) {
                    clearInterval(poll);
                    requestAnimationFrame(() => requestAnimationFrame(() => startFade()));
                  }
                }, 60);
              } else {
                startFade();
              }
            });
          });
        }, 320);

      } else {
        // Spring back
        const dur = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)';
        realEl.style.transition = dur;
        realEl.style.transform = 'translateX(0)';

        if (t.preview) {
          t.preview.style.transition = dur;
          t.preview.style.transform = 'translateX(' + ((t.previewSide ?? 0) * w) + 'px)';
        }

        swipeXRef.current = 0;
        setTimeout(() => {
          realEl.style.transition = '';
          realEl.style.transform = '';
          cleanupPreview(t);
        }, 300);
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      const t = swipeTouchRef.current;
      cleanupPreview(t);
    };
  }, [isMobileOrTablet, selectNextArticle, selectPrevArticle]);

  const handleExtract = useCallback(async () => {
    if (!selectedArticle?.url || extracting) return;
    const id = selectedArticle.id;
    const stillCurrent = () => useFeedStore.getState().selectedArticle?.id === id;
    // 1) Memory hit → instant (e.g. swiping back, prefetched).
    const inMem = peekExtract(id);
    if (inMem) {
      lastExtractedId.current = id;
      setExtractError(null);
      setExtractedContent(inMem);
      revalidateIfStale(id, selectedArticle.url).catch(() => {}); // SWR refresh
      return;
    }
    setExtractError(null);
    // 2) Persistent store (IndexedDB) → near-instant, no network (survives
    //    reloads, works offline once cached).
    const fromDb = await getExtract(id);
    if (fromDb) {
      if (!stillCurrent()) return;
      lastExtractedId.current = id;
      setExtractedContent(fromDb);
      revalidateIfStale(id, selectedArticle.url).catch(() => {}); // SWR refresh
      return;
    }
    // 3) Live fetch + parse, then persist (memory + IndexedDB).
    setExtracting(true);
    try {
      // Dynamic import keeps Readability + DOMPurify out of the main bundle.
      const { extractFullContent } = await import('../../utils/extractContent');
      const result = await extractFullContent(selectedArticle.url);
      await putExtract(id, result);
      if (!stillCurrent()) return;
      lastExtractedId.current = id;
      setExtractedContent(result);
    } catch {
      if (stillCurrent()) setExtractError(t('readingPane.extractError'));
    } finally {
      setExtracting(false);
    }
  }, [selectedArticle, extracting, t]);

  // ── Corps de l'article ────────────────────────────────────────────────────
  // Mémoïsé, et il FAUT que ce soit avant le retour anticipé ci-dessous : les
  // hooks se comptent, pas se choisissent.
  //
  // Deux raisons, dont la seconde est un vrai défaut d'affichage :
  //
  //  1. la chaîne est lourde — DOMPurify analyse l'article entier — et elle
  //     tournait à chaque rendu, donc à chaque événement de défilement ;
  //  2. surtout, l'objet passé à `dangerouslySetInnerHTML` doit garder son
  //     IDENTITÉ. React 19 n'écarte une prop que si `nextProp === lastProp`,
  //     puis réaffecte `innerHTML` sans comparer `__html` : un littéral
  //     `{{ __html: … }}` dans le JSX reconstruisait donc tout le corps à
  //     chaque rendu, détruisant et recréant chaque <img> — le clignotement
  //     observé en PWA iOS pendant le défilement. Mémoïser la seule chaîne
  //     n'y suffirait pas : c'est l'objet qui doit survivre.
  const videoPlayLabel = t('readingPane.videoPlay');
  const videoOpenLabel = t('readingPane.videoOpen');
  const body = useMemo(
    () => buildArticleBody({
      rssHtml: selectedArticle?.content,
      extractedHtml: extractedContent?.content ?? null,
      inlineVideos,
      videoLabels: { play: videoPlayLabel, open: videoOpenLabel },
    }),
    [selectedArticle?.content, extractedContent?.content, inlineVideos, videoPlayLabel, videoOpenLabel],
  );
  const bodyProp = useMemo(() => ({ __html: body.html }), [body.html]);

  // Un article de flux YouTube EST la vidéo : on la montre en tête, sauf si le
  // corps porte déjà la même (l'injection ci-dessus l'a alors transformée en
  // façade).
  const headFacadeHtml = useMemo(() => {
    const ref = inlineVideos ? extractYouTubeId(selectedArticle?.url || '') : null;
    if (!ref || body.videoIds.includes(ref.id)) return '';
    return facadeMarkup(ref, youtubeThumbnail(ref.id), { play: videoPlayLabel, open: videoOpenLabel });
  }, [inlineVideos, selectedArticle?.url, body.videoIds, videoPlayLabel, videoOpenLabel]);
  const headFacadeProp = useMemo(() => ({ __html: headFacadeHtml }), [headFacadeHtml]);

  if (!selectedArticle) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--panel-bg)' }}>
        <div className="text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: 'var(--panel-border)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
          <p className="text-sm" style={{ color: 'var(--list-summary)' }}>
            {t('readingPane.noArticle')}
          </p>
        </div>
      </div>
    );
  }

  const article = selectedArticle;
  const date = formatArticleDate(article.published);

  function decreaseFont() {
    if (bodySize > 10) setFontSize('reading-body', String(bodySize - 1));
  }
  function increaseFont() {
    if (bodySize < 24) setFontSize('reading-body', String(bodySize + 1));
  }

  // Font control targets the mobile-specific size on touch, the (synced)
  // theme value on desktop — so adjusting on a phone never resizes desktop.
  const fontVal = isMobileOrTablet ? mobileReadingFontSize : bodySize;
  const fontMin = isMobileOrTablet ? 13 : 10;
  const fontMax = isMobileOrTablet ? 26 : 24;
  const decFont = () => (isMobileOrTablet ? setMobileReadingFontSize(mobileReadingFontSize - 1) : decreaseFont());
  const incFont = () => (isMobileOrTablet ? setMobileReadingFontSize(mobileReadingFontSize + 1) : increaseFont());

  // Ce que le volet montre : l'extraction si elle est là, sinon le contenu du
  // flux — qui est DÉJÀ en mémoire, arrivé avec la liste. Le squelette ne
  // couvre plus que le cas où il n'y a réellement rien (flux sans contenu, en
  // attente de l'extraction). Jusqu'à la 1.4.10, un flux à extraction
  // automatique affichait le squelette même quand du texte était disponible :
  // c'est ce qui donnait à l'application son air de charger sans arrêt.
  // La règle vit dans `src/lib/readingBody.ts`, testée à part.
  const feedAutoExtract = !!feedSettings[article?.sourceId]?.autoExtract;
  const bodyState = {
    rssHtml: article?.content,
    extractedHtml: extractedContent?.content ?? null,
    autoExtract: feedAutoExtract,
  };
  const showSkeleton = showsSkeleton(bodyState);

  // Durée de lecture du contenu AFFICHÉ. Elle grandit donc quand l'extraction
  // remplace le contenu du flux : le corps change sous les yeux du lecteur, la
  // pastille le suit. La cacher jusqu'à l'extraction n'avait de sens que tant
  // qu'il n'y avait rien à mesurer — désormais, seul le squelette la retient.
  const readingTime = readingMinutes(body.words);
  const showReadingTime = showsReadingTime(bodyState);

  // One listener for every facade (head + inline): swap in the real player.
  // The iframe is built through the DOM API, so the sanitizer never sees it.
  const handleVideoClick = (e: ReactMouseEvent<HTMLDivElement>) => {
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
    // `autoplay` must be delegated here: for a cross-origin iframe the feature
    // is off by default, so autoplay=1 in the URL alone leaves the player
    // paused and costs the user a second click. (iOS still blocks autoplay with
    // sound at OS level — nothing to do about that.)
    frame.allow = 'autoplay; accelerometer; encrypted-media; picture-in-picture; fullscreen';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    facade.replaceChildren(frame);
  };

  return (
    <div
      className="reading-pane h-full flex flex-col relative"
      style={{ background: 'var(--panel-bg)' }}
      onDoubleClick={(e) => { if (isFocusToggleTarget(e.target as Element)) toggleReadingFocus(); }}
    >
      {/* Mobile: no top toolbar — actions live in the bottom bar. Just a thin
          progress line at the very top. */}
      {isMobileOrTablet && readProgress > 0 && (
        <div
          className="reading-progress absolute top-0 left-0 z-10"
          style={{ width: `${readProgress}%` }}
        />
      )}

      {/* Sticky toolbar (desktop) */}
      {!isMobileOrTablet && (
      <div
        className="reading-toolbar flex-shrink-0 px-2 md:px-4 py-1.5 flex items-center gap-1 relative overflow-x-auto min-h-[45px]"
        style={{
          background: 'var(--panel-header-bg)',
          borderBottom: '1px solid var(--panel-border)',
        }}
      >
        {/* Back (2-panel mode) */}
        {showBack && (
          <button
            onClick={() => selectArticle(null)}
            className="p-1.5 rounded-lg transition-colors hover:bg-black/5 mr-1"
            style={{ color: 'var(--accent)' }}
            title={t('readingPane.back')}
            aria-label={t('readingPane.back')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}

        {/* Desktop: full inline action toolbar. Mobile: actions move to a
            bottom bar (see below) — keep only Back up here. */}
        {!isMobileOrTablet && (
          <>
        {/* Mark read / unread */}
        <ActionBtn
          icon={article.read ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V17.25z" />
            </svg>
          )}
          label={article.read ? t('readingPane.markUnread') : t('readingPane.markRead')}
          active={!article.read}
          activeColor="var(--accent)"
          onClick={() => toggleRead(article)}
        />

        {/* Star */}
        <ActionBtn
          icon={
            <svg
              className="w-4 h-4"
              fill={article.starred ? 'currentColor' : 'none'}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          }
          label={t('readingPane.star')}
          active={article.starred}
          activeColor="var(--star-color)"
          highlight
          onClick={() => toggleStar(article)}
          onFile={(a) => setFiling({ prefix: STARRED_PREFIX, ...a })}
        />

        {/* Read Later */}
        <ActionBtn
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          label={t('readingPane.readLater')}
          active={article.labels?.includes(READ_LATER_LABEL)}
          activeColor="var(--readlater-color)"
          highlight
          onClick={() => toggleReadLater(article)}
          onFile={(a) => setFiling({ prefix: READ_LATER_PREFIX, ...a })}
        />

        <ToolbarSeparator />

        {/* Labels */}
        <LabelMenu article={article} />

        <ToolbarSeparator />

        {/* Extract full content */}
        {article.url && (
          <button
            onClick={extractedContent ? () => { setExtractedContent(null); lastExtractedId.current = null; } : handleExtract}
            disabled={extracting}
            className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200"
            style={{
              color: extractedContent ? 'var(--accent)' : 'var(--reading-meta)',
              background: extractedContent ? 'var(--accent-glow)' : 'transparent',
              border: extractedContent ? '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)' : '1.5px solid transparent',
            }}
            title={extractedContent ? t('readingPane.showRss') : t('readingPane.fullContent')}
          >
            {extracting ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            )}
            <span>{extracting ? t('readingPane.extracting') : extractedContent ? t('readingPane.showRss') : t('readingPane.fullContent')}</span>
          </button>
        )}

        {/* Open original */}
        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200"
            style={{
              color: 'var(--reading-meta)',
              border: '1.5px solid transparent',
            }}
            title={t('readingPane.openOriginal') + ' (O)'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            <span>{t('readingPane.openOriginal')}</span>
          </a>
        )}

        {/* Partager / copier le lien */}
        {article.url && (
          <button
            onClick={() => shareArticle(article)}
            className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200"
            style={{ color: 'var(--reading-meta)', border: '1.5px solid transparent' }}
            title={canNativeShare ? t('readingPane.share') : t('readingPane.copyLink')}
            aria-label={canNativeShare ? t('readingPane.share') : t('readingPane.copyLink')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <span>{canNativeShare ? t('readingPane.share') : t('readingPane.copyLink')}</span>
          </button>
        )}

        {/* Spacer */}
        <div className="toolbar-spacer flex-1 min-w-0" />

        {/* Reading Focus toggle (hide sidebar + list) */}
        <button
          onClick={toggleReadingFocus}
          className="p-1.5 rounded-lg transition-colors hover:bg-black/5 flex-shrink-0"
          style={{ color: readingFocus ? 'var(--accent)' : 'var(--list-summary)' }}
          title={`${readingFocus ? t('readingPane.focusExit') : t('readingPane.focusEnter')} — ${t('readingPane.focusHint')}`}
          aria-pressed={readingFocus}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            {readingFocus ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15" />
            )}
          </svg>
        </button>

        {/* Font size — inline A-/A+ (desktop only) */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={decFont}
            className="p-1 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
            title={`${t('sidebar.reduceText')} (${fontVal}px)`}
            aria-label={`${t('sidebar.reduceText')} (${fontVal}px)`}
            disabled={fontVal <= fontMin}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
            </svg>
          </button>
          <span
            className="text-[10px] font-mono min-w-[28px] text-center"
            style={{ color: 'var(--list-summary)' }}
          >
            {fontVal}
          </span>
          <button
            onClick={incFont}
            className="p-1 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
            title={`${t('sidebar.enlargeText')} (${fontVal}px)`}
            aria-label={`${t('sidebar.enlargeText')} (${fontVal}px)`}
            disabled={fontVal >= fontMax}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
          </>
        )}

        {/* Reading progress bar — overlays bottom border */}
        {readProgress > 0 && (
          <div
            className="reading-progress absolute bottom-0 left-0"
            style={{ width: `${readProgress}%` }}
          />
        )}
      </div>
      )}

      {/* Article content wrapper — relative for ghost positioning.
          On mobile, locally override the reading-body font size so both the
          rendered article and the swipe-preview ghost use the mobile size. */}
      <div
        ref={contentWrapperRef}
        className="flex-1 relative overflow-hidden min-h-0"
        style={isMobileOrTablet ? ({ '--fs-reading-body': mobileReadingFontSize + 'px' } as CSSProperties) : undefined}
      >
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto nice-scroll"
          style={isMobileOrTablet ? { touchAction: 'pan-y', overscrollBehaviorX: 'none', paddingBottom: '52px' } : undefined}
        >
          <article
            ref={articleRef}
            className="article-enter px-4 py-4 md:px-8 md:py-6 lg:px-12 lg:py-8"
          >
          {/* Source / Author / Date / Reading time */}
          {isMobileOrTablet ? (
            /* ── Mobile: 2-line — left: source+meta, right: reading time ── */
            <div className="flex items-stretch gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div
                  className="text-xs font-semibold uppercase tracking-wide truncate"
                  style={{ color: 'var(--list-source)' }}
                >
                  {article.source}
                </div>
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--reading-meta)' }}>
                  {article.author ? `${article.author} · ` : ''}{date}
                </div>
              </div>
              {showReadingTime && (
                <span
                  className="flex items-center gap-1 px-2.5 rounded-lg text-[11px] font-medium flex-shrink-0"
                  style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t('readingPane.readingTime', { count: readingTime })}
                </span>
              )}
            </div>
          ) : (
            /* ── Desktop: single-line layout ── */
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--list-source)' }}
              >
                {article.source}
              </span>
              {article.author && (
                <>
                  <span style={{ color: 'var(--reading-meta)' }}>·</span>
                  <span className="text-xs" style={{ color: 'var(--reading-meta)' }}>
                    {article.author}
                  </span>
                </>
              )}
              <span style={{ color: 'var(--reading-meta)' }}>·</span>
              <span className="text-xs" style={{ color: 'var(--reading-meta)' }}>{date}</span>
              {showReadingTime && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{
                    color: 'var(--accent)',
                    background: 'var(--accent-glow)',
                  }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {readingTime} min
                </span>
              )}
            </div>
          )}

          {/* Title — links to the original article */}
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block mb-4 hover:underline"
              title={t('readingPane.openOriginal')}
            >
              <h1
                dir="auto"
                className="font-bold leading-tight article-title-target"
                data-theme="reading-title"
                style={{ color: 'var(--reading-title)', fontSize: 'var(--fs-reading-title)' }}
              >
                {article.title}
              </h1>
            </a>
          ) : (
            <h1
              dir="auto"
              className="font-bold leading-tight mb-4 article-title-target"
              data-theme="reading-title"
              style={{ color: 'var(--reading-title)', fontSize: 'var(--fs-reading-title)' }}
            >
              {article.title}
            </h1>
          )}

          {/* Tags & Labels */}
          {(() => {
            const feedTags = article.tags || [];
            const userLabels = (article.labels || []).filter(
              (l) => !categoryIds.includes(l) && l !== READ_LATER_LABEL
            );
            if (!feedTags.length && !userLabels.length) return null;
            return (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {/* User labels as pills with theme colors */}
                {userLabels.map((label) => {
                  const fullName = label.split('/label/').pop() ?? label;
                  const displayName = fullName.includes('/') ? fullName.split('/').pop() : fullName;
                  // The pill is filled with the label's own colour, which the
                  // user picks — so the ink has to be measured against it. A
                  // pale label (yellow, beige) used to write its own name in
                  // white on itself. No colour set = the accent, whose ink is
                  // already published as a variable.
                  const ownColor = getLabelColor(label);
                  const color = ownColor || 'var(--accent)';
                  const ink = ownColor ? readableTextOn(ownColor) : 'var(--on-accent)';
                  return (
                    <span
                      key={label}
                      data-label-id={label}
                      className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full text-[11px] font-semibold"
                      style={{
                        background: color,
                        color: ink,
                      }}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      </svg>
                      {displayName}
                    </span>
                  );
                })}
                {/* Feed tags — subtle style */}
                {feedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{
                      background: 'var(--list-active)',
                      color: 'var(--reading-meta)',
                      border: '1px solid var(--panel-border)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Extraction error */}
          {extractError && (
            <div
              className="mb-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2"
              style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {extractError}
            </div>
          )}

          {/* Extraction notice — only for a MANUAL extraction on desktop. With
              auto-extract it pops in after the article (jarring), and on mobile
              it shifts the layout mid-swipe — so it's suppressed in both cases. */}
          {extractedContent && !feedAutoExtract && !isMobileOrTablet && (
            <div
              className="mb-4 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              {t('readingPane.fullContent')}
            </div>
          )}

          {/* Corps — le contenu disponible tout de suite ; squelette seulement
              s'il n'y a rien à montrer (voir `lib/readingBody.ts`) */}
          {/* Video first for a YouTube-feed article — the video IS the article */}
          {headFacadeHtml && (
            <div
              className="article-content"
              onClick={handleVideoClick}
              dangerouslySetInnerHTML={headFacadeProp}
            />
          )}

          {showSkeleton ? (
            <div dangerouslySetInnerHTML={SKELETON_PROP} />
          ) : (
            <div
              dir="auto"
              /* `reading-body-enter` ne joue qu'au MONTAGE de cet élément.
                 Changer d'article réutilise le même nœud, et la bascule
                 flux → extraction aussi : une seule réécriture d'`innerHTML`,
                 sans animation. Elle recrée bien les <img>, mais l'image
                 d'en-tête garde la MÊME URL (`displayedHtml` réinjecte celle du
                 flux si l'extraction l'a perdue), donc le cache la ressert.
                 Le seul montage réel qui reste est la sortie du squelette,
                 pour les articles dont le flux ne livre rien. */
              className="article-content leading-relaxed reading-body-enter"
              data-theme="reading-text"
              style={{ color: 'var(--reading-text)', fontSize: 'var(--fs-reading-body)' }}
              onClick={handleVideoClick}
              dangerouslySetInnerHTML={bodyProp}
            />
          )}
        </article>
        </div>
      </div>

      {/* ── Mobile: bottom action bar (thumb-reachable) + ⋯ menu ── */}
      {isMobileOrTablet && (
        <div
          className="reading-bottombar absolute bottom-0 inset-x-0 z-10 flex items-stretch"
          style={{
            background: 'var(--panel-header-bg)',
            borderTop: '1px solid var(--panel-border)',
          }}
        >
          {showBack && (
            <button
              onClick={() => selectArticle(null)}
              title={t('readingPane.back')}
              aria-label={t('readingPane.back')}
              className="flex-shrink-0 flex items-center justify-center pl-3 pr-1.5 py-2 active:bg-black/5"
              style={{ color: 'var(--accent)' }}
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent-glow)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </span>
            </button>
          )}

          <LabelMenu article={article} variant="bar" />

          <BarBtn active={article.starred} activeColor="var(--star-color)" label={t('readingPane.star')}
            onClick={() => toggleStar(article)}>
            <svg className="w-5 h-5" fill={article.starred ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </BarBtn>

          <BarBtn active={article.labels?.includes(READ_LATER_LABEL)} activeColor="var(--readlater-color)" label={t('readingPane.readLater')}
            onClick={() => toggleReadLater(article)}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </BarBtn>

          {article.url && (
            <BarBtn active={!!extractedContent} activeColor="var(--accent)" label={t('readingPane.fullContent')}
              onClick={extractedContent ? () => { setExtractedContent(null); lastExtractedId.current = null; } : handleExtract}>
              {extracting ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              )}
            </BarBtn>
          )}

          <BarBtn active={readSettingsOpen} activeColor="var(--accent)" label={t('readingPane.more')}
            onClick={() => setReadSettingsOpen((o) => !o)}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            </svg>
          </BarBtn>

          <BottomSheet
            open={readSettingsOpen}
            onClose={() => setReadSettingsOpen(false)}
            title={t('readingPane.more')}
          >
            {article.url && (
              <a
                href={article.url} target="_blank" rel="noopener noreferrer"
                onClick={() => setReadSettingsOpen(false)}
                className="sheet-row flex items-center gap-3 px-4 py-3"
                style={{ color: 'var(--reading-text)' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                <span className="font-medium">{t('readingPane.openOriginal')}</span>
              </a>
            )}
            {article.url && (
              <button
                onClick={() => { setReadSettingsOpen(false); shareArticle(article); }}
                className="sheet-row w-full flex items-center gap-3 px-4 py-3 text-left"
                style={{ color: 'var(--reading-text)', borderTop: '1px solid var(--panel-border)' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                <span className="font-medium">{canNativeShare ? t('readingPane.share') : t('readingPane.copyLink')}</span>
              </button>
            )}
            <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--panel-border)' }}>
              <span className="font-medium" style={{ color: 'var(--reading-text)' }}>{t('readingPane.textSize')}</span>
              <div className="flex items-center gap-2">
                <button onClick={decFont} disabled={fontVal <= fontMin}
                  aria-label={t('sidebar.reduceText')}
                  className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-black/5 disabled:opacity-30"
                  style={{ color: 'var(--reading-text)', border: '1px solid var(--panel-border)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" /></svg>
                </button>
                <span className="font-mono text-sm min-w-[40px] text-center" style={{ color: 'var(--reading-text)' }}>{fontVal}px</span>
                <button onClick={incFont} disabled={fontVal >= fontMax}
                  aria-label={t('sidebar.enlargeText')}
                  className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-black/5 disabled:opacity-30"
                  style={{ color: 'var(--reading-text)', border: '1px solid var(--panel-border)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                </button>
              </div>
            </div>
          </BottomSheet>
        </div>
      )}

      {/* Category picker — portalled, so the toolbar never clips it */}
      {filing && (
        <SavedCategoryPicker
          prefix={filing.prefix}
          article={article}
          anchor={{ x: filing.x, y: filing.y }}
          onClose={() => setFiling(null)}
        />
      )}
    </div>
  );
}

interface BarBtnProps {
  children: ReactNode;
  label: string;
  active?: boolean;
  activeColor: string;
  onClick: () => void;
}

function BarBtn({ children, label, active, activeColor, onClick }: BarBtnProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex-1 flex items-center justify-center py-2 transition-colors active:bg-black/5"
      style={{ color: active ? activeColor : 'var(--reading-meta)' }}
    >
      {children}
    </button>
  );
}

interface ActionBtnProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  activeColor: string;
  highlight?: boolean;
  onClick: () => void;
  /** Long press / right-click opens the category picker for this prefix. */
  onFile?: (anchor: { x: number; y: number }) => void;
}

function ActionBtn({ icon, label, active, activeColor, highlight, onClick, onFile }: ActionBtnProps) {
  const { t } = useTranslation();
  // Same gesture as in the list: hold (finger or mouse) to file it away.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const anchorOf = () => {
    const r = btnRef.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.bottom } : { x: 0, y: 0 };
  };
  const startHold = () => {
    if (!onFile) return;
    held.current = false;
    holdTimer.current = setTimeout(() => { held.current = true; onFile(anchorOf()); }, 500);
  };
  const cancelHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const holdProps = onFile
    ? {
        onTouchStart: startHold, onTouchEnd: cancelHold, onTouchMove: cancelHold,
        onMouseDown: startHold, onMouseUp: cancelHold, onMouseLeave: cancelHold,
        onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); onFile(anchorOf()); },
      }
    : {};
  const handleClick = () => { if (held.current) { held.current = false; return; } onClick(); };
  // `highlight` buttons (favourite / read-later) carry their identity color:
  //  - inactive → outline pill (colored text + thin colored border) = "off"
  //  - active   → SOLID filled pill with dark text = unmistakably "on"
  // Regular buttons keep a subtle tint when active.
  let style: CSSProperties;
  if (highlight) {
    style = active
      ? {
          color: activeColor,
          background: `color-mix(in srgb, ${activeColor} 18%, transparent)`,
          border: `1.5px solid color-mix(in srgb, ${activeColor} 70%, transparent)`,
          fontWeight: 700,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${activeColor} 14%, transparent)`,
        }
      : {
          color: activeColor,
          background: 'transparent',
          border: `1.5px solid color-mix(in srgb, ${activeColor} 32%, transparent)`,
        };
  } else {
    style = {
      color: active ? activeColor : 'var(--reading-meta)',
      background: active ? `color-mix(in srgb, ${activeColor} 12%, transparent)` : 'transparent',
      border: active ? `1.5px solid color-mix(in srgb, ${activeColor} 30%, transparent)` : '1.5px solid transparent',
    };
  }
  return (
    <button
      ref={btnRef}
      {...holdProps}
      onClick={handleClick}
      className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200"
      style={style}
      title={onFile ? `${label} — ${t('saved.holdHint')}` : label}
      /* The span below is hidden by CSS on the mobile layout, which leaves the
         button nameless there. `label` — not the title — so the accessible
         name still matches the visible text where the span is shown. */
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToolbarSeparator() {
  return (
    <div
      className="toolbar-sep w-px h-4 mx-0.5 flex-shrink-0"
      style={{ background: 'var(--panel-border)' }}
    />
  );
}

interface LabelMenuProps {
  article: Article;
  variant?: string;
}

function LabelMenu({ article, variant }: LabelMenuProps) {
  const { t } = useTranslation();
  const { labels, loadLabels, toggleArticleLabel, categoryIds } = useFeedStore();
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint !== 'desktop';

  useEffect(() => {
    if (open && labels.length === 0) loadLabels();
  }, [open, labels.length, loadLabels]);

  // Close on outside click — desktop only. The dropdown lives in a portal
  // (outside menuRef), so we must also treat clicks inside it as "inside".
  useEffect(() => {
    if (!open || isMobile) return;
    function handleClick(e: MouseEvent) {
      const node = e.target as Node;
      if (menuRef.current?.contains(node) || dropdownRef.current?.contains(node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, isMobile]);

  // Lock body scroll when mobile sheet is open
  useEffect(() => {
    if (open && isMobile) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open, isMobile]);

  // Exclude feed categories and Read Later from article labels
  const articleLabels = (article.labels || []).filter(
    (l) => !categoryIds.includes(l) && l !== READ_LATER_LABEL
  );

  async function handleAddNew(e: FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    const labelId = `user/-/label/${newLabel.trim()}`;
    await toggleArticleLabel(article, labelId);
    setNewLabel('');
  }

  const hasLabels = articleLabels.length > 0;
  const triggerButton = variant === 'bar' ? (
    /* Bottom-bar variant: icon-only, fills its slot (matches BarBtn) */
    <button
      onClick={() => setOpen(!open)}
      title={t('readingPane.labels')}
      aria-label={t('readingPane.labels')}
      className="flex-1 flex items-center justify-center py-2 transition-colors active:bg-black/5"
      style={{ color: hasLabels ? 'var(--accent)' : 'var(--reading-meta)' }}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
      </svg>
    </button>
  ) : (
    <button
      onClick={() => setOpen(!open)}
      className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200"
      style={{
        color: hasLabels ? 'var(--accent)' : 'var(--reading-meta)',
        background: hasLabels ? 'var(--accent-glow)' : 'transparent',
        border: hasLabels ? '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)' : '1.5px solid transparent',
      }}
      title={t('readingPane.labels')}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
      </svg>
      <span>{t('readingPane.labels')}{hasLabels ? ` (${articleLabels.length})` : ''}</span>
    </button>
  );

  // Shared label list rendering
  const labelSize = isMobile ? 'px-4 py-3 text-sm' : 'px-3 py-1.5 text-xs';
  const checkSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';
  const checkIcon = isMobile ? 'w-3.5 h-3.5' : 'w-3 h-3';

  function renderLabelList() {
    return (
      <>
        <div className={`overflow-y-auto py-1 ${isMobile ? 'max-h-[50vh]' : 'max-h-48'}`}>
          {labels.length === 0 && articleLabels.length === 0 && (
            <p className={`px-3 py-2 ${isMobile ? 'text-sm' : 'text-xs'}`} style={{ color: 'var(--list-summary)' }}>
              {t('preferences.labels.noLabels')}
            </p>
          )}
          {labels.map((tag) => {
            const isActive = articleLabels.includes(tag.id);
            const name = tag.id.split('/label/').pop();
            return (
              <button
                key={tag.id}
                onClick={() => toggleArticleLabel(article, tag.id)}
                className={`w-full flex items-center gap-2 ${labelSize} transition-colors hover:bg-black/5`}
                style={{ color: 'var(--list-title)' }}
              >
                <span
                  className={`${checkSize} rounded flex items-center justify-center flex-shrink-0`}
                  style={{
                    border: isActive ? 'none' : '1.5px solid var(--panel-border)',
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: '#fff',
                  }}
                >
                  {isActive && (
                    <svg className={checkIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{name}</span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={handleAddNew}
          className={`${isMobile ? 'px-4 py-3' : 'px-3 py-2'} flex gap-1.5`}
          style={{ borderTop: '1px solid var(--panel-border)' }}
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('readingPane.newLabel')}
            className={`flex-1 ${isMobile ? 'text-sm px-3 py-2' : 'text-xs px-2 py-1'} rounded border outline-none`}
            style={{
              borderColor: 'var(--panel-border)',
              color: 'var(--list-title)',
              background: 'var(--panel-bg)',
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
          />
          <button
            type="submit"
            disabled={!newLabel.trim()}
            className={`${isMobile ? 'p-2' : 'p-1'} rounded transition-colors disabled:opacity-30`}
            style={{ color: 'var(--accent)' }}
          >
            <svg className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </form>
      </>
    );
  }

  // ── Mobile: bottom sheet ─────────────────────────────────────────
  // La feuille était posée à la main ici ; elle vit maintenant dans
  // `BottomSheet`, partagée avec les deux menus d'options du format mobile.
  if (isMobile) {
    return (
      <>
        {triggerButton}
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={t('readingPane.labels')}
        >
          {renderLabelList()}
        </BottomSheet>
      </>
    );
  }

  // ── Desktop: dropdown rendered in a portal, positioned under the trigger.
  //    (The reading toolbar uses overflow-x:auto, which would otherwise clip
  //    an absolutely-positioned dropdown — it'd "scroll inside the toolbar".)
  const anchor = menuRef.current?.getBoundingClientRect();
  return (
    <div className="relative" ref={menuRef}>
      {triggerButton}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-56 rounded-xl shadow-xl z-[200] overflow-hidden"
          style={{
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            top: anchor ? anchor.bottom + 4 : undefined,
            left: anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - 232)) : undefined,
          }}
        >
          {renderLabelList()}
        </div>,
        document.body
      )}
    </div>
  );
}
