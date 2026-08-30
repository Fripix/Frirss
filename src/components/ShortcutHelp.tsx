import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore, shortcutGroups } from '../stores/uiStore';
import { useThemeStore } from '../stores/themeStore';

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': '␣',
  Escape: 'Esc',
  Enter: '↵',
  Backspace: '⌫',
  Tab: 'Tab',
};

function formatKey(key: string): string {
  return KEY_NAMES[key] || key.toUpperCase();
}

/**
 * Aide-mémoire des raccourcis, sur `?`.
 *
 * Les raccourcis étaient réassignables et documentés dans les Préférences,
 * mais rien ne les montrait au moment où on en a besoin. Les touches affichées
 * sont celles **réellement configurées**, pas les valeurs d'usine.
 *
 * Les gestes intégrés (Échap, double-clic, clic prolongé) ne sont pas
 * réassignables et vivent dans une section à part : les mélanger laisserait
 * croire qu'on peut les changer.
 */
export default function ShortcutHelp() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.shortcutHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutHelpOpen);
  const shortcuts = useUiStore((s) => s.shortcuts);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    // `capture` : la fenêtre doit consommer Échap avant le gestionnaire global,
    // qui s'en sert pour quitter le mode Focus.
    document.addEventListener('keydown', onKey, true);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  if (!open) return null;

  // Tous les raccourcis configurables, pas seulement ceux de la barre du bas :
  // elle n'en montre que ceux du contexte courant, et `toggleSidebar` n'y
  // figure dans aucun des deux groupes. L'ordre des groupes d'abord, pour la
  // lisibilité, puis le reste.
  const grouped = [...new Set([...shortcutGroups.list, ...shortcutGroups.reading])];
  const actions = [...grouped, ...Object.keys(shortcuts).filter((a) => !grouped.includes(a))];

  // Libellés repris de la section « Gestes et touches intégrés » des
  // Préférences : les mêmes gestes, donc les mêmes chaînes. En dupliquer des
  // variantes aurait laissé les deux écrans diverger.
  const gestures: Array<[string, string]> = [
    [t('preferences.shortcuts.keyEscape'), t('preferences.shortcuts.escExitFocus')],
    [t('preferences.shortcuts.keyDoubleClick'), t('preferences.shortcuts.doubleClickFocus')],
    [t('preferences.shortcuts.keyHold'), t('preferences.shortcuts.holdToFile')],
    ['?', t('preferences.shortcuts.gestureHelp')],
  ];

  return createPortal(
    <div
      className="shortcut-help-backdrop"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('preferences.shortcuts.helpTitle')}
        className="shortcut-help"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcut-help__head">
          <h2>{t('preferences.shortcuts.helpTitle')}</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('toast.dismiss')}
            title={t('toast.dismiss')}
            className="shortcut-help__close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="shortcut-help__body">
          <ul className="shortcut-help__list">
            {actions.map((action) => (
              <li key={action}>
                <kbd>{formatKey(shortcuts[action])}</kbd>
                <span>{t(`preferences.shortcuts.${action}`)}</span>
              </li>
            ))}
          </ul>

          <h3>{t('preferences.shortcuts.builtInTitle')}</h3>
          <ul className="shortcut-help__list">
            {gestures.map(([key, label]) => (
              <li key={label}>
                <kbd>{key}</kbd>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="shortcut-help__customize"
          onClick={() => { setOpen(false); openPreferences('general'); }}
        >
          {t('preferences.shortcuts.customize')}
        </button>
      </div>
    </div>,
    document.body
  );
}
