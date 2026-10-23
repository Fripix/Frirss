import { useEffect } from 'react';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore, aiUsable } from '../stores/aiStore';
import { useUiStore } from '../stores/uiStore';
import { effectiveLayout } from '../lib/effectiveLayout';
import { openExternal } from '../lib/openExternal';

// Actions qui ne sont pas idempotentes : les rejouer défait ou multiplie.
const TOGGLE_ACTIONS = ['toggleStar', 'readLater', 'toggleSidebar', 'openOriginal'];

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

      // Ignore when typing in an input/textarea/contenteditable, or in a
      // focused <select> (its type-ahead picks options letter by letter).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Une boîte ouverte (préférences, confirmation, palette, feuille du bas,
      // aide-mémoire) possède le clavier : rien ne doit agir sur l'article
      // qu'elle recouvre — surtout pas `s`, qui peut lancer un appel payant
      // derrière les préférences, où le panneau de lecture reste monté. Un
      // simple bouton hors boîte, lui, garde les raccourcis : après un clic
      // dans la barre d'outils, le focus y reste, et j/k doivent suivre.
      // Seules les boîtes de l'app comptent : le corps d'un article
      // (`.article-content`, y compris l'aperçu du balayage) peut porter une
      // modale de newsletter en `role="dialog"`, que DOMPurify conserve — elle
      // coupait tous les raccourcis tant que l'article restait ouvert.
      if (Array.from(document.querySelectorAll('[role="dialog"]')).some((d) => !d.closest('.article-content'))) return;
      // Un menu (« Traduire en… », « Résumer avec… ») n'est pas une boîte,
      // mais quand le focus est sur une de ses entrées, il possède le clavier
      // lui aussi : `t` y lançait une traduction payante derrière le menu.
      if (target?.closest?.('[role="menu"]')) return;

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

      // Une touche tenue avec ⌘, Ctrl ou Alt appartient au navigateur ou au
      // système (⌘R recharge, Ctrl+L va à la barre d'adresse…) : on la laisse
      // passer sans `preventDefault`. Seul ⌘K, plus haut, fait exception.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      // Aide-mémoire des raccourcis. Placé avant les raccourcis configurables :
      // `?` n'est pas réassignable, et le laisser en dernier permettrait de le
      // masquer en l'attribuant à une action.
      if (key === '?') {
        if (e.repeat) return;
        e.preventDefault();
        useUiStore.getState().setShortcutHelpOpen(!useUiStore.getState().shortcutHelpOpen);
        return;
      }

      // Une touche maintenue se répète : les flèches doivent continuer de
      // défiler, mais une bascule ou une ouverture d'onglet ne doit pas se
      // rejouer à chaque répétition.
      if (e.repeat && TOGGLE_ACTIONS.some((a) => shortcuts[a] === key)) return;

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
        openExternal(store.selectedArticle?.url);
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
      } else if ((key === shortcuts.summarize || key === shortcuts.translate)
          && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
          && store.selectedArticle
          && aiUsable(useAiStore.getState())) {
        // Résumer (`s`) et traduire (`t`) partagent cette garde. Pas de `else`
        // nu : sans IA utilisable ou sans article, la touche n'appartient à
        // personne et doit rester disponible au navigateur. Les modificateurs
        // aussi : ⌘S / Ctrl+S est « Enregistrer », ⌘T / Ctrl+T un nouvel
        // onglet, et ne doivent ni être bloqués ni déclencher un appel
        // (peut-être payant). Une touche maintenue (`repeat`) n'en relance pas
        // un à chaque répétition.
        e.preventDefault();
        const event = key === shortcuts.summarize ? 'frirss:ai-summarize' : 'frirss:ai-translate';
        window.dispatchEvent(new CustomEvent(event));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, toggleSidebar]);
}
