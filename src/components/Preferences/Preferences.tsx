import { useState, useRef, useCallback, useEffect, type ChangeEvent, type ReactNode, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLanguage } from '../../i18n';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore, shortcutActions } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import ToggleSwitch from '../ToggleSwitch';
import type { Tag } from '../../types';
import RefreshTab from './RefreshTab';
import AdminTab from './AdminTab';
import OfflineTab from './OfflineTab';
import LabelsTab from './LabelsTab';
import { TabResetButton } from './TabResetButton';

interface HighlightRect { top: number; left: number; width: number; height: number }

// Color section definitions — titles and labels resolved via t() at render time
const COLOR_SECTIONS = [
  {
    titleKey: 'sidebar',
    keys: ['sidebar-bg', 'sidebar-header-from', 'sidebar-header-to', 'sidebar-text', 'sidebar-text-active', 'sidebar-category-text', 'sidebar-divider'],
  },
  {
    titleKey: 'topbar',
    keys: ['topbar-bg', 'topbar-text', 'topbar-text-active', 'topbar-track', 'topbar-seg-active'],
  },
  {
    titleKey: 'accent',
    keys: ['accent', 'accent-dark'],
  },
  {
    titleKey: 'articleList',
    keys: ['panel-bg', 'panel-border', 'panel-header-bg', 'list-hover', 'list-selected', 'list-active', 'list-source', 'list-title', 'list-title-read', 'list-summary', 'list-time'],
  },
  {
    titleKey: 'reading',
    keys: ['reading-title', 'reading-text', 'reading-meta', 'reading-link'],
  },
  {
    titleKey: 'misc',
    keys: ['star-color', 'readlater-color', 'danger', 'danger-light', 'code-bg', 'scrollbar', 'scrollbar-hover'],
  },
];

// Mapping: color key → CSS selectors to highlight in the UI
// Uses data-theme attributes on specific elements for precise targeting
const COLOR_HIGHLIGHT_MAP: Record<string, string | null> = {
  'sidebar-bg':           '.sidebar',
  'sidebar-header-from':  '.sidebar-header',
  'sidebar-header-to':    '.sidebar-header',
  'sidebar-text':         '[data-theme="sidebar-text"]',
  'sidebar-text-active':  '[data-theme="sidebar-text-active"]',
  'sidebar-category-text':'[data-theme="sidebar-category-text"]',
  'sidebar-divider':      null,
  'topbar-bg':            '.server-track',
  'topbar-text':          '.server-seg:not(.server-seg-active)',
  'topbar-text-active':   '.server-seg-active',
  'topbar-track':         '.server-track',
  'topbar-seg-active':    '.server-seg-active',
  'accent':               null, // too many elements, skip
  'accent-dark':          null,
  'panel-bg':             '.article-list, .reading-pane',
  'panel-border':         null,
  'panel-header-bg':      '.article-list-header',
  'list-hover':           '.article-row:not(.article-row-active)',
  'list-active':          '[data-theme="list-active"]',
  'list-selected':        '.article-row-active',
  'list-source':          '[data-theme="list-source"]',
  'list-title':           '[data-theme="list-title"]',
  'list-title-read':      '[data-theme="list-title-read"]',
  'list-summary':         '[data-theme="list-summary"]',
  'list-time':            '[data-theme="list-time"]',
  'reading-title':        '[data-theme="reading-title"]',
  'reading-text':         '[data-theme="reading-text"]',
  'reading-meta':         '[data-theme="reading-meta"]',
  'reading-link':         '.article-content a',
  'star-color':           '[data-theme="star-color"]',
  'readlater-color':      '[data-theme="readlater-color"]',
  'danger':               null,
  'danger-light':         null,
  'code-bg':              '.article-content pre, .article-content code',
  'scrollbar':            null,
  'scrollbar-hover':      null,
};

// Font section definitions — titles and labels resolved via t() at render time
const FONT_SECTIONS = [
  {
    titleKey: 'sidebar',
    keys: [
      { key: 'sidebar-feed', min: 10, max: 16 },
      { key: 'sidebar-category', min: 9, max: 14 },
    ],
  },
  {
    titleKey: 'articleList',
    keys: [
      { key: 'list-title', min: 11, max: 18 },
      { key: 'list-summary', min: 10, max: 16 },
      { key: 'list-source', min: 8, max: 14 },
    ],
  },
  {
    titleKey: 'reading',
    keys: [
      { key: 'reading-title', min: 18, max: 36 },
      { key: 'reading-body', min: 12, max: 20 },
    ],
  },
];

