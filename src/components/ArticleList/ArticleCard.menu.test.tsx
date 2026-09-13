// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ArticleCard from './ArticleCard';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('./SavedCategoryPicker', () => ({ default: () => null, SavedCategoryPicker: () => null }));

afterEach(cleanup);

const base = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

function renderCard() {
  const spies = { onSelect: vi.fn(), onOpenSource: vi.fn(), onOpenMenu: vi.fn() };
  const c = render(
    <ArticleCard
      article={base}
      showSource
      rowActions={DEFAULT_ROW_ACTIONS}
      active={false}
      onSelect={spies.onSelect}
      onToggleStar={() => {}}
      onToggleRead={() => {}}
      onToggleReadLater={() => {}}
      onOpenSource={spies.onOpenSource}
      onOpenMenu={spies.onOpenMenu}
    />,
  );
  return { ...spies, card: c.container.querySelector('[data-article-id="a1"]') as HTMLElement };
}

describe('ArticleCard — menu', () => {
  it('right-click opens the article menu at the pointer', () => {
    const { onOpenMenu, card } = renderCard();
    fireEvent.contextMenu(card, { clientX: 40, clientY: 50 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
  });

  it('middle click opens at the source without selecting', () => {
    const { onOpenSource, onSelect, card } = renderCard();
    card.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
