import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../stores/uiStore';
import { useThemeStore } from '../stores/themeStore';
import { useFeedStore, READ_LATER_LABEL } from '../stores/feedStore';
import { rankCommands, type Command } from '../lib/commandPalette';

/**
 * Entrée unique : aller à un flux, une étiquette, une vue, ou lancer une
 * action. Ouverte par ⌘K / Ctrl+K.
 *
 * Avec soixante-et-onze flux, atteindre le bon demandait de dérouler la barre
 * latérale et de lire. Rien de nouveau n'est stocké : la palette assemble ce
 * que les stores contiennent déjà.
 */
export default function CommandPalette() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setPanelLayout = useUiStore((s) => s.setPanelLayout);
  const openPreferences = useThemeStore((s) => s.openPreferences);

  const subscriptions = useFeedStore((s) => s.subscriptions);
  const labels = useFeedStore((s) => s.labels);
  const unreadCounts = useFeedStore((s) => s.unreadCounts);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    if (!open) return [];
    const feedStore = useFeedStore.getState();
    const close = () => setOpen(false);
    const out: Command[] = [];

    // Vues fixes — l'équivalent des entrées du haut de la barre latérale.
    const views: Array<[string, string, () => void]> = [
      ['all', t('sidebar.allFeeds'), () => feedStore.selectView(null, 'all')],
      ['unread', t('sidebar.unread'), () => feedStore.selectView(null, 'unread')],
      ['starred', t('sidebar.starred'), () => feedStore.selectView(null, 'starred')],
      ['readlater', t('sidebar.readLater'), () => feedStore.selectView(null, 'readlater')],
    ];
    for (const [id, label, run] of views) {
      out.push({ id: `view:${id}`, label, group: 'views', run: () => { run(); close(); } });
    }

    // Catégories, dédupliquées : un flux les porte, elles ne sont pas listées
    // à part dans le store.
    const seenCategories = new Map<string, string>();
    for (const sub of subscriptions) {
      for (const category of sub.categories ?? []) {
        if (category.id && category.label) seenCategories.set(category.id, category.label);
      }
    }
    for (const [id, label] of seenCategories) {
      out.push({
        id: `cat:${id}`,
        label,
        group: 'categories',
        run: () => { feedStore.selectCategory({ id, label }); close(); },
      });
    }

    for (const sub of subscriptions) {
      const unread = unreadCounts[sub.id] || 0;
      out.push({
        id: `feed:${sub.id}`,
        label: sub.title,
        group: 'feeds',
        hint: unread ? String(unread) : undefined,
        run: () => { feedStore.selectView(sub); close(); },
      });
    }

    for (const label of labels) {
      if (label.id === READ_LATER_LABEL) continue;
      const name = label.id.split('/label/').pop() ?? label.id;
      out.push({
        id: `label:${label.id}`,
        label: name,
        group: 'labels',
        run: () => { feedStore.selectView({ id: label.id, title: name } as never); close(); },
      });
    }

    const actions: Array<[string, string, () => void]> = [
      ['search', t('articleList.search'), () => window.dispatchEvent(new CustomEvent('frirss:open-search'))],
      ['shortcuts', t('preferences.shortcuts.helpTitle'), () => useUiStore.getState().setShortcutHelpOpen(true)],
      ['layout2', t('articleList.listOnly'), () => setPanelLayout('2')],
      ['layout3', t('articleList.listAndReading'), () => setPanelLayout('3')],
      ['layoutGrid', t('articleList.gridLayout'), () => setPanelLayout('grid')],
      ['prefsGeneral', t('preferences.sections.general'), () => openPreferences('general')],
      ['prefsAppearance', t('preferences.sections.appearance'), () => openPreferences('appearance')],
      ['prefsFeeds', t('preferences.sections.feeds'), () => openPreferences('feeds')],
    ];
    for (const [id, label, run] of actions) {
      out.push({ id: `action:${id}`, label, group: 'actions', run: () => { close(); run(); } });
    }

    return out;
  }, [open, subscriptions, labels, unreadCounts, t, setOpen, setPanelLayout, openPreferences]);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  // Repartir du haut à chaque frappe : le curseur d'une liste précédente n'a
  // aucun sens sur la suivante.
  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Garder l'élément sous le curseur visible quand on descend au clavier.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[cursor]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  let lastGroup: string | null = null;

  return createPortal(
    <div className="palette-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="palette__input"
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[cursor] ? `palette-${results[cursor].id}` : undefined}
        />

        {results.length === 0 ? (
          <p className="palette__empty">{t('palette.empty')}</p>
        ) : (
          <ul className="palette__results" id="palette-results" role="listbox" ref={listRef}>
            {results.map((command, index) => {
              const groupChanged = command.group !== lastGroup;
              lastGroup = command.group;
              return (
                <li key={command.id}>
                  {groupChanged && (
                    <div className="palette__group" aria-hidden="true">
                      {t(`palette.group.${command.group}`)}
                    </div>
                  )}
                  <button
                    type="button"
                    id={`palette-${command.id}`}
                    role="option"
                    aria-selected={index === cursor}
                    data-active={index === cursor}
                    className="palette__item"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => command.run()}
                  >
                    <span className="palette__label">{command.label}</span>
                    {command.hint && <span className="palette__hint">{command.hint}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="palette__foot">{t('palette.navHint')}</p>
      </div>
    </div>,
    document.body
  );
}