export default function Preferences() {
  const {
    theme,
    savedThemes,
    closePreferences,
    setColor,
    setFontSize,
    setThemeName,
    saveCurrentTheme,
    loadSavedTheme,
    deleteSavedTheme,
    exportTheme,
    importTheme,
    resetToDefault,
    resetColors,
    resetColor,
    isColorModified,
    resetFontSizes,
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
  const [importError, setImportError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const res = ev.target?.result;
      const ok = typeof res === 'string' ? importTheme(res) : false;
      setImportError(ok ? '' : t('preferences.themes.importError'));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

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
          {tab === 'general' && (<><GeneralTab /><ShortcutsTab /></>)}

          {tab === 'appearance' && (
            <>
              <BrandingTab />

              <div className="space-y-5">
                {COLOR_SECTIONS.map((section) => (
                  <div key={section.titleKey}>
                    <h3
                      className="text-[11px] font-bold uppercase tracking-widest mb-2"
                      style={{ color: 'var(--list-summary)' }}
                    >
                      {t(`preferences.colorSections.${section.titleKey}`)}
                    </h3>
                    <div className="space-y-0.5">
                      {section.keys.map((key) => (
                        <ColorRow
                          key={key}
                          label={t(`preferences.colorKeys.${key}`)}
                          value={theme.colors[key]}
                          onChange={(v) => setColor(key, v)}
                          colorKey={key}
                          onHighlight={setHighlightKey}
                          isModified={isColorModified(key)}
                          onReset={() => resetColor(key)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <TabResetButton label={t('preferences.colors.resetColors')} onReset={resetColors} />
              </div>

              <div className="space-y-5">
                {FONT_SECTIONS.map((section) => (
                  <div key={section.titleKey}>
                    <h3
                      className="text-[11px] font-bold uppercase tracking-widest mb-2"
                      style={{ color: 'var(--list-summary)' }}
                    >
                      {t(`preferences.fontSections.${section.titleKey}`)}
                    </h3>
                    <div className="space-y-2">
                      {section.keys.map(({ key, min, max }) => (
                        <FontRow
                          key={key}
                          label={t(`preferences.fontKeys.${key}`)}
                          value={theme.fontSizes[key]}
                          min={min}
                          max={max}
                          onChange={(v) => setFontSize(key, v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <TabResetButton label={t('preferences.fonts.resetFonts')} onReset={resetFontSizes} />
              </div>

              <div className="space-y-5">
                {/* Save current */}
                <div>
                  <h3
                    className="text-[11px] font-bold uppercase tracking-widest mb-2"
                    style={{ color: 'var(--list-summary)' }}
                  >
                    {t('preferences.themes.saveTitle')}
                  </h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={theme.name}
                      onChange={(e) => setThemeName(e.target.value)}
                      placeholder={t('preferences.themes.themeName')}
                      className="flex-1 px-3 py-1.5 text-sm rounded-md"
                      style={{
                        border: '1px solid var(--panel-border)',
                        color: 'var(--list-title)',
                        background: 'var(--panel-header-bg)',
                      }}
                    />
                    <button
                      onClick={saveCurrentTheme}
                      className="px-3 py-1.5 text-xs font-medium rounded-md text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      {t('preferences.themes.save')}
                    </button>
                  </div>
                </div>

                {/* Saved themes list */}
                {savedThemes.length > 0 && (
                  <div>
                    <h3
                      className="text-[11px] font-bold uppercase tracking-widest mb-2"
                      style={{ color: 'var(--list-summary)' }}
                    >
                      {t('preferences.themes.savedThemes', { count: savedThemes.length })}
                    </h3>
                    <div className="space-y-1">
                      {savedThemes.map((st) => {
                        const isDefault = st.name === 'FriRSS Default';
                        const isActive = st.name === theme.name;
                        return (
                          <div
                            key={st.name}
                            className="flex items-center gap-2 px-3 py-2 rounded-md"
                            style={{
                              background: isActive ? 'var(--accent-glow)' : 'var(--panel-header-bg)',
                              border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                            }}
                          >
                            {/* Color preview dots */}
                            <div className="flex gap-0.5 flex-shrink-0">
                              <div className="w-3 h-3 rounded-full" style={{ background: st.colors?.['sidebar-bg'] || '#201f1b' }} />
                              <div className="w-3 h-3 rounded-full" style={{ background: st.colors?.accent || '#4cd4a1' }} />
                              <div className="w-3 h-3 rounded-full" style={{ background: st.colors?.['panel-bg'] || '#ffffff' }} />
                            </div>
                            <span
                              className="flex-1 text-sm truncate"
                              style={{ color: 'var(--list-title)' }}
                            >
                              {st.name}
                            </span>
                            {!isActive && (
                              <button
                                onClick={() => loadSavedTheme(st.name)}
                                className="text-[10px] font-medium px-2 py-0.5 rounded"
                                style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
                              >
                                {t('preferences.themes.load')}
                              </button>
                            )}
                            {isActive && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ color: 'var(--accent)' }}>
                                {t('preferences.themes.active')}
                              </span>
                            )}
                            {!isDefault && (
                              <button
                                onClick={() => deleteSavedTheme(st.name)}
                                className="text-[10px] px-2 py-0.5 rounded hover:bg-red-50"
                                style={{ color: 'var(--danger)' }}
                              >
                                {t('preferences.themes.deleteShort')}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Import / Export */}
                <div>
                  <h3
                    className="text-[11px] font-bold uppercase tracking-widest mb-2"
                    style={{ color: 'var(--list-summary)' }}
                  >
                    {t('preferences.themes.share')}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={exportTheme}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5"
                      style={{
                        border: '1px solid var(--panel-border)',
                        color: 'var(--list-title)',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      {t('preferences.themes.export')}
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors hover:bg-black/5"
                      style={{
                        border: '1px solid var(--panel-border)',
                        color: 'var(--list-title)',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12M12 16.5V3" />
                      </svg>
                      {t('preferences.themes.import')}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".css,.json"
                      onChange={handleImport}
                      className="hidden"
                    />
                  </div>
                  {importError && (
                    <p className="text-red-400 text-xs mt-1">{importError}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'labels' && <LabelsTab resetLabelColors={resetLabelColors} />}
          {tab === 'feeds' && <RefreshTab />}
          {tab === 'offline' && <OfflineTab />}

          {tab === 'admin' && isAdmin && <AdminTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ColorRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colorKey: string;
  onHighlight?: (key: string | null) => void;
  isModified?: boolean;
  onReset?: () => void;
}
function ColorRow({ label, value, onChange, colorKey, onHighlight, isModified, onReset }: ColorRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [hex, setHex] = useState(value);

  function handleHexChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setHex(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      onChange(v);
    }
  }

  function handlePickerChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setHex(v);
    onChange(v);
  }

  return (
    <div
      className="group flex items-center gap-2 py-1 px-1.5 -mx-1.5 rounded-md transition-colors hover:bg-black/[.03]"
      onMouseEnter={() => onHighlight?.(colorKey)}
      onMouseLeave={() => onHighlight?.(null)}
    >
      <label className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--reading-text)' }}>
        {label}
        {isModified && (
          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ background: 'var(--accent)' }} />
        )}
      </label>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Reset to default — only visible on hover when modified */}
        {isModified && (
          <button
            onClick={() => { onReset?.(); }}
            className="p-0.5 rounded transition-all opacity-0 group-hover:opacity-100 hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
            title={t('preferences.colors.resetTooltip')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
        )}
        <div className="relative">
          <input
            type="color"
            value={value?.startsWith('#') ? value : '#000000'}
            onChange={handlePickerChange}
            className="w-6 h-6 rounded cursor-pointer border-0 p-0"
            style={{ background: 'none' }}
          />
        </div>
        {editing ? (
          <input
            type="text"
            value={hex}
            onChange={handleHexChange}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
            autoFocus
            className="w-20 text-[11px] px-1.5 py-0.5 rounded font-mono"
            style={{
              border: '1px solid var(--panel-border)',
              color: 'var(--list-title)',
              background: 'var(--panel-header-bg)',
            }}
          />
        ) : (
          <button
            onClick={() => { setHex(value); setEditing(true); }}
            className="text-[11px] font-mono px-1.5 py-0.5 rounded hover:bg-black/5 transition-colors"
            style={{ color: 'var(--list-summary)' }}
          >
            {value}
          </button>
        )}
      </div>
    </div>
  );
}

function ShortcutsTab() {
  const { t } = useTranslation();
  const { shortcuts, setShortcut, resetShortcuts } = useUiStore();
  const [editing, setEditing] = useState<string | null>(null);

  const handleKeyCapture = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;
      if (key === 'Escape') {
        setEditing(null);
        return;
      }

      setShortcut(editing, key);
      setEditing(null);
    },
    [editing, setShortcut]
  );

  function formatKey(key: string) {
    const names: Record<string, string> = {
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      ' ': t('preferences.shortcuts.keySpace'),
      Escape: t('preferences.shortcuts.keyEscape'),
      Enter: t('preferences.shortcuts.keyEnter'),
      Backspace: '⌫',
      Delete: t('preferences.shortcuts.keyDelete'),
      Tab: 'Tab',
    };
    return names[key] || key.toUpperCase();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.shortcuts.title')}
        </h3>
        <button
          onClick={resetShortcuts}
          className="text-[10px] px-2 py-1 rounded-md transition-colors hover:bg-black/5"
          style={{ color: 'var(--accent)' }}
        >
          {t('preferences.shortcuts.reset')}
        </button>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.shortcuts.hint')}
      </p>

      <div className="space-y-1">
        {shortcutActions.map((action) => (
          <div
            key={action}
            className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-black/[.03]"
          >
            <span className="text-xs" style={{ color: 'var(--reading-text)' }}>
              {t(`preferences.shortcuts.${action}`)}
            </span>
            <button
              onClick={() => setEditing(action)}
              onKeyDown={editing === action ? handleKeyCapture : undefined}
              className={`min-w-[60px] text-center text-xs font-mono px-3 py-1 rounded-md transition-all ${
                editing === action
                  ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-glow)]'
                  : 'hover:bg-black/5'
              }`}
              style={{
                border: '1px solid var(--panel-border)',
                color: editing === action ? 'var(--accent)' : 'var(--list-title)',
                background: editing === action ? 'var(--accent-glow)' : 'var(--panel-header-bg)',
              }}
              autoFocus={editing === action}
            >
              {editing === action ? '...' : formatKey(shortcuts[action])}
            </button>
          </div>
        ))}
      </div>

      {/* Built-in gestures / keys — not remappable, listed for discoverability. */}
      <div className="pt-2 space-y-1">
        <h3
          className="text-[11px] font-bold uppercase tracking-widest pb-1"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.shortcuts.builtInTitle')}
        </h3>
        {[
          { keyLabel: formatKey('Escape'), label: t('preferences.shortcuts.escExitFocus') },
          { keyLabel: formatKey('Escape'), label: t('preferences.shortcuts.escBackToGrid') },
          { keyLabel: t('preferences.shortcuts.keyDoubleClick'), label: t('preferences.shortcuts.doubleClickFocus') },
          { keyLabel: t('preferences.shortcuts.keyHold'), label: t('preferences.shortcuts.holdToFile') },
        ].map(({ keyLabel, label }) => (
          <div key={label} className="flex items-center justify-between py-1.5 px-2 rounded-md">
            <span className="text-xs" style={{ color: 'var(--reading-text)' }}>
              {label}
            </span>
            <span
              className="min-w-[60px] text-center text-xs font-mono px-3 py-1 rounded-md"
              style={{
                border: '1px solid var(--panel-border)',
                color: 'var(--list-summary)',
                background: 'var(--panel-header-bg)',
              }}
            >
              {keyLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FontRow({ label, value, min, max, onChange }: { label: string; value: string; min: number; max: number; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--reading-text)' }}>
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 accent-[var(--accent)]"
      />
      <span
        className="text-[11px] font-mono w-8 text-right"
        style={{ color: 'var(--list-summary)' }}
      >
        {value}px
      </span>
    </div>
  );
}

/* ── Branding tab — custom title & logo ─────────────────────────── */

function BrandingTab() {
  const { t, i18n } = useTranslation();
  const appTitle = useUiStore((s) => s.appTitle);
  const appLogo = useUiStore((s) => s.appLogo);
  const logoMode = useUiStore((s) => s.logoMode);
  const setAppTitle = useUiStore((s) => s.setAppTitle);
  const setAppLogo = useUiStore((s) => s.setAppLogo);
  const setLogoMode = useUiStore((s) => s.setLogoMode);
  const [titleDraft, setTitleDraft] = useState(appTitle);
  // URL draft for logo — initialised from the current logo if it's a URL (not a data URI)
  const [logoUrlDraft, setLogoUrlDraft] = useState(
    appLogo && !appLogo.startsWith('data:') ? appLogo : ''
  );
  const logoInputRef = useRef<HTMLInputElement>(null);

  function applyLogoUrl() {
    const url = logoUrlDraft.trim();
    if (url) setAppLogo(url);
  }

  function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    // Limit size: resize to max 256x256 (recommended) for localStorage friendliness
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 256;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/png');
        setAppLogo(dataUrl);
      };
      if (typeof ev.target?.result === 'string') img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="space-y-6">
      {/* Language */}
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.branding.language')}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {[
            { code: 'fr', flag: '🇫🇷', name: 'Français' },
            { code: 'en', flag: '🇬🇧', name: 'English' },
            { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
            { code: 'es', flag: '🇪🇸', name: 'Español' },
            { code: 'it', flag: '🇮🇹', name: 'Italiano' },
            { code: 'pt', flag: '🇵🇹', name: 'Português' },
            { code: 'nl', flag: '🇳🇱', name: 'Nederlands' },
            { code: 'pl', flag: '🇵🇱', name: 'Polski' },
            { code: 'uk', flag: '🇺🇦', name: 'Українська' },
          ].map((lang) => (
            <button
              key={lang.code}
              onClick={async () => {
                await loadLanguage(lang.code);
                i18n.changeLanguage(lang.code);
                localStorage.setItem('frirss_language', lang.code);
              }}
              title={lang.name}
              aria-label={lang.name}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${
                i18n.language === lang.code ? 'text-white' : 'hover:bg-black/5'
              }`}
              style={{
                background: i18n.language === lang.code ? 'var(--accent)' : 'var(--panel-header-bg)',
                color: i18n.language === lang.code ? '#ffffff' : 'var(--list-title)',
                border: i18n.language === lang.code ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
              }}
            >
              <span className="text-sm">{lang.flag}</span>
              {lang.code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.branding.preview')}
        </h3>
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{ background: 'var(--sidebar-header-bg)' }}
        >
          {appLogo && logoMode === 'large' ? (
            /* Full mode: the logo replaces the title + server name */
            <img
              src={appLogo}
              alt={titleDraft}
              className="h-8 object-contain rounded"
            />
          ) : (
            /* Compact mode (custom small logo) OR default: logo + title + server */
            <>
              {appLogo ? (
                <img src={appLogo} alt={titleDraft} className="w-9 h-9 rounded-lg object-contain flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/20 backdrop-blur-sm flex-shrink-0">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-white font-bold text-base leading-tight truncate">{titleDraft || 'FriRSS'}</p>
                <p className="text-[11px] text-white/70 truncate">rss.example.com</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Title — shown when there's no logo, or in compact mode (logo + title) */}
      {(!appLogo || logoMode === 'small') && (
        <div>
          <h3
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ color: 'var(--list-summary)' }}
          >
            {t('preferences.branding.appName')}
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setAppTitle(titleDraft)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setAppTitle(titleDraft); e.currentTarget.blur(); } }}
              placeholder="FriRSS"
              maxLength={30}
              className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
            />
            {titleDraft !== 'FriRSS' && (
              <button
                onClick={() => { setTitleDraft('FriRSS'); setAppTitle('FriRSS'); }}
                className="px-3 py-2 text-xs rounded-lg transition-colors hover:bg-black/5"
                style={{ color: 'var(--list-summary)' }}
                title={t('preferences.branding.appNameResetTooltip')}
              >
                {t('preferences.branding.appNameReset')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Logo */}
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.branding.logo')}
        </h3>
        <p className="text-xs mb-1" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.branding.logoHint')}
        </p>
        <p className="text-[11px] mb-3" style={{ color: 'var(--list-summary)', opacity: 0.8 }}>
          {t('preferences.branding.logoSizeHint')}
        </p>
        <div className="flex items-center gap-3">
          {appLogo && (
            <img
              src={appLogo}
              alt={t('preferences.branding.currentLogo')}
              className="w-12 h-12 rounded-lg object-contain border"
              style={{ borderColor: 'var(--panel-border)' }}
            />
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
          />
          <button
            onClick={() => logoInputRef.current?.click()}
            className="px-4 py-2 text-xs font-medium rounded-lg transition-colors"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            {appLogo ? t('preferences.branding.changeLogo') : t('preferences.branding.chooseLogo')}
          </button>
          {appLogo && (
            <button
              onClick={() => { setAppLogo(null); setLogoUrlDraft(''); }}
              className="px-3 py-2 text-xs rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-summary)' }}
              title={t('preferences.branding.resetLogoTooltip')}
            >
              {t('preferences.branding.resetLogo')}
            </button>
          )}
        </div>

        {/* Logo display mode — only relevant once a logo is set */}
        {appLogo && (
          <div className="mt-3">
            <p className="text-xs mb-1.5" style={{ color: 'var(--list-summary)' }}>
              {t('preferences.branding.logoDisplay')}
            </p>
            <div className="flex gap-1.5">
              {(['small', 'large'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLogoMode(m)}
                  className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                  style={{
                    background: logoMode === m ? 'var(--accent)' : 'var(--panel-header-bg)',
                    color: logoMode === m ? '#fff' : 'var(--list-title)',
                    border: logoMode === m ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                  }}
                >
                  {m === 'small' ? t('preferences.branding.logoCompact') : t('preferences.branding.logoFull')}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--list-summary)' }}>
              {t('preferences.branding.logoModeHint')}
            </p>
          </div>
        )}

        {/* Logo by URL */}
        <div className="mt-3">
          <p className="text-xs mb-2" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.branding.logoUrlHint')}
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={logoUrlDraft}
              onChange={(e) => setLogoUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { applyLogoUrl(); e.currentTarget.blur(); } }}
              placeholder="https://exemple.com/logo.png"
              className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
            />
            <button
              onClick={applyLogoUrl}
              disabled={!logoUrlDraft.trim()}
              className="px-4 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {t('preferences.branding.applyLogoUrl')}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

function GeneralTab() {
  const { t } = useTranslation();
  const confirmMarkAllRead = useUiStore((s) => s.confirmMarkAllRead);
  const setConfirmMarkAllRead = useUiStore((s) => s.setConfirmMarkAllRead);
  const inlineVideos = useUiStore((s) => s.inlineVideos);
  const setInlineVideos = useUiStore((s) => s.setInlineVideos);
  return (
    <div className="space-y-6">
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.general.title')}
        </h3>
        {/* Confirm before "Mark all as read" */}
        <div className="flex items-start justify-between gap-4 select-none">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.general.confirmMarkAllRead')}
            <span className="block text-[11px] opacity-70 mt-0.5">
              {t('preferences.general.confirmMarkAllReadHint')}
            </span>
          </span>
          <span className="mt-0.5">
            <ToggleSwitch
              checked={confirmMarkAllRead}
              onChange={setConfirmMarkAllRead}
              ariaLabel={t('preferences.general.confirmMarkAllRead')}
            />
          </span>
        </div>

        {/* Play YouTube videos in the article (click-to-load facade) */}
        <div className="flex items-start justify-between gap-4 select-none mt-4">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.general.inlineVideos')}
            <span className="block text-[11px] opacity-70 mt-0.5">
              {t('preferences.general.inlineVideosHint')}
            </span>
          </span>
          <span className="mt-0.5">
            <ToggleSwitch
              checked={inlineVideos}
              onChange={setInlineVideos}
              ariaLabel={t('preferences.general.inlineVideos')}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
