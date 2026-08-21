import { useState, useRef, useCallback, useEffect, useMemo, type ChangeEvent, type ReactNode, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLanguage } from '../../i18n';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore, shortcutActions } from '../../stores/uiStore';
import { useFeedStore } from '../../stores/feedStore';
import { useAuthStore } from '../../stores/authStore';
import ToggleSwitch from '../ToggleSwitch';
import type { Tag } from '../../types';
import RefreshTab from './RefreshTab';
import AdminTab from './AdminTab';
import OfflineTab from './OfflineTab';

interface HighlightRect { top: number; left: number; width: number; height: number }

// Label grouping item (Preferences labels tab)
interface PrefLabelChild { tag: Tag; leafName: string; fullName: string }
interface PrefLabelItem { type: 'single' | 'parent' | 'group'; tag?: Tag; name: string; children?: PrefLabelChild[] }

type DropPosition = 'before' | 'after' | 'onto';
interface DropTarget { id: string; position: DropPosition }

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

          {tab === 'labels' && <LabelsColorTab resetLabelColors={resetLabelColors} />}
          {tab === 'feeds' && <RefreshTab />}
          {tab === 'offline' && <OfflineTab />}

          {tab === 'admin' && isAdmin && <AdminTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tab-level reset button ─────────────────────────────────────────── */
function TabResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="pt-3 flex justify-end" style={{ borderTop: '1px solid var(--panel-border)' }}>
      <button
        onClick={() => {
          if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
          onReset();
          setConfirm(false);
        }}
        className="text-[11px] px-3 py-1.5 rounded-md transition-colors"
        style={{
          color: confirm ? '#fff' : 'var(--danger)',
          background: confirm ? 'var(--danger)' : 'var(--danger-light)',
        }}
      >
        {confirm ? t('preferences.confirm') : label}
      </button>
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

/**
 * Group labels by prefix (same logic as Sidebar) for hierarchical display.
 */
function groupLabelsForPrefs(labels: Tag[], labelOrder: string[] = [], sortAlpha = true): PrefLabelItem[] {
  const childrenByPrefix: Record<string, PrefLabelChild[]> = {};
  const flatByName: Record<string, { tag: Tag; name: string }> = {};

  labels.forEach((tag) => {
    const fullName = tag.id.split('/label/').pop();
    if (!fullName) return;
    const slashIdx = fullName.indexOf('/');
    if (slashIdx > 0) {
      const prefix = fullName.substring(0, slashIdx);
      if (!childrenByPrefix[prefix]) childrenByPrefix[prefix] = [];
      childrenByPrefix[prefix].push({ tag, leafName: fullName.substring(slashIdx + 1), fullName });
    } else {
      flatByName[fullName] = { tag, name: fullName };
    }
  });

  const result: PrefLabelItem[] = [];
  const allNames = new Set([...Object.keys(flatByName), ...Object.keys(childrenByPrefix)]);
  const sorted = [...allNames].sort();

  sorted.forEach((name) => {
    const flat = flatByName[name];
    const children = childrenByPrefix[name];
    if (flat && children) {
      result.push({ type: 'parent', tag: flat.tag, name: flat.name, children });
    } else if (children) {
      result.push({ type: 'group', name, children });
    } else if (flat) {
      result.push({ type: 'single', tag: flat.tag, name: flat.name });
    }
  });

  // Apply custom order
  if (!sortAlpha && labelOrder.length > 0) {
    result.sort((a, b) => {
      const aId = a.tag?.id || a.children?.[0]?.tag.id || '';
      const bId = b.tag?.id || b.children?.[0]?.tag.id || '';
      const ai = labelOrder.indexOf(aId);
      const bi = labelOrder.indexOf(bId);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    result.forEach((item) => {
      if (item.children) {
        item.children.sort((a, b) => {
          const ai = labelOrder.indexOf(a.tag.id);
          const bi = labelOrder.indexOf(b.tag.id);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
    });
  }

  return result;
}

function LabelsColorTab({ resetLabelColors }: { resetLabelColors: () => void }) {
  const { t } = useTranslation();
  const labels = useFeedStore((s) => s.labels);
  const renameLabel = useFeedStore((s) => s.renameLabel);
  const deleteLabel = useFeedStore((s) => s.deleteLabel);
  const loadLabelCounts = useFeedStore((s) => s.loadLabelCounts);
  const { labelColors, setLabelColor, toggleLabelInherit, removeLabelColor, getLabelColor, renameLabelColor } = useThemeStore();
  const { labelOrder, setLabelOrder, labelSortAlpha, setLabelSortAlpha, showLabelCounts, setShowLabelCounts } = useUiStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dropGroupTarget, setDropGroupTarget] = useState<string | null>(null); // group name being hovered ('' = standalone)

  const grouped = groupLabelsForPrefs(labels, labelOrder, labelSortAlpha);

  // Build flat list of all label IDs for drag-reorder
  const allLabelIds = labels.map((l) => l.id);

  // Collect all group names (for "move to" dropdown)
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    labels.forEach((tag) => {
      const fullName = tag.id.split('/label/').pop();
      if (!fullName) return;
      const slashIdx = fullName.indexOf('/');
      if (slashIdx > 0) names.add(fullName.substring(0, slashIdx));
      else names.add(fullName);
    });
    return [...names].sort();
  }, [labels]);

  // Resolve the parent of a label by its ID
  function getParentOf(labelId: string): string | null {
    const fullName = labelId.split('/label/').pop() ?? '';
    const slashIdx = fullName.indexOf('/');
    return slashIdx > 0 ? fullName.substring(0, slashIdx) : null;
  }

  // Move label to a different parent
  async function moveLabel(labelId: string, newParentName: string) {
    const fullName = labelId.split('/label/').pop() ?? '';
    const slashIdx = fullName.indexOf('/');
    const leafName = slashIdx > 0 ? fullName.substring(slashIdx + 1) : fullName;
    const currentParent = slashIdx > 0 ? fullName.substring(0, slashIdx) : null;

    if (newParentName === currentParent) return; // no change
    if (!newParentName && newParentName !== '') return;
    const newName = newParentName === '' ? leafName : `${newParentName}/${leafName}`;
    const newLabelId = `user/-/label/${newName}`;
    await renameLabel(labelId, newName);
    // Migrate label color entry to new ID
    renameLabelColor(labelId, newLabelId);
  }

  // Rename label + migrate color entry
  async function renameLabelWithColor(oldLabelId: string, newName: string) {
    const newLabelId = `user/-/label/${newName}`;
    const ok = await renameLabel(oldLabelId, newName);
    if (ok) renameLabelColor(oldLabelId, newLabelId);
    return ok;
  }

  // Delete label + remove color entry
  async function deleteLabelWithColor(labelId: string) {
    const ok = await deleteLabel(labelId);
    if (ok) removeLabelColor(labelId);
    return ok;
  }

  // Handle drop on a group header → move label into that group
  function handleGroupDrop(groupName: string) {
    if (!dragId) return;
    const currentParent = getParentOf(dragId);
    if (groupName === '' && currentParent === null) { cleanup(); return; }
    if (groupName === currentParent) { cleanup(); return; }
    moveLabel(dragId, groupName);
    cleanup();
  }

  function cleanup() {
    setDragId(null);
    setDropTarget(null);
    setDropGroupTarget(null);
  }

  // Unified drop handler: reorder (before/after) or nest (onto)
  function handleDrop(draggedId: string, targetId: string, position: DropPosition) {
    if (!draggedId || draggedId === targetId) { cleanup(); return; }

    // ── "onto" → nest the dragged label into the target's group ──
    if (position === 'onto') {
      const targetName = targetId.split('/label/').pop() ?? '';
      const targetSlash = targetName.indexOf('/');
      // If target is already a child, use its parent as group name
      const groupName = targetSlash > 0 ? targetName.substring(0, targetSlash) : targetName;
      // Don't nest into self
      const draggedName = draggedId.split('/label/').pop();
      if (groupName === draggedName) { cleanup(); return; }
      moveLabel(draggedId, groupName);
      cleanup();
      return;
    }

    // ── "before"/"after" → reorder ──
    const ids = labelOrder.length > 0 ? [...labelOrder] : allLabelIds;
    allLabelIds.forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx >= 0) ids.splice(fromIdx, 1);
    const toIdx = ids.indexOf(targetId);
    if (toIdx === -1) {
      ids.push(draggedId);
    } else {
      ids.splice(position === 'after' ? toIdx + 1 : toIdx, 0, draggedId);
    }
    setLabelOrder(ids);
    if (labelSortAlpha) setLabelSortAlpha(false);
    cleanup();
  }

  // Shared props for all LabelRow instances
  const dragProps = { dragId, setDragId, dropTarget, setDropTarget, onDrop: handleDrop, onDragCleanup: cleanup };

  if (labels.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.noLabels')}. {t('preferences.labels.noLabelsHint')}
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
    >
      {/* Sort toggle */}
      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.description')}
        </p>
        <div className="flex items-center gap-2 select-none flex-shrink-0">
          <ToggleSwitch checked={labelSortAlpha} onChange={setLabelSortAlpha} ariaLabel="A→Z" />
          <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--list-summary)' }}>
            A→Z
          </span>
        </div>
      </div>

      {/* Show article count per label */}
      <div className="flex items-center justify-between select-none">
        <span className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.labels.showCounts')}
        </span>
        <ToggleSwitch
          checked={showLabelCounts}
          onChange={(next) => {
            setShowLabelCounts(next);
            if (next) loadLabelCounts();
          }}
          ariaLabel={t('preferences.labels.showCounts')}
        />
      </div>

      {/* Standalone labels — always rendered to prevent layout shift during drag */}
      <div>
        <GroupDropHeader
          label={t('preferences.labels.simpleLabels')}
          groupName=""
          dragId={dragId}
          dropGroupTarget={dropGroupTarget}
          setDropGroupTarget={setDropGroupTarget}
          onGroupDrop={handleGroupDrop}
          getParentOf={getParentOf}
        />
        <div className="space-y-0.5">
          {grouped.filter((i) => i.type === 'single').map((item) => {
            const tag = item.tag!;
            return (
              <LabelRow
                key={tag.id}
                labelId={tag.id}
                name={item.name}
                color={labelColors[tag.id]?.color || ''}
                effectiveColor={getLabelColor(tag.id)}
                onChangeColor={(c) => setLabelColor(tag.id, c)}
                onRemoveColor={() => removeLabelColor(tag.id)}
                onRename={renameLabelWithColor}
                onDelete={deleteLabelWithColor}
                groupNames={groupNames}
                currentParent={null}
                onMoveToParent={(p) => moveLabel(tag.id, p)}
                draggable={!labelSortAlpha}
                {...dragProps}
              />
            );
          })}
        </div>
      </div>

      {/* Groups */}
      {grouped.filter((i) => i.type !== 'single').map((item) => {
        const parentId = item.type === 'parent' && item.tag ? item.tag.id : null;
        const parentEntry = parentId ? labelColors[parentId] : null;
        const parentColor = parentEntry?.color || '';
        const inheritEnabled = parentEntry?.inherit !== false;

        return (
          <div key={item.name}>
            <GroupDropHeader
              label={item.name}
              groupName={item.name}
              dragId={dragId}
              dropGroupTarget={dropGroupTarget}
              setDropGroupTarget={setDropGroupTarget}
              onGroupDrop={handleGroupDrop}
              getParentOf={getParentOf}
            />

            {/* Parent label */}
            {parentId && (
              <div className="space-y-0.5 mb-2">
                <LabelRow
                  labelId={parentId}
                  name={item.name}
                  isParent
                  color={parentColor}
                  effectiveColor={getLabelColor(parentId)}
                  onChangeColor={(c) => setLabelColor(parentId, c)}
                  onRemoveColor={() => removeLabelColor(parentId)}
                  onRename={renameLabelWithColor}
                  onDelete={deleteLabelWithColor}
                  groupNames={groupNames}
                  currentParent={null}
                  onMoveToParent={(p) => moveLabel(parentId, p)}
                  draggable={!labelSortAlpha}
                  {...dragProps}
                />
                {parentColor && (
                  <label className="flex items-center gap-2 pl-8 py-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inheritEnabled}
                      onChange={() => toggleLabelInherit(parentId)}
                      className="accent-[var(--accent)] w-3.5 h-3.5"
                    />
                    <span className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
                      {t('preferences.labels.applyToSub')}
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Child labels */}
            <div className="space-y-0.5 pl-3" style={{ borderLeft: `2px solid ${parentColor || 'var(--panel-border)'}` }}>
              {(item.children ?? []).map(({ tag, leafName }) => {
                const childEntry = labelColors[tag.id];
                const hasOwnColor = !!childEntry?.color;
                return (
                  <LabelRow
                    key={tag.id}
                    labelId={tag.id}
                    name={leafName}
                    color={childEntry?.color || ''}
                    effectiveColor={getLabelColor(tag.id)}
                    inherited={!hasOwnColor && inheritEnabled && !!parentColor}
                    onChangeColor={(c) => setLabelColor(tag.id, c)}
                    onRemoveColor={() => removeLabelColor(tag.id)}
                    onRename={renameLabelWithColor}
                    onDelete={deleteLabelWithColor}
                    groupNames={groupNames}
                    currentParent={item.name}
                    onMoveToParent={(p) => moveLabel(tag.id, p)}
                    draggable={!labelSortAlpha}
                    {...dragProps}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Reset label colors */}
      {Object.keys(labelColors).length > 0 && (
        <TabResetButton label={t('preferences.labels.resetColors')} onReset={resetLabelColors} />
      )}
    </div>
  );
}

/**
 * Group header that acts as a drop zone for dragging labels between groups.
 * Highlights with accent color when a label from another group is dragged over.
 */
interface GroupDropHeaderProps {
  label: string;
  groupName: string;
  dragId: string | null;
  dropGroupTarget: string | null;
  setDropGroupTarget: (name: string | null) => void;
  onGroupDrop: (groupName: string) => void;
  getParentOf: (labelId: string) => string | null;
}
function GroupDropHeader({ label, groupName, dragId, dropGroupTarget, setDropGroupTarget, onGroupDrop, getParentOf }: GroupDropHeaderProps) {
  const { t } = useTranslation();
  const isOver = dropGroupTarget === groupName;
  // Only show drop highlight if the dragged label is from a different group
  const isDifferentGroup = dragId && (() => {
    const parent = getParentOf(dragId);
    if (groupName === '') return parent !== null; // highlight standalone only if label has a parent
    return parent !== groupName; // highlight if label is NOT already in this group
  })();
  const showDropZone = dragId && isDifferentGroup;

  return (
    <h3
      className={`text-[11px] font-bold uppercase tracking-widest mb-2 px-2 -mx-2 rounded-md transition-all ${
        isOver && isDifferentGroup ? 'ring-2' : ''
      }`}
      style={{
        color: isOver && isDifferentGroup ? 'var(--accent)' : 'var(--list-summary)',
        background: isOver && isDifferentGroup ? 'var(--accent-glow)' : showDropZone ? 'var(--panel-header-bg)' : 'transparent',
        '--tw-ring-color': 'var(--accent)',
        padding: showDropZone ? '8px 8px' : '6px 8px',
        border: showDropZone && !isOver ? '1px dashed var(--list-summary)' : showDropZone && isOver ? '1px solid var(--accent)' : '1px solid transparent',
      } as CSSProperties}
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropGroupTarget(groupName);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (dropGroupTarget === groupName) setDropGroupTarget(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onGroupDrop(groupName);
      }}
    >
      {label}
      {showDropZone && !isOver && (
        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal opacity-50" style={{ color: 'var(--list-summary)' }}>
          ← {t('preferences.labels.dropHere')}
        </span>
      )}
      {isOver && isDifferentGroup && (
        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal" style={{ color: 'var(--accent)' }}>
          ← {t('preferences.labels.dropHere')}
        </span>
      )}
    </h3>
  );
}

interface LabelRowProps {
  labelId: string;
  name: string;
  color: string;
  effectiveColor: string | null;
  isParent?: boolean;
  inherited?: boolean;
  onChangeColor: (color: string) => void;
  onRemoveColor: () => void;
  onRename: (oldLabelId: string, newName: string) => Promise<boolean>;
  onDelete: (labelId: string) => Promise<boolean>;
  groupNames: string[];
  currentParent: string | null;
  onMoveToParent: (parent: string) => void;
  draggable: boolean;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (t: DropTarget | null) => void;
  onDrop: (draggedId: string, targetId: string, position: DropPosition) => void;
  onDragCleanup: () => void;
}
function LabelRow({
  labelId, name, color, effectiveColor, isParent, inherited,
  onChangeColor, onRemoveColor, onRename, onDelete,
  groupNames, currentParent, onMoveToParent,
  draggable, dragId, setDragId, dropTarget, setDropTarget, onDrop, onDragCleanup,
}: LabelRowProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'rename' | 'confirmDelete' | 'move' | null>(null);
  const [renameValue, setRenameValue] = useState(name);
  const displayColor = color || effectiveColor || 'var(--accent)';
  const isDragging = dragId === labelId;
  const isDropTarget = dropTarget?.id === labelId;

  if (mode === 'rename') {
    return (
      <div className="flex items-center gap-2 py-1 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <form
          className="flex-1 flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (renameValue.trim() && renameValue.trim() !== name) {
              await onRename(labelId, renameValue.trim());
            }
            setMode(null);
          }}
        >
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="flex-1 text-xs px-2 py-1 rounded border outline-none"
            style={{
              borderColor: 'var(--accent)',
              color: 'var(--list-title)',
              background: 'var(--panel-bg)',
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') setMode(null); }}
          />
          <button
            type="submit"
            className="p-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--accent)' }}
            title={t('preferences.labels.validate')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMode(null)}
            className="p-0.5 rounded transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
            title={t('preferences.labels.cancel')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </form>
      </div>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <span className="text-xs flex-1" style={{ color: 'var(--danger)' }}>
          {t('preferences.labels.confirmDelete', { name })}
        </span>
        <button
          onClick={async () => { await onDelete(labelId); setMode(null); }}
          className="px-2 py-0.5 rounded text-[10px] font-medium text-white"
          style={{ background: 'var(--danger)' }}
        >
          {t('preferences.labels.delete')}
        </button>
        <button
          onClick={() => setMode(null)}
          className="px-2 py-0.5 rounded text-[10px]"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.labels.cancel')}
        </button>
      </div>
    );
  }

  if (mode === 'move') {
    // Available targets: standalone (empty string) + all group names except current parent
    const targets = [{ value: '', label: t('preferences.labels.noParent') }];
    groupNames.forEach((g) => {
      if (g !== name && g !== currentParent) {
        targets.push({ value: g, label: g });
      }
    });

    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md" style={{ background: 'var(--panel-header-bg)' }}>
        <span className="text-xs" style={{ color: 'var(--list-summary)' }}>{t('preferences.labels.moveTo')}</span>
        <select
          autoFocus
          className="flex-1 text-xs px-2 py-1 rounded border outline-none"
          style={{
            borderColor: 'var(--accent)',
            color: 'var(--list-title)',
            background: 'var(--panel-bg)',
          }}
          onChange={(e) => {
            onMoveToParent(e.target.value);
            setMode(null);
          }}
          defaultValue="__none__"
        >
          <option disabled value="__none__">{t('preferences.labels.choose')}</option>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={() => setMode(null)}
          className="p-0.5 rounded transition-colors hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const isDropOnto = isDropTarget && dropTarget.position === 'onto';
  const isDropBefore = isDropTarget && dropTarget.position === 'before';
  const isDropAfter = isDropTarget && dropTarget.position === 'after';

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!dragId || dragId === labelId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        let position: DropPosition;
        if (h > 0 && y < h * 0.25) position = 'before';
        else if (h > 0 && y > h * 0.75) position = 'after';
        else position = 'onto';
        setDropTarget({ id: labelId, position });
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          if (dropTarget?.id === labelId) setDropTarget(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragId && dropTarget) {
          onDrop(dragId, dropTarget.id, dropTarget.position);
        }
      }}
    >
      {/* Drop indicator: line + dot (before/after) */}
      {(isDropBefore || isDropAfter) && (
        <div
          className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
          style={{ top: isDropBefore ? -1 : undefined, bottom: isDropAfter ? -1 : undefined }}
        >
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 -ml-1" style={{ background: 'var(--accent)' }} />
          <div className="flex-1 h-[3px] rounded-full" style={{ background: 'var(--accent)' }} />
        </div>
      )}

      {/* Row content */}
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md group transition-all ${
          isDragging ? 'opacity-30 scale-95' : isDropOnto ? 'ring-2' : 'hover:bg-black/[.03]'
        }`}
        style={isDropOnto ? ({
          background: 'var(--accent-glow)',
          '--tw-ring-color': 'var(--accent)',
        } as CSSProperties) : undefined}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', labelId);
          e.dataTransfer.effectAllowed = 'move';
          setDragId(labelId);
        }}
        onDragEnd={() => { if (onDragCleanup) onDragCleanup(); else { setDragId(null); setDropTarget(null); } }}
      >
        {/* Drag handle */}
        {draggable && (
          <svg className="w-4 h-4 flex-shrink-0 opacity-40 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'var(--list-summary)' }}>
            <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-12a2 2 0 10.001 4.001A2 2 0 0013 2zm0 6a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
          </svg>
        )}

        {/* Tag icon preview */}
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          style={{ color: displayColor, opacity: color ? 1 : 0.5 }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
        </svg>

        {/* Label name */}
        <span
          className={`flex-1 text-xs truncate ${isParent ? 'font-semibold' : ''}`}
          style={{ color: isDropOnto ? 'var(--accent)' : 'var(--reading-text)' }}
        >
          {name}
          {isDropOnto && (
            <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--accent)' }}>
              ← {t('preferences.labels.nestHere')}
            </span>
          )}
          {!isDropOnto && inherited && (
            <span className="ml-1 text-[10px] italic" style={{ color: 'var(--list-summary)' }}>
              ({t('preferences.labels.inherited')})
            </span>
          )}
        </span>

        {/* Actions: move + rename + delete (visible on hover) */}
        <button
          onClick={() => setMode('move')}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.moveTooltip')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </button>
        <button
          onClick={() => { setRenameValue(name); setMode('rename'); }}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-black/5"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.rename')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        </button>
        <button
          onClick={() => setMode('confirmDelete')}
          className="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 hover:bg-red-50"
          style={{ color: 'var(--danger, #ef4444)' }}
          title={t('preferences.labels.delete')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>

        {/* Color picker */}
        <LabelColorPicker
          color={color}
          effectiveColor={effectiveColor}
          onChangeColor={onChangeColor}
          onRemoveColor={onRemoveColor}
        />
      </div>
    </div>
  );
}

/* ── Label Color Picker — swatches + hex input ─────────────────────── */
const LABEL_SWATCHES = [
  // Row 1 — reds / pinks
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  // Row 2 — blues / purples
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  // Row 3 — neutrals / earth
  '#78716c', '#737373', '#71717a', '#6b7280',
  '#92400e', '#991b1b', '#1e3a5f', '#064e3b',
];

interface LabelColorPickerProps {
  color: string;
  effectiveColor: string | null;
  onChangeColor: (color: string) => void;
  onRemoveColor: () => void;
}
function LabelColorPicker({ color, effectiveColor, onChangeColor, onRemoveColor }: LabelColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(color || effectiveColor || '#4cd4a1');
  const [openUp, setOpenUp] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const displayColor = color || effectiveColor || 'var(--accent)';

  // Sync hex field when color prop changes
  useEffect(() => {
    setHex(color || effectiveColor || '#4cd4a1');
  }, [color, effectiveColor]);

  // Decide popover direction on open
  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 200);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function applyHex(v: string) {
    const clean = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      onChangeColor(clean.toLowerCase());
      setHex(clean.toLowerCase());
    }
  }

  return (
    <div className="relative flex items-center gap-0.5 flex-shrink-0">
      {/* Swatch button to toggle popover */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="w-5 h-5 rounded-md border cursor-pointer transition-transform hover:scale-110 flex-shrink-0"
        style={{
          background: displayColor,
          borderColor: color ? 'rgba(0,0,0,0.15)' : 'var(--panel-border)',
          opacity: color ? 1 : 0.5,
        }}
        title={t('preferences.labels.chooseColor')}
      />

      {/* Remove color button */}
      {color && (
        <button
          onClick={() => { onRemoveColor(); setOpen(false); }}
          className="p-0.5 rounded transition-colors hover:bg-black/10"
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.labels.removeColor')}
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Popover */}
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 rounded-lg shadow-xl border p-3 w-[220px]"
          style={{
            background: 'var(--panel-bg)',
            borderColor: 'var(--panel-border)',
            ...(btnRef.current ? (() => {
              const r = btnRef.current.getBoundingClientRect();
              return {
                left: Math.max(8, r.right - 220),
                ...(openUp
                  ? { bottom: window.innerHeight - r.top + 4 }
                  : { top: r.bottom + 4 }),
              };
            })() : {}),
          }}
        >
          {/* Swatches grid */}
          <div className="grid grid-cols-8 gap-1 mb-3">
            {LABEL_SWATCHES.map((sw) => (
              <button
                key={sw}
                onClick={() => { onChangeColor(sw); setHex(sw); }}
                className="w-5 h-5 rounded-md border transition-transform hover:scale-125"
                style={{
                  background: sw,
                  borderColor: (color || effectiveColor || '') === sw
                    ? 'var(--list-title)'
                    : 'rgba(0,0,0,0.1)',
                  boxShadow: (color || effectiveColor || '') === sw
                    ? '0 0 0 2px var(--panel-bg), 0 0 0 3px var(--list-title)'
                    : 'none',
                }}
                title={sw}
              />
            ))}
          </div>

          {/* Hex input + native picker */}
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md border flex-shrink-0 relative overflow-hidden cursor-pointer"
              style={{
                background: color || effectiveColor || '#4cd4a1',
                borderColor: 'rgba(0,0,0,0.1)',
              }}
              onClick={() => pickerRef.current?.click()}
              title={t('preferences.labels.customColor')}
            >
              <input
                ref={pickerRef}
                type="color"
                value={(color || effectiveColor || '#4cd4a1').startsWith('#') ? (color || effectiveColor || '#4cd4a1') : '#4cd4a1'}
                onChange={(e) => { onChangeColor(e.target.value); setHex(e.target.value); }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </div>
            <div className="flex-1 flex items-center rounded-md border overflow-hidden"
              style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-header-bg)' }}
            >
              <span className="pl-2 text-[11px] font-mono" style={{ color: 'var(--list-summary)' }}>#</span>
              <input
                type="text"
                value={hex.replace('#', '')}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                  setHex(`#${v}`);
                  if (v.length === 6) applyHex(`#${v}`);
                }}
                onBlur={() => applyHex(hex)}
                onKeyDown={(e) => { if (e.key === 'Enter') { applyHex(hex); e.currentTarget.blur(); } }}
                className="flex-1 text-[11px] font-mono px-1 py-1.5 bg-transparent outline-none"
                style={{ color: 'var(--list-title)' }}
                maxLength={6}
                placeholder="4cd4a1"
              />
            </div>
          </div>
        </div>
      )}
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
