// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useArticleMenuGestures } from './useArticleMenuGestures';
import { LONG_PRESS_MS, type PressPoint } from './useLongPress';

function Harness({ onOpenMenu, onOpenSource, onSelect, onButtonContextMenu, onButtonClick, withPortal, withInput }: {
  onOpenMenu?: (p: PressPoint) => void;
  onOpenSource: () => void;
  onSelect: () => void;
  onButtonContextMenu: () => void;
  onButtonClick?: () => void;
  withPortal?: boolean;
  withInput?: boolean;
}) {
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource);
  return (
    <div role="button" data-testid="row" {...gestures} onClick={onSelect}>
      <span>Hello</span>
      {/* Stands in for the Star button: its own right-click already calls preventDefault. */}
      <button
        type="button"
        onContextMenu={(e) => { e.preventDefault(); onButtonContextMenu(); }}
        onClick={onButtonClick}
      >
        star
      </button>
      {withInput && <input data-testid="row-field" />}
      {/* Stands in for SavedCategoryPicker: a React child of the row, rendered
          through a portal — its DOM lives outside the row, but events still
          bubble through the React tree to the row's handlers. */}
      {withPortal && createPortal(
        <div data-testid="portal">
          <input data-testid="field" />
        </div>,
        document.body,
      )}
    </div>
  );
}

function setup(withMenu = true, opts: { withPortal?: boolean; withInput?: boolean } = {}) {
  const spies = {
    onOpenMenu: vi.fn(), onOpenSource: vi.fn(), onSelect: vi.fn(), onButtonContextMenu: vi.fn(), onButtonClick: vi.fn(),
  };
  const c = render(<Harness {...spies} onOpenMenu={withMenu ? spies.onOpenMenu : undefined} {...opts} />);
  return {
    ...spies,
    row: c.getByTestId('row'),
    button: c.getByRole('button', { name: 'star' }),
    get portal() { return c.getByTestId('portal'); },
    get field() { return c.getByTestId('field'); },
    get rowField() { return c.getByTestId('row-field'); },
  };
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

  it('does not lose the next tap on a row button after a long press', () => {
    // Régression : le `touchend` d'un appui abouti est `preventDefault()`, donc
    // aucun clic ne consomme `fired` ; un contact qui démarre sur un bouton
    // sortait tôt par `fromButton` et ne rappelait jamais `longPress.reset()`.
    // Le clic suivant sur ce bouton restait avalé en capture.
    const { onOpenMenu, onButtonClick, row, button } = setup();
    fireEvent.touchStart(row, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 30 }] });
    fireEvent.touchEnd(button);
    fireEvent.click(button);
    expect(onButtonClick).toHaveBeenCalledTimes(1);
  });

  describe('portal content (SavedCategoryPicker) is a React child but lives outside the row in the DOM', () => {
    it('a right-click on the portal does not open the menu, nor get prevented by the row', () => {
      const { onOpenMenu, portal } = setup(true, { withPortal: true });
      const notPrevented = fireEvent.contextMenu(portal, { clientX: 40, clientY: 50 });
      expect(onOpenMenu).not.toHaveBeenCalled();
      expect(notPrevented).toBe(true);
    });

    it('a middle click on the portal does not open the article at its source', () => {
      const { onOpenSource, portal } = setup(true, { withPortal: true });
      middleClick(portal);
      expect(onOpenSource).not.toHaveBeenCalled();
    });

    it('a long press on the portal field does not open the menu', () => {
      const { onOpenMenu, field } = setup(true, { withPortal: true });
      fireEvent.touchStart(field, { touches: [{ clientX: 20, clientY: 30 }] });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onOpenMenu).not.toHaveBeenCalled();
    });
  });

  it('a long press starting on an input directly inside the row does not open the menu', () => {
    const { onOpenMenu, rowField } = setup(true, { withInput: true });
    fireEvent.touchStart(rowField, { touches: [{ clientX: 20, clientY: 30 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });
});
