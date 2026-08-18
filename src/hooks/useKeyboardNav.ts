import { useEffect } from 'react';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';

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
      if (e.key === 'Escape'
          && useUiStore.getState().panelLayout === 'grid'
          && useFeedStore.getState().selectedArticle) {
        e.preventDefault();
        useFeedStore.getState().selectArticle(null);
        return;
      }

      const key = e.key;
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
        // Focus the search input
        const searchInput = document.querySelector<HTMLElement>('[data-search-input]');
        if (searchInput) searchInput.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, toggleSidebar]);
}
