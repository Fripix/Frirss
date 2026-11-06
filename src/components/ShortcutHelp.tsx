import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore, shortcutGroups, AI_SHORTCUTS } from '../stores/uiStore';
import { useReturnFocus } from '../hooks/useReturnFocus';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useBackLayer } from '../hooks/useAndroidBack';
import { useThemeStore } from '../stores/themeStore';
import { useAiStore, aiUsable } from '../stores/aiStore';
import { keyLabel } from '../lib/keyLabel';
import { builtInGestures } from '../lib/builtInGestures';


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
  useReturnFocus(open);
  const shortcuts = useUiStore((s) => s.shortcuts);
  const aiAvailable = useAiStore(aiUsable);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  // Android : le retour ferme cette surface, elle seule (M-08).
  useBackLayer(open, () => setOpen(false));
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // `?` la referme aussi : le gestionnaire global, qui l'ouvre, se tait
      // tant qu'une boîte est ouverte — celle-ci comprise.
      if (e.key === 'Escape' || e.key === '?') {
        e.stopPropagation();
        e.preventDefault();
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
  const actions = [...grouped, ...Object.keys(shortcuts).filter((a) => !grouped.includes(a))]
    // Un raccourci pour une fonction éteinte n'est que du bruit.
    .filter((a) => !AI_SHORTCUTS.includes(a) || aiAvailable)
    // Une action sans touche (`''`) n'a rien à montrer : elle se règle dans les Préférences.
    .filter((a) => !!shortcuts[a]);

  // La liste même de la section « Gestes et touches intégrés » des
  // Préférences : deux listes tenues à part avaient divergé (A4).
  const gestures = builtInGestures(t);

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
          <h2 id={titleId}>{t('preferences.shortcuts.helpTitle')}</h2>
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

        {/* La liste défile. Chromium rend une telle zone focalisable de
            lui-même, pas Safari : sans `tabIndex`, la fin de la liste y
            restait inatteignable au clavier (les flèches font défiler la zone
            qui a le focus). */}
        <div className="shortcut-help__body" tabIndex={0} role="region" aria-labelledby={titleId}>
          <ul className="shortcut-help__list">
            {actions.map((action) => (
              <li key={action}>
                <kbd>{keyLabel(shortcuts[action], t)}</kbd>
                <span>{t(`preferences.shortcuts.${action}`)}</span>
              </li>
            ))}
          </ul>

          <h3>{t('preferences.shortcuts.builtInTitle')}</h3>
          <ul className="shortcut-help__list" data-builtin-gestures>
            {gestures.map(({ key, label }) => (
              <li key={label} data-gesture-key={key} data-gesture-label={label}>
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
