import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
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

  const [tab, setTab] = useState<string>(preferencesTab || 'general');
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset tab every time preferences are opened (preferencesOpenId changes each open)
  useEffect(() => {
    setTab(preferencesTab || 'general');
  }, [preferencesTab, preferencesOpenId]);

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
      {/* Dim overlay — darkens everything except highlighted areas */}
      {highlightRects.length > 0 && (
        <div
          className="fixed inset-0 pointer-events-none z-[48]"
          style={{ background: 'rgba(0, 0, 0, 0.15)', transition: 'opacity 0.2s' }}
        />
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
        className="h-full shadow-2xl flex flex-col overflow-hidden outline-none"
        style={{
          background: 'var(--panel-bg)',
          borderLeft: '1px solid var(--panel-border)',
          // Largeur décidée, pas subie : elle ne dépend plus du nombre de
          // sections. L'ancien `fit-content` faisait épouser au panneau la
          // largeur de sa barre d'onglets, si bien que chaque onglet ajouté
          // l'élargissait.
          width: 'min(92vw, 680px)',
          maxWidth: '92vw',
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-3 flex items-center justify-between flex-shrink-0"
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
                className="text-xs px-2 py-1 rounded-md appearance-none cursor-pointer pr-6"
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
              className="text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{
                color: confirmReset ? '#ffffff' : 'var(--danger)',
                background: confirmReset ? 'var(--danger)' : 'transparent',
              }}
              title={t('preferences.resetAllTooltip')}
            >
              {confirmReset ? t('preferences.confirm') : t('preferences.resetAll')}
            </button>
            <button
              onClick={closePreferences}
              aria-label={t('app.close')}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors"
              style={{ color: 'var(--list-summary)' }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <nav
            className="w-[178px] flex-shrink-0 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5"
            style={{ borderRight: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}
            aria-label={t('preferences.title')}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                aria-current={tab === s.id ? 'page' : undefined}
                className="text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                style={{
                  background: tab === s.id ? 'var(--accent)' : 'transparent',
                  color: tab === s.id ? '#ffffff' : 'var(--list-title)',
                  fontWeight: tab === s.id ? 600 : 400,
                }}
              >
                {s.label}
              </button>
            ))}
            {isAdmin && (
              <>
                <div className="h-px mx-2 mt-2.5 mb-0.5" style={{ background: 'var(--panel-border)' }} />
                <button
                  onClick={() => setTab('admin')}
                  aria-current={tab === 'admin' ? 'page' : undefined}
                  className="text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: tab === 'admin' ? 'var(--accent)' : 'transparent',
                    color: tab === 'admin' ? '#ffffff' : 'var(--list-title)',
                    fontWeight: tab === 'admin' ? 600 : 400,
                  }}
                >
                  {t('preferences.sections.admin')}
                </button>
              </>
            )}
          </nav>
          <div className="flex-1 overflow-y-auto px-5 py-4 min-w-0">
          {tab === 'general' && <GeneralTab />}

          {tab === 'appearance' && <AppearanceTab onHighlight={setHighlightKey} />}
          {tab === 'labels' && <LabelsTab resetLabelColors={resetLabelColors} />}
          {tab === 'feeds' && <FeedsTab />}
          {tab === 'offline' && <OfflineTab />}

          {tab === 'admin' && isAdmin && <AdminTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
