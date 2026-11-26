import { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import FeedsTab from './FeedsTab';
import AdminTab from './AdminTab';
import OfflineTab from './OfflineTab';
import LabelsTab from './LabelsTab';
import ReadingTab from './ReadingTab';
import KeyboardTab from './KeyboardTab';
import AccountTab from './AccountTab';
import AppearanceTab from './AppearanceTab';
import LayoutTab from './LayoutTab';
import AiTab from './AiTab';
import { useAiStore, aiEnabled } from '../../stores/aiStore';
import { COLOR_HIGHLIGHT_MAP } from './colorHighlight';
import ConfirmDialog from '../ConfirmDialog';
import { useReturnFocus } from '../../hooks/useReturnFocus';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface HighlightRect { top: number; left: number; width: number; height: number }

type SectionId = 'reading' | 'appearance' | 'layout' | 'keyboard' | 'feeds' | 'labels' | 'offline' | 'ai' | 'account' | 'admin';

/** « Général » a été scindé en Lecture, Clavier et Compte : un ancien lien y mène encore. */
const LEGACY_SECTIONS: Record<string, SectionId> = { general: 'reading' };
const ALL_SECTIONS: readonly SectionId[] = ['reading', 'appearance', 'layout', 'keyboard', 'feeds', 'labels', 'offline', 'ai', 'account', 'admin'];

function sectionOf(tab: string | null | undefined): SectionId {
  if (!tab) return 'reading';
  if (LEGACY_SECTIONS[tab]) return LEGACY_SECTIONS[tab];
  return (ALL_SECTIONS as readonly string[]).includes(tab) ? (tab as SectionId) : 'reading';
}

/** Icônes de la navigation : même famille (contour 1,6) que le reste de l'interface. */
const SECTION_ICONS: Record<SectionId, string> = {
  reading: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  appearance: 'M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z',
  layout: 'M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z',
  keyboard: 'M3.75 6.75h16.5a1.5 1.5 0 011.5 1.5v7.5a1.5 1.5 0 01-1.5 1.5H3.75a1.5 1.5 0 01-1.5-1.5v-7.5a1.5 1.5 0 011.5-1.5zM6.75 10.5h.008M9.75 10.5h.008M12.75 10.5h.008M15.75 10.5h.008M17.25 10.5h.008M8.25 14.25h7.5',
  feeds: 'M12.75 19.5v-.75a7.5 7.5 0 00-7.5-7.5H4.5m0-6.75h.75c7.87 0 14.25 6.38 14.25 14.25v.75M6 18.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0z',
  labels: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z',
  offline: 'M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z',
  ai: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z',
  account: 'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z',
  admin: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
};

/** Une sous-partie de la section ouverte, telle que la page la rend. */
interface SubSection { el: HTMLElement; label: string }

/** Distance sous le haut de la zone de contenu à laquelle un titre devient « en cours ». */
const SPY_OFFSET = 96;

const NO_SUBS: SubSection[] = [];
/** Sections d'un seul tenant : sur téléphone, elles s'ouvrent au lieu de se déplier. */
const SECTIONS_WITHOUT_SUBS: readonly SectionId[] = ['labels'];

function sameSubs(a: SubSection[], b: SubSection[]) {
  return a.length === b.length && a.every((s, i) => s.el === b[i].el && s.label === b[i].label);
}

/**
 * Où un bandeau de sous-partie se trouve dans la page, pas où il est collé.
 * Un bandeau déjà dépassé reste collé en haut : sa position mesurée disait
 * « déjà en haut », et un clic sur une sous-partie située plus haut ne
 * faisait pas défiler. Il est mesuré une fraction d'instant sans `sticky`,
 * sans rendu intermédiaire.
 */
function bandOf(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>('.prefs-h3-row') ?? el;
}
function flowTop(band: HTMLElement): number {
  const prev = band.style.position;
  band.style.position = 'static';
  const top = band.getBoundingClientRect().top;
  band.style.position = prev;
  return top;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export default function Preferences() {
  // Montées seulement ouvertes : le focus revient au bouton qui les a ouvertes.
  useReturnFocus(true);
  const {
    theme,
    savedThemes,
    closePreferences,
    loadSavedTheme,
    resetToDefault,
    resetLabelColors,
    preferencesTab,
  } = useThemeStore();
  const preferencesOpenId = useThemeStore((s) => s.preferencesOpenId);

  const isMobile = useBreakpoint() === 'mobile';
  const [tab, setTab] = useState<SectionId>(sectionOf(preferencesTab));
  const [showNav, setShowNav] = useState(!preferencesTab);
  // Les sections dépliées dans la navigation. Une section dépliée le reste
  // jusqu'à un clic sur elle, sauf si le réglage « Replier les autres
  // sections » est actif : ouvrir une section replie alors les autres.
  const autoCollapse = useUiStore((s) => s.prefsNavAutoCollapse);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set([sectionOf(preferencesTab)]));
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  // Une section n'est montée qu'à sa première visite, puis le reste. Le montage
  // conditionnel d'origine la détruisait à chaque changement de section : Flux
  // et Administration, les deux seules à appeler le réseau au montage,
  // repayaient un aller-retour complet à chaque retour, écran vide.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([sectionOf(preferencesTab)]));
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true);
  // Unique per mount so two Preferences instances (shouldn't normally
  // happen, but tests/HMR can) never share — and shadow each other's —
  // <mask id>.
  const spotlightMaskId = `prefs-spotlight-${useId()}`;

  // Reset tab (and the mobile drill-down) every time preferences are opened
  // (preferencesOpenId changes each open)
  useEffect(() => {
    setTab(sectionOf(preferencesTab));
    setShowNav(!preferencesTab);
    setOpenSections(new Set([sectionOf(preferencesTab)]));
  }, [preferencesTab, preferencesOpenId]);

  useEffect(() => {
    setVisited((cur) => (cur.has(tab) ? cur : new Set(cur).add(tab)));
  }, [tab]);

  // A11y: move focus into the dialog when it opens (keyboard / screen readers)
  useEffect(() => {
    modalRef.current?.focus();
  }, [preferencesOpenId]);
  const [confirmReset, setConfirmReset] = useState(false);

  // Compute highlight overlay rects when highlightKey changes
  // Limits to MAX_HIGHLIGHTS visible elements to avoid visual clutter
  useEffect(() => {
    if (!highlightKey) { setHighlightRects([]); return; }
    const selector = COLOR_HIGHLIGHT_MAP[highlightKey];
    if (!selector) { setHighlightRects([]); return; }
    const els = document.querySelectorAll(selector);
    const MAX_HIGHLIGHTS = 6;
    const rects: HighlightRect[] = [];
    els.forEach((el) => {
      if (rects.length >= MAX_HIGHLIGHTS) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    });
    setHighlightRects(rects);
  }, [highlightKey]);

  const { t } = useTranslation();

  // Par la boîte de confirmation : le bouton devenait « Confirmer ? » à la
  // même place pendant 3 s, et un double-clic validait (le piège de l'issue
  // #17). `resetToDefault` ne rétablit que le thème en cours — couleurs et
  // tailles — tel qu'il a été chargé ou enregistré : rien d'autre.
  function confirmResetTheme() {
    resetToDefault();
    setConfirmReset(false);
  }

  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  const aiOn = useAiStore(aiEnabled);
  const showAi = aiOn || isAdmin;
  const sections = ALL_SECTIONS
    .filter((id) => (id === 'ai' ? showAi : id === 'admin' ? isAdmin : true))
    .map((id) => ({ id, label: t(`preferences.sections.${id}`) }));

  // ── Navigation dépliable ─────────────────────────────────────────────
  // Les sous-titres d'une section sont LUS dans sa page (les `h3` marqués
  // `data-pref-sub`), pas recopiés dans une liste à tenir à jour : un bloc
  // absent (mot de passe d'un compte SSO, fournisseurs IA hors admin)
  // n'apparaît pas, un bloc ajouté apparaît seul. Seule une section déjà
  // visitée a une page montée, donc des sous-titres : c'est aussi la seule
  // qu'on peut avoir dépliée, puisque la déplier l'ouvre.
  const scrollRef = useRef<HTMLDivElement>(null);
  const navListRef = useRef<HTMLUListElement>(null);
  const subListId = useId();
  const [subsBySection, setSubsBySection] = useState<Partial<Record<SectionId, SubSection[]>>>({});
  const subs = subsBySection[tab] ?? NO_SUBS;
  const [currentSub, setCurrentSub] = useState(0);
  // Pendant un défilement lancé par un clic, le suivi du défilement se tait :
  // la dernière sous-partie, trop courte pour monter en haut, volerait sinon
  // la sélection à celle qu'on vient de choisir.
  const programmatic = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null });
  // Un sous-titre d'une autre section : on change de section, puis on y va.
  const pendingSub = useRef<{ el: HTMLElement; i: number } | null>(null);
  // La sous-partie choisie dans la navigation, teintée dans la page : sur un
  // grand écran, la page ne défile pas et rien d'autre ne dirait où elle est.
  // La teinte s'en va dès qu'on fait défiler jusqu'à une autre sous-partie.
  const [marked, setMarked] = useState<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const next: Partial<Record<SectionId, SubSection[]>> = {};
      root.querySelectorAll<HTMLElement>('[data-pane]').forEach((pane) => {
        next[pane.dataset.pane as SectionId] = Array.from(pane.querySelectorAll<HTMLElement>('[data-pref-sub]')).map((el) => ({
          el,
          // Le titre seul : ni l'étiquette « Sur ordinateur » ni un compteur.
          label: el.dataset.prefLabel || (el.querySelector('[data-pref-title]') ?? el).textContent?.trim() || '',
        }));
      });
      setSubsBySection((cur) => {
        const ids = new Set([...Object.keys(cur), ...Object.keys(next)]) as Set<SectionId>;
        for (const id of ids) if (!sameSubs(cur[id] ?? NO_SUBS, next[id] ?? NO_SUBS)) return next;
        return cur;
      });
    };
    read();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(read); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [visited]);

  // Changer de section repart du haut de sa page, ou du sous-titre choisi.
  useLayoutEffect(() => {
    const pending = pendingSub.current;
    pendingSub.current = null;
    if (pending) { scrollToSub(pending.el, pending.i, false); return; }
    // Retour à la liste sur téléphone : elle garde la sous-partie où l'on était.
    if (isMobile && showNav) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setCurrentSub(0);
    setMarked(null);
  }, [tab, showNav, isMobile]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || subs.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = sc.getBoundingClientRect().top;
      let idx = 0;
      subs.forEach((sub, i) => { if (sub.el.getBoundingClientRect().top - top <= SPY_OFFSET) idx = i; });
      // Tout en bas, les dernières sous-parties ne peuvent plus monter : on
      // prend la dernière dont le titre est à l'écran.
      if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) {
        const bottom = sc.getBoundingClientRect().bottom;
        subs.forEach((sub, i) => { if (sub.el.getBoundingClientRect().top < bottom) idx = Math.max(idx, i); });
      }
      setCurrentSub(idx);
      setMarked((m) => (m && subs[idx]?.el !== m ? null : m));
    };
    const onScroll = () => {
      const p = programmatic.current;
      if (p.timer) {
        clearTimeout(p.timer);
        p.timer = setTimeout(() => { p.timer = null; }, 140);
        return;
      }
      if (!raf) raf = requestAnimationFrame(update);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => { sc.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [subs]);

  useEffect(() => () => { if (programmatic.current.timer) clearTimeout(programmatic.current.timer); }, []);

  function openSection(id: SectionId) {
    if (isMobile) {
      // Sur téléphone, la liste est un écran à part : toucher une section
      // déplie ses sous-titres, toucher un sous-titre ouvre la page à cet
      // endroit. Une section sans sous-titre s'ouvre tout de suite. La page
      // est montée (cachée) pour que ses sous-titres puissent être lus.
      const known = subsBySection[id];
      if (SECTIONS_WITHOUT_SUBS.includes(id) || (known && known.length === 0)) {
        setTab(id);
        setShowNav(false);
        return;
      }
      setVisited((cur) => (cur.has(id) ? cur : new Set(cur).add(id)));
      setOpenSections((cur) => {
        if (cur.has(id)) { const next = new Set(cur); next.delete(id); return next; }
        return autoCollapse ? new Set([id]) : new Set(cur).add(id);
      });
      return;
    }
    if (id === tab) {
      setOpenSections((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      return;
    }
    setTab(id);
    setOpenSections((cur) => (autoCollapse ? new Set([id]) : new Set(cur).add(id)));
  }

  function goToSub(section: SectionId, i: number) {
    const el = subsBySection[section]?.[i]?.el;
    if (!el) return;
    if (section !== tab || (isMobile && showNav)) {
      pendingSub.current = { el, i };
      setTab(section);
      if (isMobile) setShowNav(false);
      if (autoCollapse) setOpenSections(new Set([section]));
      return;
    }
    scrollToSub(el, i, true);
  }

  function scrollToSub(el: HTMLElement, i: number, smooth: boolean) {
    const sc = scrollRef.current;
    if (!sc) return;
    // Le bandeau du sous-titre colle en haut (sous la barre « Retour » sur
    // téléphone) : on l'amène pile à cette place. Le `top` calculé du bandeau
    // est en pixels ; la variable `--prefs-sticky-top`, elle, se lit telle
    // qu'écrite (« 3rem » donnait 3 px : 45 px de trop sur téléphone).
    const band = bandOf(el);
    const stickyTop = parseFloat(getComputedStyle(band).top) || 0;
    const top = flowTop(band) - sc.getBoundingClientRect().top + sc.scrollTop - stickyTop;
    const p = programmatic.current;
    if (p.timer) clearTimeout(p.timer);
    // Filet de sécurité : déjà à la bonne place, aucun défilement n'arrive.
    p.timer = setTimeout(() => { p.timer = null; }, 900);
    sc.scrollTo?.({ top: Math.max(0, top), behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
    setCurrentSub(i);
    setMarked(el);
    // Le focus suit : un lecteur d'écran annonce le titre, Tab continue dans la sous-partie.
    el.focus({ preventScroll: true });
  }

  // L'indicateur de la section active, mesuré dans la liste.
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  const [pillReady, setPillReady] = useState(false);
  const measurePill = useCallback(() => {
    const btn = navListRef.current?.querySelector<HTMLElement>(`[data-section="${tab}"]`);
    setPill((cur) => {
      if (!btn) return null;
      const next = { y: btn.offsetTop, h: btn.offsetHeight };
      return cur && cur.y === next.y && cur.h === next.h ? cur : next;
    });
  }, [tab]);
  useLayoutEffect(() => { measurePill(); }, [measurePill, isMobile, sections.length]);
  // Pas de glissement à l'ouverture : la pastille apparaît en place, puis glisse.
  useEffect(() => {
    if (!pill || pillReady) return;
    const raf = requestAnimationFrame(() => setPillReady(true));
    return () => cancelAnimationFrame(raf);
  }, [pill, pillReady]);
  useEffect(() => {
    const list = navListRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measurePill());
    ro.observe(list);
    return () => ro.disconnect();
  }, [measurePill]);

  // Échap est écouté sur le panneau (`onKeyDown` plus bas), donc seulement
  // quand le focus y est. Un bouton qui se désactive pendant son travail
  // (« Tester », « Enregistrer ») le fait retomber sur <body> : Échap ne
  // fermait plus rien. Ici, seulement dans ce cas — un menu ou une boîte qui
  // a le focus garde la main sur sa touche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      // La palette (⌘K) s'ouvre par-dessus : la touche est à elle. Cet
      // écouteur, posé le premier, fermait les Préférences dessous.
      if (useUiStore.getState().commandPaletteOpen) return;
      // Traité : le tiroir mobile, ouvert derrière, ne se ferme pas aussi.
      e.preventDefault();
      closePreferences();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closePreferences]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end"
      onClick={(e) => {
        // Click on the backdrop itself → close. Not « any target outside the
        // panel »: React events bubble through portals, so a click inside a
        // menu / sheet / confirmation rendered under <body> by a section
        // would reach this handler with a target outside the panel's DOM.
        if (e.target === e.currentTarget) closePreferences();
      }}
      onKeyDown={(e) => {
        // Escape closes the dialog. Shortcut-capture stops propagation, so it
        // won't reach here while a shortcut is being recorded.
        // Marqué traité : le tiroir mobile, ouvert derrière, se fermait aussi.
        // Une touche DÉJÀ traitée appartient à ce qui l'a traitée : le
        // sélecteur de couleur d'une étiquette la prenait, puis les
        // Préférences se fermaient aussi (L-19).
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closePreferences(); }
      }}
    >
      {/* Dim overlay — a spotlight: darkens everything except the panel
          (which sits above it via z-index) and the highlighted rects (cut
          out of the dim via an SVG mask). A CSS `mask`/`mask-composite`
          version of this looked right in Chromium but Safari — including
          the iOS PWA this app runs as — didn't apply the composite, so the
          whole screen stayed dark. An inline SVG mask is the one approach
          that behaves the same everywhere. */}
      {highlightRects.length > 0 && (
        <svg className="fixed inset-0 pointer-events-none z-[48]" width="100%" height="100%" aria-hidden="true">
          <defs>
            <mask id={spotlightMaskId}>
              <rect width="100%" height="100%" fill="white" />
              {highlightRects.map((r, i) => (
                <rect
                  key={i}
                  x={r.left - 4}
                  y={r.top - 4}
                  width={r.width + 8}
                  height={r.height + 8}
                  rx="8"
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.15)" mask={`url(#${spotlightMaskId})`} />
        </svg>
      )}
      {/* Highlight overlays for color keys */}
      {highlightRects.map((r, i) => (
        <div
          key={i}
          className="fixed pointer-events-none z-[49]"
          style={{
            top: r.top - 4,
            left: r.left - 4,
            width: r.width + 8,
            height: r.height + 8,
            borderRadius: 8,
            border: '2.5px dashed #3b82f6',
            background: 'rgba(59, 130, 246, 0.06)',
            animation: 'highlight-glow 1.8s ease-in-out infinite',
          }}
        >
          {/* Label badge */}
          {highlightKey && i === 0 && (
            <span
              className="absolute text-[11px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap"
              style={{
                top: -14,
                left: 8,
                background: '#3b82f6',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
                letterSpacing: '0.02em',
              }}
            >
              {highlightKey}
            </span>
          )}
        </div>
      ))}

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('preferences.title')}
        tabIndex={-1}
        className="relative z-[51] h-full shadow-2xl flex flex-col overflow-hidden outline-none"
        style={{
          background: 'var(--panel-bg)',
          borderLeft: '1px solid var(--panel-border)',
          // Largeur décidée, pas subie : elle ne dépend plus du nombre de
          // sections. L'ancien `fit-content` faisait épouser au panneau la
          // largeur de sa barre d'onglets, si bien que chaque onglet ajouté
          // l'élargissait.
          width: isMobile ? '100vw' : 'min(92vw, 720px)',
          maxWidth: '100vw',
        }}
      >
        {/* Header */}
        <div
          className="prefs-panel-head px-5 py-3 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid var(--panel-border)' }}
        >
          {/* ⚠️ `min-w-0` et la troncature ne sont pas cosmétiques : sans eux, le
              sélecteur de thème pousse « Tout réinitialiser » puis la croix de
              fermeture HORS du panneau sur un téléphone. Vu sur iPhone : plus
              aucun moyen de sortir des préférences. */}
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg font-bold flex-shrink-0" style={{ color: 'var(--list-title)' }}>
              {t('preferences.title')}
            </h2>
            {/* Raccourci de thème — pas sur téléphone. À 320 px il chevauchait
                « Tout réinitialiser » dans toutes les langues : 280 px utiles,
                141 pour le bouton et la croix, 116 pour le titre et l'espace,
                et le sélecteur ne descend pas sous 76. Les thèmes restent tous
                dans la section Apparence. */}
            {!isMobile && savedThemes.length > 1 && (
              <select
                value={theme.name}
                aria-label={t('preferences.appearance.theme')}
                onChange={(e) => loadSavedTheme(e.target.value)}
                className="text-[13px] px-2 py-1 rounded-md appearance-none cursor-pointer pr-6 prefs-tap-row min-w-[76px] flex-shrink truncate"
                style={{
                  border: '1px solid var(--panel-border)',
                  color: 'var(--list-title)',
                  background: `var(--panel-header-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238b8d9a'/%3E%3C/svg%3E") no-repeat right 8px center`,
                }}
              >
                {savedThemes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setConfirmReset(true)}
              className="text-[11px] px-2 py-1 rounded-md transition-colors prefs-tap-btn"
              style={{ color: 'var(--danger)', background: 'transparent' }}
              title={t('preferences.resetThemeTooltip')}
            >
              {t('preferences.resetTheme')}
            </button>
            <ConfirmDialog
              open={confirmReset}
              title={t('preferences.resetThemeTitle')}
              message={t('preferences.resetThemeMessage', { name: theme.name })}
              confirmLabel={t('preferences.resetThemeConfirm')}
              danger
              onConfirm={confirmResetTheme}
              onCancel={() => setConfirmReset(false)}
            />
            <button
              onClick={closePreferences}
              aria-label={t('app.close')}
              className="p-1 rounded-lg hover-tint transition-colors prefs-tap-btn"
              style={{ color: 'var(--list-summary)' }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="prefs-panel-body flex-1 flex min-h-0">
          <nav
            hidden={isMobile && !showNav}
            className={`prefs-nav ${isMobile ? 'w-full' : 'w-[240px]'} flex-shrink-0 overflow-y-auto px-2.5 py-3`}
            style={{ borderRight: isMobile ? undefined : '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}
            aria-label={t('preferences.title')}
          >
            <ul ref={navListRef} className="relative flex flex-col gap-0.5">
              {/* L'indicateur glisse d'une section à l'autre au lieu de sauter :
                  il dit d'où l'on vient. Une pastille teintée, pas un aplat :
                  le libellé garde sa couleur pendant le trajet. */}
              {!isMobile && pill && (
                <li
                  aria-hidden="true"
                  className="prefs-nav-pill"
                  data-ready={pillReady ? 'true' : undefined}
                  style={{ transform: `translateY(${pill.y}px)`, height: pill.h }}
                />
              )}
              {sections.map((s) => {
                const active = tab === s.id;
                const sectionSubs = subsBySection[s.id] ?? NO_SUBS;
                const opensDirectly = isMobile && SECTIONS_WITHOUT_SUBS.includes(s.id);
                const hasSubs = sectionSubs.length > 0;
                const open = hasSubs && openSections.has(s.id);
                const listId = `${subListId}-${s.id}`;
                return (
                  <li key={s.id} className={s.id === 'admin' ? 'prefs-nav-sep' : undefined}>
                    <button
                      type="button"
                      data-section={s.id}
                      onClick={() => openSection(s.id)}
                      aria-current={active ? 'page' : undefined}
                      aria-expanded={hasSubs ? open : undefined}
                      aria-controls={hasSubs ? listId : undefined}
                      className="prefs-nav-item prefs-tap-row"
                    >
                      <svg className="prefs-nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d={SECTION_ICONS[s.id]} />
                      </svg>
                      <span className="flex-1 min-w-0 truncate">{s.label}</span>
                      {opensDirectly ? (
                        <svg className="w-4 h-4 opacity-50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      ) : (hasSubs || isMobile) && (
                        <svg className="prefs-nav-chevron" data-open={open ? 'true' : undefined} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    {hasSubs && (
                      <div className="prefs-subnav" data-open={open ? 'true' : 'false'}>
                        <ul id={listId} className="prefs-subnav-list" inert={!open}>
                          {sectionSubs.map((sub, i) => (
                            <li key={`${i}-${sub.label}`}>
                              <button
                                type="button"
                                onClick={() => goToSub(s.id, i)}
                                aria-current={active && i === currentSub ? 'location' : undefined}
                                // Une seule ligne ; coupé par « … » dans une langue longue,
                                // le libellé entier reste au survol.
                                title={sub.label}
                                className="prefs-subnav-item"
                              >
                                {sub.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div
            ref={scrollRef}
            hidden={isMobile && showNav}
            className="prefs-content flex-1 overflow-y-auto min-w-0"
          >
            {isMobile && (
              /* Toujours à portée : la barre colle en haut de la page, les
                 bandeaux des sous-parties collent juste dessous
                 (`--prefs-sticky-top`). Le bouton Retour était en tête de
                 page : il fallait remonter tout en haut pour sortir. */
              <div className="prefs-mobile-bar">
                <button
                  onClick={() => setShowNav(true)}
                  className="prefs-mobile-bar__back"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  {t('preferences.nav.back')}
                </button>
                <h2 className="prefs-mobile-bar__title">{sections.find((x) => x.id === tab)?.label}</h2>
              </div>
            )}
            <div ref={contentRef} className={`relative isolate ${isMobile ? 'px-4 pt-2 pb-10' : 'px-7 pt-6 pb-16'}`}>
            {marked && <SubMark el={marked} container={contentRef} />}
          {/* `display:none` en ligne plutôt que l'attribut `hidden` seul : la
              règle `.prefs-panel-body > [hidden]` ne vise que les enfants
              directs, et `hidden` perd contre une classe utilitaire d'affichage
              (le piège déjà rencontré sur la navigation mobile). Un style en
              ligne, lui, ne peut pas être battu par une classe. */}
          {sections.map((s) => visited.has(s.id) && (
            <Pane key={s.id} id={s.id} tab={tab} title={s.label}>
              {renderSection(s.id)}
            </Pane>
          ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  function renderSection(id: SectionId) {
    switch (id) {
      case 'reading': return <ReadingTab />;
      case 'appearance': return <AppearanceTab onHighlight={setHighlightKey} active={tab === 'appearance'} />;
      case 'layout': return <LayoutTab />;
      case 'keyboard': return <KeyboardTab />;
      case 'feeds': return <FeedsTab />;
      case 'labels': return <LabelsTab resetLabelColors={resetLabelColors} />;
      case 'offline': return <OfflineTab active={tab === 'offline'} />;
      case 'ai': return <AiTab active={tab === 'ai'} />;
      case 'account': return <AccountTab />;
      case 'admin': return <AdminTab active={tab === 'admin'} />;
    }
  }
}

/**
 * Enveloppe d'une section : montée une fois visitée, masquée le reste du temps.
 * Garder la section montée rend le retour instantané ; `hidden` porte le sens
 * pour les technologies d'assistance, `display` garantit l'effet visuel.
 */
/**
 * Le fond teinté de la sous-partie choisie : du haut de son bandeau jusqu'au
 * sous-titre suivant de la même page (ou au bas de la page), sur toute la
 * largeur, sous le contenu. Calculé plutôt que porté par un conteneur : les
 * sous-parties ne sont pas toutes enveloppées (un titre suivi de ses blocs),
 * et certaines vivent dans un composant à part (IA, Sauvegarde).
 */
function SubMark({ el, container }: { el: HTMLElement; container: React.RefObject<HTMLDivElement | null> }) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const host = container.current;
    const pane = el.closest<HTMLElement>('[data-pane]');
    if (!host || !pane) return;
    // Le bandeau collant porte la même teinte, opaque : il passe par-dessus.
    const band = bandOf(el);
    band.setAttribute('data-pref-marked', '');
    const measure = () => {
      const origin = host.getBoundingClientRect().top;
      const heads = Array.from(pane.querySelectorAll<HTMLElement>('[data-pref-sub]'));
      const next = heads[heads.indexOf(el) + 1];
      const nextBand = next ? bandOf(next) : null;
      // Positions dans la page : un bandeau collé mentirait (voir `flowTop`).
      const top = flowTop(band) - origin;
      // Jusqu'à mi-chemin de l'espace qui précède le bandeau suivant.
      const bottom = nextBand
        ? flowTop(nextBand) - origin - parseFloat(getComputedStyle(nextBand).marginTop || '0') / 2
        : pane.getBoundingClientRect().bottom - origin + 24;
      setBox((cur) => (cur && cur.top === top && cur.height === bottom - top ? cur : { top, height: Math.max(0, bottom - top) }));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(pane);
    return () => { ro?.disconnect(); band.removeAttribute('data-pref-marked'); };
  }, [el, container]);
  if (!box) return null;
  return <div aria-hidden="true" className="prefs-submark" style={{ top: box.top, height: box.height }} />;
}

function Pane({ id, tab, title, children }: { id: string; tab: string; title: string; children: React.ReactNode }) {
  const shown = tab === id;
  return (
    <div data-pane={id} className="prefs-pane" hidden={!shown} style={{ display: shown ? undefined : 'none' }}>
      <h2 className="prefs-h2">{title}</h2>
      {children}
    </div>
  );
}
