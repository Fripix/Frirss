import { useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLanguage } from '../../i18n';
import { useUiStore, shortcutActions } from '../../stores/uiStore';
import ToggleSwitch from '../ToggleSwitch';

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const confirmMarkAllRead = useUiStore((s) => s.confirmMarkAllRead);
  const setConfirmMarkAllRead = useUiStore((s) => s.setConfirmMarkAllRead);
  const inlineVideos = useUiStore((s) => s.inlineVideos);
  const setInlineVideos = useUiStore((s) => s.setInlineVideos);
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
    <div className="space-y-5">
      {/* Reading behaviour */}
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

      {/* Language */}
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.branding.language')}
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
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
              lang={lang.code}
              onClick={async () => {
                await loadLanguage(lang.code);
                i18n.changeLanguage(lang.code);
                localStorage.setItem('frirss_language', lang.code);
              }}
              aria-pressed={i18n.language === lang.code}
              aria-label={lang.name}
              title={lang.name}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs min-h-[44px]"
              style={{
                border: `1px solid ${i18n.language === lang.code ? 'var(--accent)' : 'var(--panel-border)'}`,
                background: i18n.language === lang.code ? 'var(--list-selected)' : 'transparent',
                color: 'var(--list-title)',
                fontWeight: i18n.language === lang.code ? 600 : 400,
              }}
            >
              <span aria-hidden="true" className="text-base leading-none flex-shrink-0">{lang.flag}</span>
              <span aria-hidden="true">{lang.code.toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts */}
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
            // items-start (not center): the label can wrap to two lines in
            // several locales, and centering would leave the badge sitting
            // off to the side instead of level with the first line.
            <div key={label} className="flex items-start justify-between gap-3 py-1.5 px-2 rounded-md">
              <span className="text-xs flex-1 min-w-0 leading-relaxed" style={{ color: 'var(--reading-text)' }}>
                {label}
              </span>
              <span
                className="flex-shrink-0 whitespace-nowrap text-center text-xs font-mono px-3 py-1 rounded-md"
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
    </div>
  );
}
