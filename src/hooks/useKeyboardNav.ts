import { useEffect } from 'react';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';
import { effectiveLayout } from '../lib/effectiveLayout';

export function useKeyboardNav(): void {
  const shortcuts = useUiStore((s) => s.shortcuts);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
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

      // In grid layout, Escape closes the reader overlay and returns to the grid.
      const ui = useUiStore.getState();
      const layout = effectiveLayout(ui.panelLayout, ui.feedSettings, useFeedStore.getState().selectedFeed?.id);
      if (e.key === 'Escape'
          && layout === 'grid'
          && useFeedStore.getState().selectedArticle) {
        e.preventDefault();
        useFeedStore.getState().selectArticle(null);
        return;
      }

      const key = e.key;

      // Aide-mémoire des raccourcis. Placé avant les raccourcis configurables :
      // `?` n'est pas réassignable, et le laisser en dernier permettrait de le
      // masquer en l'attribuant à une action.
      if (key === '?') {
        e.preventDefault();
        useUiStore.getState().setShortcutHelpOpen(!useUiStore.getState().shortcutHelpOpen);
        return;
      }

      const store = useFeedStore.getState();

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
        if (store.selectedArticle?.url) {
          window.open(store.selectedArticle.url, '_blank');
        }
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
        // Ask the list to open its search. Focusing the input directly could
        // never work: it is only rendered once the search is already open.
        window.dispatchEvent(new CustomEvent('frirss:open-search'));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, toggleSidebar]);
}
