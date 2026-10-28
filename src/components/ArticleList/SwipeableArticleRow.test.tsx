// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import SwipeableArticleRow from './SwipeableArticleRow';
import { ArticleRow, MobileArticleRow } from './ArticleList';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('./SavedCategoryPicker', () => ({ default: () => <div data-testid="picker" /> }));

const at = (x: number, y = 100) => ({ touches: [{ clientX: x, clientY: y }] });

/** Un doigt posé en (100, 100), puis déplacé pas à pas jusqu'à `toX`. */
function drag(el: Element, toX: number, toY = 100) {
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    fireEvent.touchMove(el, at(100 + ((toX - 100) * i) / steps, 100 + ((toY - 100) * i) / steps));
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('SwipeableArticleRow', () => {
  function setup(props: { swipeBlocked?: () => boolean; onSwipeDecided?: () => void } = {}) {
    const spies = { left: vi.fn(), right: vi.fn() };
    const c = render(
      <SwipeableArticleRow onSwipeLeft={spies.left} onSwipeRight={spies.right} {...props}>
        <div data-testid="content">row</div>
      </SwipeableArticleRow>,
    );
    return { ...spies, content: c.getByTestId('content') };
  }

  it('a swipe to the left past the threshold fires the left action', () => {
    const { left, right, content } = setup();
    fireEvent.touchStart(content, at(100));
    drag(content, 0);
    fireEvent.touchEnd(content);
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
  });

  it('a swipe to the right past the threshold fires the right action', () => {
    const { left, right, content } = setup();
    fireEvent.touchStart(content, at(100));
    drag(content, 200);
    fireEvent.touchEnd(content);
    expect(right).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
  });

  it('a short swipe, under the threshold, fires nothing', () => {
    const { left, right, content } = setup();
    fireEvent.touchStart(content, at(100));
    drag(content, 50);
    fireEvent.touchEnd(content);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('a vertical move is a scroll: nothing fires', () => {
    const { left, right, content } = setup();
    fireEvent.touchStart(content, at(100));
    drag(content, 100, 250);
    fireEvent.touchEnd(content);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('reports the decision as soon as the direction is decided, once', () => {
    const onSwipeDecided = vi.fn();
    const { content } = setup({ onSwipeDecided });
    fireEvent.touchStart(content, at(100));
    fireEvent.touchMove(content, at(105));
    expect(onSwipeDecided).not.toHaveBeenCalled();
    fireEvent.touchMove(content, at(109));
    expect(onSwipeDecided).toHaveBeenCalledTimes(1);
    drag(content, 0);
    expect(onSwipeDecided).toHaveBeenCalledTimes(1);
  });

  it('a blocked swipe fires nothing, however far it goes', () => {
    const { left, right, content } = setup({ swipeBlocked: () => true });
    fireEvent.touchStart(content, at(100));
    drag(content, 0);
    fireEvent.touchEnd(content);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });
});

describe('a list row on a phone: long press and swipe exclude each other', () => {
  const article = {
    id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
    content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
    read: false, starred: false, labels: [],
  } as unknown as Article;

  function setup() {
    const spies = { left: vi.fn(), right: vi.fn(), onOpenMenu: vi.fn(), onSelect: vi.fn() };
    const c = render(
      <MobileArticleRow onSwipeLeft={spies.left} onSwipeRight={spies.right}>
        <ArticleRow
          article={article}
          viewMode="normal"
          showSource
          rowActions={DEFAULT_ROW_ACTIONS}
          active={false}
          onSelect={spies.onSelect}
          onToggleStar={() => {}}
          onToggleRead={() => {}}
          onToggleReadLater={() => {}}
          onOpenSource={() => {}}
          onOpenMenu={spies.onOpenMenu}
        />
      </MobileArticleRow>,
    );
    const row = c.container.querySelector('[data-article-id="a1"]') as HTMLElement;
    return {
      ...spies,
      row,
      star: c.getByTitle('articleRow.addStar — saved.holdHint'),
      later: c.getByTitle('articleRow.addReadLater — saved.holdHint'),
      pickers: () => c.queryAllByTestId('picker'),
    };
  }

  it('once the menu opened, a horizontal drag of 100 px toggles neither read nor read-later', () => {
    const { left, right, onOpenMenu, row } = setup();
    fireEvent.touchStart(row, at(100));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    drag(row, 0);
    fireEvent.touchEnd(row);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('even when the finger stayed down long after the menu opened', () => {
    // Le menu s'ouvre à 500 ms ; un doigt qui reste posé deux secondes avant
    // de glisser dépasse la fenêtre d'écho, pas le contact.
    const { left, right, row } = setup();
    fireEvent.touchStart(row, at(100));
    vi.advanceTimersByTime(LONG_PRESS_MS + 2000);
    drag(row, 200);
    fireEvent.touchEnd(row);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('a swipe decided at 9 px before 500 ms cancels the long press: no menu', () => {
    const { onOpenMenu, row } = setup();
    fireEvent.touchStart(row, at(100));
    fireEvent.touchMove(row, at(109));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('a swipe decided at exactly the tolerance still cancels the long press', () => {
    // 8 px : la direction est décidée, alors que la tolérance de l'appui
    // long (« au-delà de 8 px ») ne l'annulerait pas à elle seule.
    const { onOpenMenu, row } = setup();
    fireEvent.touchStart(row, at(100));
    fireEvent.touchMove(row, at(108));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('a held finger with a little tremor still opens the menu, and the next swipe works again', () => {
    const { left, onOpenMenu, row } = setup();
    fireEvent.touchStart(row, at(100));
    fireEvent.touchMove(row, at(103, 102));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(row, at(100));
    drag(row, 0);
    fireEvent.touchEnd(row);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('a long press on the Star button, then a 100 px drag: the picker opens, neither read nor read-later toggles', () => {
    // `swipeBlocked` n'interrogeait que l'appui de la ligne, et un contact
    // parti d'un bouton n'arme pas celui-là.
    const { left, right, star, pickers } = setup();
    fireEvent.touchStart(star, at(100));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(pickers()).toHaveLength(1);
    drag(star, 0);
    fireEvent.touchEnd(star);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('a swipe decided at the tolerance from the Read later button cancels its long press', () => {
    const { later, pickers } = setup();
    fireEvent.touchStart(later, at(100));
    fireEvent.touchMove(later, at(108));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(pickers()).toHaveLength(0);
  });

  it('a released Star press does not block the next swipe on the row', () => {
    const { left, star, row } = setup();
    fireEvent.touchStart(star, at(100));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.touchEnd(star);
    fireEvent.touchStart(row, at(100));
    drag(row, 0);
    fireEvent.touchEnd(row);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('Chrome Android: the menu opened by an early contextmenu blocks the swipe at once', () => {
    // Entre le `contextmenu` (~491 ms) et le minuteur, l'appui n'avait pas
    // abouti : un glisser dans cette fenêtre balayait sous le menu ouvert.
    const { left, right, onOpenMenu, row } = setup();
    fireEvent.touchStart(row, at(100));
    vi.advanceTimersByTime(491);
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    drag(row, 0);
    fireEvent.touchEnd(row);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('Chrome Android: the native drag of a press on the Star button opens the picker, not a drag', () => {
    // Le drag natif part de la ligne (`draggable`), ancêtre de l'étoile.
    const { row, star, pickers } = setup();
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'all' };
    fireEvent.touchStart(star, at(100));
    vi.advanceTimersByTime(495);
    let notPrevented = true;
    act(() => { notPrevented = fireEvent.dragStart(row, { dataTransfer }); });
    fireEvent.touchCancel(star);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(notPrevented).toBe(false);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(pickers()).toHaveLength(1);
  });
});
