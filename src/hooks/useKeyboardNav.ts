import { useEffect } from 'react';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';
import { openArchiveAware } from '../lib/archive';

export function useKeyboardNav(): void {
  const shortcuts = useUiStore((s) => s.shortcuts);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Palette de commandes — AVANT le filtre des champs de saisie : ⌘K doit
      // fonctionner même le curseur dans la recherche, c'est la convention.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
        return;
      }

      // Ignore when typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      // Escape leaves Reading Focus mode (only when active — otherwise let other
      // handlers, e.g. search / preferences, deal with Escape).
      if (e.key === 'Escape' && useUiStore.getState().readingFocus) {
        e.preventDefault();
        useUiStore.getState().setReadingFocus(false);
        return;
      }

      const key = e.key;
      const store = useFeedStore.getState();

      // Escape always closes the reader; the configured shortcut remains an
      // additional way to return to the list. A linked page consumes Escape first
      // in ReadingPane so the first press returns to the feed article.
      if ((key === shortcuts.backToList || key === 'Escape') && store.selectedArticle) {
        e.preventDefault();
        store.selectArticle(null);
        return;
      }

      // Aide-mémoire des raccourcis. Placé avant les raccourcis configurables :
      // `?` n'est pas réassignable, et le laisser en dernier permettrait de le
      // masquer en l'attribuant à une action.
      if (key === '?') {
        e.preventDefault();
        useUiStore.getState().setShortcutHelpOpen(!useUiStore.getState().shortcutHelpOpen);
        return;
      }

      if (key === shortcuts.nextArticle) {
        e.preventDefault();
        store.selectNextArticle();
      } else if (key === shortcuts.prevArticle) {
        e.preventDefault();
        store.selectPrevArticle();
      } else if (key === shortcuts.openArticle) {
        e.preventDefault();
        if (!store.selectedArticle) {
          // Select first article if none selected
          if (store.articles.length) store.selectArticle(store.articles[0]);
        }
        // In 2-panel mode, this naturally opens the article
      } else if (key === shortcuts.markUnread) {
        e.preventDefault();
        if (store.selectedArticle && store.selectedArticle.read) {
          store.toggleRead(store.selectedArticle);
        }
      } else if (key === shortcuts.toggleStar) {
        e.preventDefault();
        if (store.selectedArticle) {
          store.toggleStar(store.selectedArticle);
        }
      } else if (key === shortcuts.markRead) {
        e.preventDefault();
        if (store.selectedArticle && !store.selectedArticle.read) {
          store.toggleRead(store.selectedArticle);
        }
      } else if (key === shortcuts.openOriginal) {
        e.preventDefault();
        const linkedUrl = document.querySelector<HTMLElement>('[data-linked-page-url]')?.dataset.linkedPageUrl;
        openArchiveAware(linkedUrl || store.selectedArticle?.url);
      } else if (key === shortcuts.toggleSidebar) {
        e.preventDefault();
        toggleSidebar();
      } else if (key === shortcuts.readLater) {
        e.preventDefault();
        if (store.selectedArticle) {
          store.toggleReadLater(store.selectedArticle);
        }
      } else if (key === shortcuts.search) {
        e.preventDefault();
        if (store.selectedArticle) {
          // When reading, search inside the open article rather than the feed list.
          window.dispatchEvent(new CustomEvent('frirss:open-article-search'));
        } else {
          // With no open article, keep the existing feed-wide FriRSS search.
          window.dispatchEvent(new CustomEvent('frirss:open-search'));
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, toggleSidebar]);
}
