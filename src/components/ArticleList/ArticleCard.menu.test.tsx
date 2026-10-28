// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ArticleCard from './ArticleCard';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
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
  return { ...spies, card: c.container.querySelector('[data-article-id="a1"]') as HTMLElement, titleLink: c.container.querySelector('.article-card__title a') as HTMLAnchorElement | null };
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

  it("clic droit sur le titre : le menu de l'article, pas le menu natif du lien", () => {
    const { titleLink, onOpenMenu } = renderCard();
    expect(fireEvent.contextMenu(titleLink!, { clientX: 12, clientY: 34 })).toBe(false);
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it("appui long parti du titre (un lien) : le menu s'ouvre, le relâchement ne suit pas le lien", () => {
    vi.useFakeTimers();
    try {
      const { titleLink, onOpenMenu, onSelect } = renderCard();
      expect(titleLink).not.toBeNull();
      fireEvent.touchStart(titleLink!, { touches: [{ clientX: 20, clientY: 30 }] });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      fireEvent.touchEnd(titleLink!);
      expect(fireEvent.click(titleLink!)).toBe(false);
      expect(onOpenMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});


// Une image qui ne charge pas (URL expirée, serveur qui refuse) laissait une
// case vide, là où une carte sans image montre l'initiale du flux.
describe('vignette en échec', () => {
  it('montre l’initiale du flux, comme une carte sans image', () => {
    const article = { ...base, content: '<img src="https://example.com/gone.jpg"><p>body</p>' } as Article;
    const c = render(
      <ArticleCard article={article} showSource rowActions={DEFAULT_ROW_ACTIONS} active={false}
        onSelect={() => {}} onToggleStar={() => {}} onToggleRead={() => {}} onToggleReadLater={() => {}} onOpenSource={() => {}} />,
    );
    const img = c.container.querySelector('.article-card__thumb img') as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(c.container.querySelector('.article-card__thumb img')).toBeNull();
    expect(c.container.querySelector('.article-card__fallback')?.textContent).toBe('T');
  });
});
