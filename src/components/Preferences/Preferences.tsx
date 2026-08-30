import { useState, useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import FeedsTab from './FeedsTab';
import AdminTab from './AdminTab';
import OfflineTab from './OfflineTab';
import LabelsTab from './LabelsTab';
import GeneralTab from './GeneralTab';
import AppearanceTab from './AppearanceTab';
import { COLOR_HIGHLIGHT_MAP } from './colorHighlight';

interface HighlightRect { top: number; left: number; width: number; height: number }

export default function Preferences() {
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
  const [tab, setTab] = useState<string>(preferencesTab || 'general');
  const [showNav, setShowNav] = useState(!preferencesTab);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  // Une section n'est montée qu'à sa première visite, puis le reste. Le montage
  // conditionnel d'origine la détruisait à chaque changement de section : Flux
  // et Administration, les deux seules à appeler le réseau au montage,
  // repayaient un aller-retour complet à chaque retour, écran vide.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([preferencesTab || 'general']));
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);
  // Unique per mount so two Preferences instances (shouldn't normally
  // happen, but tests/HMR can) never share — and shadow each other's —
  // <mask id>.
  const spotlightMaskId = `prefs-spotlight-${useId()}`;

  // Reset tab (and the mobile drill-down) every time preferences are opened
  // (preferencesOpenId changes each open)
  useEffect(() => {
    setTab(preferencesTab || 'general');
    setShowNav(!preferencesTab);
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

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    resetToDefault();
    setConfirmReset(false);
  }

  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  const SECTIONS = ['general', 'appearance', 'labels', 'feeds', 'offline'] as const;
  const sections = SECTIONS.map((id) => ({ id, label: t(`preferences.sections.${id}`) }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end"
      onClick={(e) => {
        // Click outside modal → close
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
          closePreferences();
        }
      }}
      onKeyDown={(e) => {
        // Escape closes the dialog. Shortcut-capture stops propagation, so it
        // won't reach here while a shortcut is being recorded.
        if (e.key === 'Escape') closePreferences();
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
              className="absolute text-[10px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap"
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
          width: isMobile ? '100vw' : 'min(92vw, 680px)',
          maxWidth: '100vw',
        }}
      >
        {/* Header */}
        <div
          className="prefs-panel-head px-5 py-3 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid var(--panel-border)' }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold" style={{ color: 'var(--list-title)' }}>
              {t('preferences.title')}
            </h2>
            {/* Theme dropdown — show when there are custom themes beyond the default */}
            {savedThemes.length > 1 && (
              <select
                value={theme.name}
                onChange={(e) => loadSavedTheme(e.target.value)}
                className="text-xs px-2 py-1 rounded-md appearance-none cursor-pointer pr-6 prefs-tap-row"
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
          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              className="text-[10px] px-2 py-1 rounded-md transition-colors prefs-tap-btn"
              style={{
                color: confirmReset ? 'var(--on-danger)' : 'var(--danger)',
                background: confirmReset ? 'var(--danger)' : 'transparent',
              }}
              title={t('preferences.resetAllTooltip')}
            >
              {confirmReset ? t('preferences.confirm') : t('preferences.resetAll')}
            </button>
            <button
              onClick={closePreferences}
              aria-label={t('app.close')}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors prefs-tap-btn"
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
            className={`${isMobile ? 'w-full' : 'w-[178px]'} flex-shrink-0 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5`}
            style={{ borderRight: isMobile ? undefined : '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}
            aria-label={t('preferences.title')}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => { setTab(s.id); if (isMobile) setShowNav(false); }}
                aria-current={tab === s.id ? 'page' : undefined}
                className={`flex items-center text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors prefs-tap-row ${isMobile ? 'justify-between' : ''}`}
                style={{
                  background: tab === s.id ? 'var(--accent)' : 'transparent',
                  color: tab === s.id ? '#ffffff' : 'var(--list-title)',
                  fontWeight: tab === s.id ? 600 : 400,
                }}
              >
                {s.label}
                {/* Mobile only: this list is a drill-down (tap → section screen),
                    not a pane switcher like on desktop, so it should read as
                    navigation. */}
                {isMobile && <span aria-hidden="true" className="opacity-60">›</span>}
              </button>
            ))}
            {isAdmin && (
              <>
                <div className="h-px mx-2 mt-2.5 mb-0.5" style={{ background: 'var(--panel-border)' }} />
                <button
                  onClick={() => { setTab('admin'); if (isMobile) setShowNav(false); }}
                  aria-current={tab === 'admin' ? 'page' : undefined}
                  className={`flex items-center text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors prefs-tap-row ${isMobile ? 'justify-between' : ''}`}
                  style={{
                    background: tab === 'admin' ? 'var(--accent)' : 'transparent',
                    color: tab === 'admin' ? '#ffffff' : 'var(--list-title)',
                    fontWeight: tab === 'admin' ? 600 : 400,
                  }}
                >
                  {t('preferences.sections.admin')}
                  {isMobile && <span aria-hidden="true" className="opacity-60">›</span>}
                </button>
              </>
            )}
          </nav>
          <div hidden={isMobile && showNav} className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
            {isMobile && (
              <button
                onClick={() => setShowNav(true)}
                /* The way back, not the subject of the screen: it needs to
                   read at a glance without becoming the primary action, so
                   it borrows the accent colour and a heavier weight rather
                   than a filled button. 44pt tap target via min-height. */
                className="flex items-center gap-1.5 mb-3 text-xs font-semibold min-h-[44px]"
                style={{ color: 'var(--accent)' }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                {t('preferences.nav.back')}
              </button>
            )}
          {/* `display:none` en ligne plutôt que l'attribut `hidden` seul : la
              règle `.prefs-panel-body > [hidden]` ne vise que les enfants
              directs, et `hidden` perd contre une classe utilitaire d'affichage
              (le piège déjà rencontré sur la navigation mobile). Un style en
              ligne, lui, ne peut pas être battu par une classe. */}
          {visited.has('general') && <Pane id="general" tab={tab}><GeneralTab /></Pane>}
          {visited.has('appearance') && (
            <Pane id="appearance" tab={tab}>
              <AppearanceTab onHighlight={setHighlightKey} active={tab === 'appearance'} />
            </Pane>
          )}
          {visited.has('labels') && (
            <Pane id="labels" tab={tab}><LabelsTab resetLabelColors={resetLabelColors} /></Pane>
          )}
          {visited.has('feeds') && <Pane id="feeds" tab={tab}><FeedsTab /></Pane>}
          {visited.has('offline') && (
            <Pane id="offline" tab={tab}><OfflineTab active={tab === 'offline'} /></Pane>
          )}

          {isAdmin && visited.has('admin') && (
            <Pane id="admin" tab={tab}><AdminTab active={tab === 'admin'} /></Pane>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Enveloppe d'une section : montée une fois visitée, masquée le reste du temps.
 * Garder la section montée rend le retour instantané ; `hidden` porte le sens
 * pour les technologies d'assistance, `display` garantit l'effet visuel.
 */
function Pane({ id, tab, children }: { id: string; tab: string; children: React.ReactNode }) {
  const shown = tab === id;
  return (
    <div hidden={!shown} style={{ display: shown ? undefined : 'none' }}>
      {children}
    </div>
  );
}
