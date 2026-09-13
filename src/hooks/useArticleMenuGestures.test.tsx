// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useArticleMenuGestures } from './useArticleMenuGestures';
import { LONG_PRESS_MS, type PressPoint } from './useLongPress';

function Harness({ onOpenMenu, onOpenSource, onSelect, onButtonContextMenu }: {
  onOpenMenu?: (p: PressPoint) => void;
  onOpenSource: () => void;
  onSelect: () => void;
  onButtonContextMenu: () => void;
}) {
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource);
  return (
    <div role="button" data-testid="row" {...gestures} onClick={onSelect}>
      <span>Hello</span>
      {/* Stands in for the Star button: its own right-click already calls preventDefault. */}
      <button type="button" onContextMenu={(e) => { e.preventDefault(); onButtonContextMenu(); }}>star</button>
    </div>
  );
}

function setup(withMenu = true) {
  const spies = { onOpenMenu: vi.fn(), onOpenSource: vi.fn(), onSelect: vi.fn(), onButtonContextMenu: vi.fn() };
  const c = render(<Harness {...spies} onOpenMenu={withMenu ? spies.onOpenMenu : undefined} />);
  return { ...spies, row: c.getByTestId('row'), button: c.getByRole('button', { name: 'star' }) };
}

function middleClick(el: Element) {
  return el.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('useArticleMenuGestures', () => {
  it('opens the menu at the pointer on right-click, and keeps the browser menu closed', () => {
    const { onOpenMenu, row } = setup();
    const notPrevented = fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(notPrevented).toBe(false);
  });

  it('opens under the row when the keyboard Menu key fired it', () => {
    const { onOpenMenu, row } = setup();
    row.getBoundingClientRect = () => ({ left: 7, bottom: 90, top: 60, right: 300, width: 293, height: 30, x: 7, y: 60, toJSON: () => ({}) }) as DOMRect;
    fireEvent.contextMenu(row, { clientX: 0, clientY: 0 });
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 7, y: 90 });
  });

  it('leaves a right-click the Star button already handled to that button', () => {
    const { onOpenMenu, onButtonContextMenu, button } = setup();
    fireEvent.contextMenu(button, { clientX: 5, clientY: 5 });
    expect(onButtonContextMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('without a menu, leaves the browser menu alone', () => {
    const { row } = setup(false);
    expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })).toBe(true);
  });

  it('opens the menu on a long press and does not select the article on release', () => {
    const { onOpenMenu, onSelect, row } = setup();
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onOpenMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a long press that starts on a button belongs to that button', () => {
    const { onOpenMenu, button } = setup();
    fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('absorbs the contextmenu Chrome Android sends right after a long press', () => {
    const { onOpenMenu, row } = setup();
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const notPrevented = fireEvent.contextMenu(row, { clientX: 21, clientY: 31 });
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it('opens at the source on a middle click, without selecting', () => {
    const { onOpenSource, onSelect, row } = setup();
    middleClick(row);
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('prevents the middle-button autoscroll on mousedown', () => {
    const { row } = setup();
    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(false);
    expect(fireEvent.mouseDown(row, { button: 0 })).toBe(true);
  });

  it('ignores a middle click on a button of the row', () => {
    const { onOpenSource, button } = setup();
    middleClick(button);
    expect(onOpenSource).not.toHaveBeenCalled();
  });
});
