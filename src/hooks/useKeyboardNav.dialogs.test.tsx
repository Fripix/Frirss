// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { useKeyboardNav } from './useKeyboardNav';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';
import AddFeedDialog from '../components/Sidebar/AddFeedDialog';
import AddServerDialog from '../components/Preferences/servers/AddServerDialog';

function Harness() {
  useKeyboardNav();
  return null;
}

const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
const next = vi.fn();
let heard: Event[];
const onAi = (e: Event) => { heard.push(e); };

beforeEach(() => {
  localStorage.clear();
  useUiStore.getState().resetShortcuts();
  heard = [];
  next.mockClear();
  useAiStore.setState({
    config: { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 },
  });
  useFeedStore.setState({ selectedArticle: { id: 'a1', read: false } as never, selectNextArticle: next, subscriptions: [] } as never);
  window.addEventListener('frirss:ai-summarize', onAi);
  window.addEventListener('frirss:ai-translate', onAi);
});
afterEach(() => {
  window.removeEventListener('frirss:ai-summarize', onAi);
  window.removeEventListener('frirss:ai-translate', onAi);
  cleanup();
});

// Une fenêtre modale possède le clavier : `s` / `t` lancent des appels d'IA
// (peut-être payants) et les flèches changent l'article qu'elle recouvre. Le
// focus sur un de ses boutons ne doit rien y changer.
describe.each([
  ['AddFeedDialog', (onClose: () => void) => <AddFeedDialog onClose={onClose} />, 'addFeed.title'],
  ['AddServerDialog', (onClose: () => void) => <AddServerDialog onClose={onClose} onAdded={() => {}} />, 'servers.addTitle'],
])('%s ouverte', (_name, dialog, title) => {
  function open(onClose = vi.fn()) {
    render(<><Harness />{dialog(onClose)}</>);
    const button = screen.getAllByRole('button')[0];
    button.focus();
    return { onClose, button };
  }

  it('est une boîte modale nommée par son titre', () => {
    open();
    const box = screen.getByRole('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    const labelledBy = box.getAttribute('aria-labelledby');
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe(title);
  });

  it('coupe flèche bas, s et t, le focus sur un bouton', () => {
    const { button } = open();
    for (const key of ['ArrowDown', 's', 't']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(next).not.toHaveBeenCalled();
    expect(heard).toHaveLength(0);
  });

  it('se ferme à Échap, le focus sur un bouton', () => {
    const { onClose, button } = open();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
