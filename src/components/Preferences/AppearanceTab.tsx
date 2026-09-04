import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, SHIPPED_THEMES } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { TabResetButton } from './TabResetButton';
import ThemePreview from './ThemePreview';
import ToggleSwitch from '../ToggleSwitch';
import { hasRealHighlight, PREVIEW_ZONES } from './colorHighlight';

type Sub = 'theme' | 'colors' | 'sizes' | 'identity';

export default function AppearanceTab({ onHighlight, active = true }: { onHighlight: (key: string | null) => void; active?: boolean }) {
  const { t } = useTranslation();
  // La galerie de thèmes ouvre la section : c'est le geste le plus courant, et
  // le seul qui change tout d'un coup. Les 36 couleurs viennent après.
  const [sub, setSub] = useState<Sub>('theme');
  const SUBS: Sub[] = ['theme', 'colors', 'sizes', 'identity'];
  // Survol (transitoire) et sélection (persistante au clic/tap) — un seul
  // aperçu au sommet des sous-sections Couleurs et Tailles sert les deux.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  // Une seule couleur « montrée » à la fois, quelle que soit la façon dont on
  // l'a désignée. Hors de la sous-section Couleurs, plus rien n'est montré :
  // une épingle survivante encadrerait un élément sans légende pour le dire.
  const shown = sub === 'colors' ? (focusedKey ?? pinnedKey) : null;

  // L'encadrement de l'élément réel suit `shown`, pas les événements souris.
  // Branché sur le survol seul, il disparaissait dès que le pointeur quittait
  // la ligne épinglée — la légende affirmait alors un encadrement qui n'existait
  // plus — et au doigt, où le survol n'a pas lieu, il était inatteignable.
  // `active` : la section reste montée une fois visitée, pour que revenir
  // dessus soit instantané. L'encadrement ne peut donc plus dépendre du
  // démontage — sans ce garde, quitter Apparence avec une couleur épinglée
  // laissait le voile et le cadre pointillé à l'écran depuis une autre
  // section. Revenir sur la section rétablit l'encadrement épinglé.
  useEffect(() => {
    onHighlight(active ? shown : null);
  }, [shown, active, onHighlight]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  // Plein écran : le panneau couvre l'interface, il n'y a rien à encadrer
  // derrière lui. L'aperçu devient le seul retour possible.
  const isFullScreen = useBreakpoint() === 'mobile';

  return (
    <div>
      <div className="flex gap-1 mb-3.5" style={{ borderBottom: '1px solid var(--panel-border)' }}>
        {SUBS.map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            aria-current={sub === s ? 'true' : 'false'}
            className="px-2.5 py-2 text-xs -mb-px min-h-[44px]"
            style={{
              color: sub === s ? 'var(--list-title)' : 'var(--list-summary)',
              fontWeight: sub === s ? 600 : 400,
              borderBottom: `2px solid ${sub === s ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {t(`preferences.appearance.${s}`)}
          </button>
        ))}
      </div>
      {sub === 'theme' && <ThemeSection />}
      {sub === 'colors' && (
        <ColorsSection
          shown={shown}
          isFullScreen={isFullScreen}
          setFocusedKey={setFocusedKey}
          pinnedKey={pinnedKey}
          setPinnedKey={setPinnedKey}
        />
      )}
      {sub === 'sizes' && <SizesSection />}
      {sub === 'identity' && <IdentitySection />}
    </div>
  );
}

/* ── Theme sub-section — active theme, save, load, import/export ───── */

function ThemeSection() {
  const { t } = useTranslation();
  const {
    theme,
    savedThemes,
    setThemeName,
    saveCurrentTheme,
    loadSavedTheme,
    deleteSavedTheme,
    exportTheme,
    importTheme,
  } = useThemeStore();
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="space-y-5">
      <ThemePresets />
      <FollowSystem />

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
            className="px-3 py-1.5 text-xs font-medium rounded-md"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
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
              // Les thèmes livrés ne se suppriment pas : ils reviendraient au
              // chargement suivant, et « suivre le système » a besoin d'eux.
              const isDefault = SHIPPED_THEMES.some((sh) => sh.name === st.name);
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
  );
}

/* ── Préréglages livrés ─────────────────────────────────────────────
 * Le moteur de thèmes savait tout faire sauf proposer un point de départ :
 * atteindre un thème sombre demandait de régler 36 couleurs à la main.
 * Chaque vignette est un aperçu réel, peinte avec les couleurs du préréglage. */

function ThemePresets() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const loadSavedTheme = useThemeStore((s) => s.loadSavedTheme);

  return (
    <div>
      <h3
        className="text-[11px] font-bold uppercase tracking-widest mb-1"
        style={{ color: 'var(--list-summary)' }}
      >
        {t('preferences.themes.presets')}
      </h3>
      <p className="text-[11px] mb-2.5" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.themes.presetsHint')}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))' }}>
        {SHIPPED_THEMES.map((preset) => {
          const active = theme.name === preset.name;
          return (
            <button
              key={preset.name}
              onClick={() => loadSavedTheme(preset.name)}
              aria-pressed={active}
              className="prefs-tap-row rounded-lg overflow-hidden text-left transition-all"
              style={{
                border: active
                  ? '2px solid var(--accent)'
                  : '1px solid var(--panel-border)',
                boxShadow: active ? '0 0 0 3px var(--accent-glow)' : undefined,
              }}
            >
              {/* Aperçu : bande latérale + panneau, comme l'écran réel */}
              <div className="flex h-11" aria-hidden="true">
                <div
                  className="w-1/3 flex items-end p-1"
                  style={{ background: preset.colors['sidebar-bg'] }}
                >
                  <span
                    className="block w-full h-1 rounded-full"
                    style={{ background: preset.colors['accent'] }}
                  />
                </div>
                <div
                  className="flex-1 flex flex-col justify-center gap-1 px-1.5"
                  style={{ background: preset.colors['panel-bg'] }}
                >
                  <span
                    className="block h-1 w-4/5 rounded-full"
                    style={{ background: preset.colors['list-title'] }}
                  />
                  <span
                    className="block h-1 w-3/5 rounded-full"
                    style={{ background: preset.colors['list-summary'] }}
                  />
                </div>
              </div>
              <div
                className="px-1.5 py-1 text-[10px] font-semibold truncate"
                style={{
                  color: active ? 'var(--accent)' : 'var(--list-title)',
                  background: 'var(--panel-header-bg)',
                }}
              >
                {preset.name.replace(/^FriRSS /, '')}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Suivre le thème du système ─────────────────────────────────────── */

function FollowSystem() {
  const { t } = useTranslation();
  const savedThemes = useThemeStore((s) => s.savedThemes);
  const followSystem = useThemeStore((s) => s.followSystem);
  const lightThemeName = useThemeStore((s) => s.lightThemeName);
  const darkThemeName = useThemeStore((s) => s.darkThemeName);
  const setFollowSystem = useThemeStore((s) => s.setFollowSystem);
  const setSchemeTheme = useThemeStore((s) => s.setSchemeTheme);

  const selectStyle = {
    border: '1px solid var(--panel-border)',
    color: 'var(--list-title)',
    background: 'var(--panel-header-bg)',
  };

  return (
    <div>
      <div className="prefs-tap-row flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium" style={{ color: 'var(--list-title)' }}>
            {t('preferences.themes.followSystem')}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.themes.followSystemHint')}
          </p>
        </div>
        <ToggleSwitch
          checked={followSystem}
          onChange={setFollowSystem}
          ariaLabel={t('preferences.themes.followSystem')}
        />
      </div>

      {followSystem && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--list-summary)' }}>
              {t('preferences.themes.lightTheme')}
            </span>
            <select
              value={lightThemeName}
              onChange={(e) => setSchemeTheme('light', e.target.value)}
              className="px-2 py-1.5 text-xs rounded-md"
              style={selectStyle}
            >
              {savedThemes.map((st) => (
                <option key={st.name} value={st.name}>{st.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium" style={{ color: 'var(--list-summary)' }}>
              {t('preferences.themes.darkTheme')}
            </span>
            <select
              value={darkThemeName}
              onChange={(e) => setSchemeTheme('dark', e.target.value)}
              className="px-2 py-1.5 text-xs rounded-md"
              style={selectStyle}
            >
              {savedThemes.map((st) => (
                <option key={st.name} value={st.name}>{st.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/* ── Colors sub-section ──────────────────────────────────────────── */

// Color section definitions — titles and labels resolved via t() at render time
const COLOR_SECTIONS = [
  // L'accent en tête : c'est la couleur qui teinte toute l'interface — badges,
  // liens, états actifs, anneau de focus — donc celle qu'on vient changer en
  // premier. Elle était en troisième position, sous deux sections de réglages
  // fins de la barre latérale.
  {
    titleKey: 'accent',
    keys: ['accent', 'accent-dark'],
  },
  {
    titleKey: 'sidebar',
    keys: ['sidebar-bg', 'sidebar-header-from', 'sidebar-header-to', 'sidebar-text', 'sidebar-text-active', 'sidebar-category-text', 'sidebar-divider'],
  },
  {
    titleKey: 'topbar',
    keys: ['topbar-bg', 'topbar-text', 'topbar-text-active', 'topbar-track', 'topbar-seg-active'],
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

interface ColorsSectionProps {
  shown: string | null;
  isFullScreen: boolean;
  setFocusedKey: (key: string | null) => void;
  pinnedKey: string | null;
  setPinnedKey: (key: string | null) => void;
}
function ColorsSection({ shown, isFullScreen, setFocusedKey, pinnedKey, setPinnedKey }: ColorsSectionProps) {
  const { t } = useTranslation();
  const { theme, setColor, resetColors, resetColor, isColorModified } = useThemeStore();

  return (
    <div className="space-y-5">
      <div>
        <ThemePreview focusedKey={shown} />
        <p className="text-[11px] mb-3" style={{ color: 'var(--list-summary)' }}>
          {/* hasRealHighlight is checked before PREVIEW_ZONES: 16 of the 36 keys
              (topbar-*, list-hover, star-color…) have a real highlight but no
              preview-zone entry. Gating on PREVIEW_ZONES first would tell those
              users "neither mechanism shows it", which is false — the real
              element does light up.
              …sauf en plein écran : le panneau recouvre l'interface, donc
              l'encadrement réel n'existe pas. Ces 16 clés-là retombent alors sur
              previewNeither, et les 14 qui ont une zone gardent
              previewPreviewOnly — l'aperçu, lui, est bien visible. */}
          {!shown
            ? t('preferences.appearance.previewHint')
            : hasRealHighlight(shown) && !isFullScreen
              ? t('preferences.appearance.previewReal')
              : PREVIEW_ZONES[shown]
                ? t('preferences.appearance.previewPreviewOnly')
                : t('preferences.appearance.previewNeither')}
        </p>
      </div>
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
                isModified={isColorModified(key)}
                onReset={() => resetColor(key)}
                onFocus={setFocusedKey}
                pinned={pinnedKey === key}
                onTogglePin={() => setPinnedKey(pinnedKey === key ? null : key)}
                selectable={!isFullScreen}
              />
            ))}
          </div>
        </div>
      ))}
      <TabResetButton label={t('preferences.colors.resetColors')} onReset={resetColors} />
    </div>
  );
}

interface ColorRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colorKey: string;
  isModified?: boolean;
  onReset?: () => void;
  onFocus: (key: string | null) => void;
  pinned: boolean;
  onTogglePin: () => void;
  /** Desktop/tablet: hover previews, tap pins — both stay. Mobile: neither —
      the panel is full-screen there and the pin gesture read as an unwanted
      highlight-on-tap ("ça donne mal"), so the row is inert and the live
      preview thumbnail is the only feedback. */
  selectable: boolean;
}
function ColorRow({ label, value, onChange, colorKey, isModified, onReset, onFocus, pinned, onTogglePin, selectable }: ColorRowProps) {
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
      className="group flex items-center gap-2 py-1 px-1.5 -mx-1.5 rounded-md transition-colors hover:bg-black/[.03] prefs-tap-row"
      style={{ background: pinned ? 'var(--accent-glow)' : undefined }}
      onMouseEnter={selectable ? () => onFocus(colorKey) : undefined}
      onMouseLeave={selectable ? () => onFocus(null) : undefined}
      onClick={selectable ? onTogglePin : undefined}
    >
      <label className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--reading-text)' }}>
        {label}
        {isModified && (
          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ background: 'var(--accent)' }} />
        )}
      </label>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Remise à zéro — toujours rendue, sur tous les appareils, pour que
            l'affordance soit repérable même sur un thème encore intact (36
            lignes sans un seul indice, sinon). Désactivée et très effacée
            tant que la couleur n'a pas bougé, pleine opacité dès qu'elle
            diffère — l'état visuel ne ment jamais sur ce qu'un clic ferait. */}
        <button
          /* La ligne entière épingle la couleur : sans cette coupure, une
             remise à zéro épinglerait aussi, au moment où l'on vient de jeter
             la valeur. */
          onClick={(e) => { e.stopPropagation(); onReset?.(); }}
          disabled={!isModified}
          className={`p-0.5 rounded transition-all ${
            isModified ? 'opacity-60 hover:opacity-100 hover:bg-black/5' : 'opacity-20 cursor-default'
          }`}
          style={{ color: 'var(--list-summary)' }}
          title={t('preferences.colors.resetTooltip')}
          aria-label={t('preferences.colors.resetTooltip')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </button>
        <div className="relative">
          <input
            type="color"
            value={value?.startsWith('#') ? value : '#000000'}
            onChange={handlePickerChange}
            className="w-6 h-6 prefs-tap-swatch rounded cursor-pointer border-0 p-0"
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

/* ── Sizes sub-section ───────────────────────────────────────────── */

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

function SizesSection() {
  const { t } = useTranslation();
  const { theme, setFontSize, resetFontSizes } = useThemeStore();

  return (
    <div className="space-y-5">
      <ThemePreview focusedKey={null} />
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

/* ── Identity sub-section — app name & logo ──────────────────────── */

function IdentitySection() {
  const { t } = useTranslation();
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
              placeholder={t('preferences.branding.logoUrlPlaceholder')}
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
