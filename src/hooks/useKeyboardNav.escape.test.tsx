// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const store = vi.hoisted(() => ({
  selectedArticle: { id: 'a1', read: false } as { id: string; read: boolean } | null,
  selectedFeed: null,
  selectArticle: vi.fn(),
}));
vi.mock('../stores/feedStore', () => ({
  useFeedStore: Object.assign((sel: (s: unknown) => unknown) => sel(store), { getState: () => store }),
  READ_LATER_LABEL: 'user/-/label/Read later',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { useKeyboardNav } from './useKeyboardNav';
import { useUiStore } from '../stores/uiStore';

function Harness() {
  useKeyboardNav();
  return null;
}

/**
 * Échap fermait les Préférences ET l'article ouvert en grille (2026-11-05).
 *
 * Dans un vrai navigateur, une touche frappée par l'utilisateur vide la file
 * des microtâches entre deux écouteurs : les Préférences se ferment dans le
 * gestionnaire React, React rend aussitôt, la boîte quitte le DOM, et quand
 * l'événement atteint `window`, la garde « une boîte est ouverte » ne voit
 * plus rien. Un `dispatchEvent` de test ne vide la file qu'à la fin : la
 * boîte était encore là, le test passait, le bug restait.
 *
 * Ici, l'écouteur de `document` joue ce que voit `window` dans le navigateur :
 * Échap déjà traité (`preventDefault`), plus aucune boîte à l'écran.
 */
describe('Échap déjà traité par une surface qui vient de se fermer', () => {
  const handledElsewhere = (e: KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault(); };

  beforeEach(() => {
    store.selectArticle.mockClear();
    useUiStore.setState({ panelLayout: 'grid', readingFocus: false });
    document.addEventListener('keydown', handledElsewhere);
  });
  afterEach(() => {
    document.removeEventListener('keydown', handledElsewhere);
    cleanup();
  });

  it('ne referme pas l’article ouvert en grille', () => {
    render(<Harness />);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(store.selectArticle).not.toHaveBeenCalled();
  });

  it('ne quitte pas le mode Focus', () => {
    useUiStore.setState({ readingFocus: true });
    render(<Harness />);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(useUiStore.getState().readingFocus).toBe(true);
  });

  it('un Échap que personne n’a traité referme toujours l’article', () => {
    document.removeEventListener('keydown', handledElsewhere);
    render(<Harness />);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(store.selectArticle).toHaveBeenCalledWith(null);
  });
});
