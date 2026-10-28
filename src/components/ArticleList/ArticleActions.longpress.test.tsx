// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ArticleRowActions } from './ArticleActions';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
// Le sélecteur lui-même a ses tests : ici, seul compte le fait qu'il s'ouvre.
vi.mock('./SavedCategoryPicker', () => ({
  default: ({ prefix }: { prefix: string }) => <div data-testid="picker">{prefix}</div>,
}));

const article = {
  id: 'a1', title: 'Hello', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

function setup() {
  const spies = { star: vi.fn(), later: vi.fn() };
  const c = render(
    <ArticleRowActions
      article={article}
      isReadLater={false}
      className=""
      settings={DEFAULT_ROW_ACTIONS}
      onToggleStar={spies.star}
      onToggleReadLater={spies.later}
      onOpenSource={() => {}}
      onToggleRead={() => {}}
    />,
  );
  return {
    ...spies,
    starBtn: c.getByTitle('articleRow.addStar — saved.holdHint'),
    laterBtn: c.getByTitle('articleRow.addReadLater — saved.holdHint'),
    pickers: () => c.queryAllByTestId('picker'),
  };
}

const at = { touches: [{ clientX: 10, clientY: 10 }] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('Star and Read later buttons — long press files the article', () => {
  it('a long press with the finger opens the picker, and the release does not toggle', () => {
    const { star, starBtn, pickers } = setup();
    fireEvent.touchStart(starBtn, at);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(fireEvent.touchEnd(starBtn)).toBe(false);
    fireEvent.click(starBtn);
    expect(pickers()).toHaveLength(1);
    expect(star).not.toHaveBeenCalled();
  });

  it('a short tap toggles, without opening the picker', () => {
    const { later, laterBtn, pickers } = setup();
    fireEvent.touchStart(laterBtn, at);
    fireEvent.touchEnd(laterBtn);
    fireEvent.click(laterBtn);
    expect(later).toHaveBeenCalledTimes(1);
    expect(pickers()).toHaveLength(0);
  });

  it('a few pixels of tremor do not cancel the press', () => {
    const { starBtn, pickers } = setup();
    fireEvent.touchStart(starBtn, at);
    fireEvent.touchMove(starBtn, { touches: [{ clientX: 14, clientY: 13 }] });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(pickers()).toHaveLength(1);
  });

  it('a scroll, a touchcancel or a second finger cancel it', () => {
    const { starBtn, pickers } = setup();
    fireEvent.touchStart(starBtn, at);
    fireEvent.touchMove(starBtn, { touches: [{ clientX: 10, clientY: 40 }] });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.touchStart(starBtn, at);
    fireEvent.touchCancel(starBtn);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.touchStart(starBtn, at);
    fireEvent.touchStart(starBtn, { touches: [{ clientX: 10, clientY: 10 }, { clientX: 50, clientY: 10 }] });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(pickers()).toHaveLength(0);
  });

  it('holding the primary mouse button opens the picker, and its click does not toggle', () => {
    const { star, starBtn, pickers } = setup();
    fireEvent.mouseDown(starBtn, { button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 1500); });
    fireEvent.mouseUp(starBtn, { button: 0 });
    fireEvent.click(starBtn);
    expect(pickers()).toHaveLength(1);
    expect(star).not.toHaveBeenCalled();
  });

  it('holding the right button does not arm the press', () => {
    const { starBtn, pickers } = setup();
    fireEvent.mouseDown(starBtn, { button: 2, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(pickers()).toHaveLength(0);
  });

  it('right-click opens the picker and keeps the browser menu closed', () => {
    const { laterBtn, pickers } = setup();
    expect(fireEvent.contextMenu(laterBtn)).toBe(false);
    expect(pickers()).toHaveLength(1);
  });

  it('the contextmenu Chrome Android sends after a long press is absorbed', () => {
    const { starBtn, pickers } = setup();
    fireEvent.touchStart(starBtn, at);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(fireEvent.contextMenu(starBtn)).toBe(false);
    expect(pickers()).toHaveLength(1);
  });
});
