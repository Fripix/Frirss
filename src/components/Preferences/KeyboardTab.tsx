import { useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { keyLabel } from '../../lib/keyLabel';
import { builtInGestures } from '../../lib/builtInGestures';
import { useUiStore, shortcutActions } from '../../stores/uiStore';
import ConfirmDialog from '../ConfirmDialog';
import { shortcutRefusal, type ShortcutRefusal } from '../../lib/shortcutKeys';
import { PrefCard, PrefHeading, PrefIntro } from './prefsUi';

/**
 * Préférences → Clavier : les raccourcis qu'on peut changer, puis les touches
 * et gestes fixes (la liste même de l'aide « ? »).
 */
export default function KeyboardTab() {
  const { t } = useTranslation();
  const { shortcuts, setShortcut, resetShortcuts } = useUiStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ShortcutRefusal | null>(null);
  // Les touches personnalisées se perdent : la réinitialisation se confirme.
  const [confirmReset, setConfirmReset] = useState(false);

  const handleKeyCapture = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!editing) return;
      // Avec ⌘, Ctrl ou Alt, la combinaison est celle du navigateur ou du
      // système, et le raccourci ne réagirait de toute façon jamais : on la
      // refuse sans `preventDefault`, le navigateur garde sa touche.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        setRefusal({ reason: 'reserved' });
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;
      if (key === 'Escape') {
        setEditing(null);
        setRefusal(null);
        return;
      }

      // Refusée : la capture reste ouverte pour essayer une autre touche.
      const refused = shortcutRefusal(key, editing, shortcuts);
      if (refused) {
        setRefusal(refused);
        return;
      }

      setShortcut(editing, key);
      setEditing(null);
      setRefusal(null);
    },
    [editing, shortcuts, setShortcut]
  );

  const formatKey = (key: string) => keyLabel(key, t);

  return (
      <div>
        <PrefHeading
          navLabel={t('preferences.navShort.shortcuts')}
          action={
            <button
              onClick={() => setConfirmReset(true)}
              aria-label={t('preferences.shortcuts.resetShortcuts')}
              title={t('preferences.shortcuts.resetShortcuts')}
              className="prefs-link"
            >
              {t('preferences.shortcuts.reset')}
            </button>
          }
        >
          {t('preferences.shortcuts.title')}
        </PrefHeading>
        <ConfirmDialog
          open={confirmReset}
          title={t('preferences.shortcuts.resetConfirmTitle')}
          message={t('preferences.shortcuts.resetConfirmMessage')}
          confirmLabel={t('preferences.shortcuts.reset')}
          danger
          onConfirm={() => { resetShortcuts(); setConfirmReset(false); }}
          onCancel={() => setConfirmReset(false)}
        />

        <PrefIntro>{t('preferences.shortcuts.hint')}</PrefIntro>

        <PrefCard>
          {shortcutActions.map((action) => (
            <div key={action} className="prefs-row-wrap">
              <div className="prefs-row flex items-center justify-between gap-3">
                <span className="prefs-label">
                  {t(`preferences.shortcuts.${action}`)}
                </span>
                <button
                  onClick={() => { setEditing(action); setRefusal(null); }}
                  onKeyDown={editing === action ? handleKeyCapture : undefined}
                  className={`min-w-[60px] text-center text-[13px] font-mono px-3 py-1 rounded-md transition-all ${
                    editing === action
                      ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-glow)]'
                      : 'hover-tint'
                  }`}
                  style={{
                    border: '1px solid var(--panel-border)',
                    color: editing === action ? 'var(--accent)' : 'var(--list-title)',
                    background: editing === action ? 'var(--accent-glow)' : 'var(--panel-header-bg)',
                  }}
                  autoFocus={editing === action}
                  // Sans nom, le bouton s'annonçait par la seule touche (« R, bouton ») :
                  // l'action lue juste avant n'est pas son libellé.
                  aria-label={editing === action ? t('preferences.shortcuts.pressKey') : t('app.labelValue', {
                    label: t(`preferences.shortcuts.${action}`),
                    value: shortcuts[action] ? formatKey(shortcuts[action]) : t('preferences.shortcuts.unassigned'),
                  })}
                >
                  {editing === action ? '...' : shortcuts[action] ? formatKey(shortcuts[action]) : t('preferences.shortcuts.unassigned')}
                </button>
              </div>
              {editing === action && refusal && (
                <p role="alert" className="text-[13px] pb-2 -mt-1 text-right" style={{ color: 'var(--danger)' }}>
                  {refusal.reason === 'taken'
                    ? t('preferences.shortcuts.keyTaken', { action: t(`preferences.shortcuts.${refusal.action}`) })
                    : t('preferences.shortcuts.keyReserved')}
                </p>
              )}
            </div>
          ))}
        </PrefCard>

        {/* Built-in gestures / keys — not remappable, listed for discoverability. */}
        <div data-builtin-gestures>
          <PrefHeading navLabel={t('preferences.navShort.gestures')}>{t('preferences.shortcuts.builtInTitle')}</PrefHeading>
          <PrefCard>
          {/* La liste même de l'aide « ? » (A4). */}
          {builtInGestures(t).map(({ key: keyLabel, label }) => (
            // items-start (not center): the label can wrap to two lines in
            // several locales, and centering would leave the badge sitting
            // off to the side instead of level with the first line.
            <div key={label} data-gesture-key={keyLabel} data-gesture-label={label} className="prefs-row flex items-start justify-between gap-3">
              <span className="prefs-label flex-1 min-w-0">
                {label}
              </span>
              <span
                className="flex-shrink-0 whitespace-nowrap text-center text-[13px] font-mono px-3 py-1 rounded-md"
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
          </PrefCard>
        </div>
      </div>
  );
}
