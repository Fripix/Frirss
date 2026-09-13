// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
// Le rangement par catégorie ouvert par le clic droit sur l'étoile n'est pas sous test.
vi.mock('./SavedCategoryPicker', () => ({ default: () => null, SavedCategoryPicker: () => null }));

const base = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

function renderRow(viewMode: string, withMenu = true) {
  const spies = { onSelect: vi.fn(), onOpenSource: vi.fn(), onOpenMenu: vi.fn() };
  const c = render(
    <ArticleRow
      article={base}
      viewMode={viewMode}
      showSource
      rowActions={DEFAULT_ROW_ACTIONS}
      active={false}
      onSelect={spies.onSelect}
      onToggleStar={() => {}}
      onToggleRead={() => {}}
      onToggleReadLater={() => {}}
      onOpenSource={spies.onOpenSource}
      onOpenMenu={withMenu ? spies.onOpenMenu : undefined}
    />,
  );
  const row = c.container.querySelector('[data-article-id="a1"]') as HTMLElement;
  return { ...spies, c, row };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

for (const viewMode of ['compact', 'normal']) {
  describe(`ArticleRow (${viewMode}) — menu`, () => {
    it('right-click opens the article menu at the pointer', () => {
      const { onOpenMenu, row } = renderRow(viewMode);
      fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
      expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
    });

    it("right-click on the Star button keeps that button's own gesture", () => {
      const { onOpenMenu, c } = renderRow(viewMode);
      const star = c.getByTitle('articleRow.addStar — saved.holdHint');
      fireEvent.contextMenu(star, { clientX: 5, clientY: 5 });
      expect(onOpenMenu).not.toHaveBeenCalled();
    });

    it('middle click opens at the source without selecting', () => {
      const { onOpenSource, onSelect, row } = renderRow(viewMode);
      row.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      expect(onOpenSource).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('long press opens the menu and the release does not select', () => {
      const { onOpenMenu, onSelect, row } = renderRow(viewMode);
      fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      fireEvent.touchEnd(row);
      fireEvent.click(row);
      expect(onOpenMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('a plain click still selects the article', () => {
      const { onSelect, row } = renderRow(viewMode);
      fireEvent.click(row);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('without onOpenMenu, the browser keeps its own menu', () => {
      const { row } = renderRow(viewMode, false);
      expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })).toBe(true);
    });
  });
}
