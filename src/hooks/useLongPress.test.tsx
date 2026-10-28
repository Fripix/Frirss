// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  useLongPress, LONG_PRESS_MS, LONG_PRESS_ECHO_MS, LONG_PRESS_MOVE_TOLERANCE_PX, type PressPoint,
} from './useLongPress';

let firedRecently: () => boolean = () => false;
let firedThisContact: () => boolean = () => false;

interface Opts { mouse?: boolean; enabled?: boolean }

function Harness({ onLongPress, onClick, opts }: { onLongPress: (p: PressPoint) => void; onClick: () => void; opts?: Opts }) {
  const lp = useLongPress(onLongPress, opts);
  firedRecently = lp.firedRecently;
  firedThisContact = lp.firedThisContact;
  return (
    <div
      role="button"
      onTouchStart={lp.onTouchStart}
      onTouchMove={lp.onTouchMove}
      onTouchEnd={lp.onTouchEnd}
      onTouchCancel={lp.onTouchCancel}
      onMouseDown={lp.onMouseDown}
      onMouseMove={lp.onMouseMove}
      onMouseUp={lp.onMouseUp}
      onMouseLeave={lp.onMouseLeave}
      onClickCapture={lp.onClickCapture}
      onClick={onClick}
    >
      row
    </div>
  );
}

function setup(opts?: Opts) {
  const onLongPress = vi.fn();
  const onClick = vi.fn();
  const c = render(<Harness onLongPress={onLongPress} onClick={onClick} opts={opts} />);
  return { onLongPress, onClick, row: c.getByRole('button'), unmount: c.unmount };
}

/** Le doigt, décalé de (dx, dy) depuis le point de départ `at`. */
const moved = (dx: number, dy: number) => ({ touches: [{ clientX: 12 + dx, clientY: 34 + dy }] });

const at = { touches: [{ clientX: 12, clientY: 34 }] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('useLongPress', () => {
  it('fires after the delay, at the touch point', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it('does not fire before the delay', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled once the finger moves past the tolerance — a scroll or a swipe must not open the menu', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row, moved(12, 0));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('survives a few pixels of tremor — a finger is never perfectly still', () => {
    // Avant : tout `touchmove` annulait, et un pouce posé sur un iPhone en
    // émet presque toujours un ou deux.
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row, moved(5, 0));
    fireEvent.touchMove(row, moved(3, 4));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it('measures the tolerance from the starting point, not from the last move', () => {
    // Trois pas de 5 px : chacun sous la tolérance, mais 15 px au total.
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row, moved(5, 0));
    fireEvent.touchMove(row, moved(10, 0));
    fireEvent.touchMove(row, moved(15, 0));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('the tolerance is a distance: 7 px on each axis is past 8 px', () => {
    expect(LONG_PRESS_MOVE_TOLERANCE_PX).toBe(8);
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row, moved(7, 7));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a move that carries no measurable finger cancels, rather than guessing', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a second finger landing during the move cancels', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row, { touches: [{ clientX: 12, clientY: 34 }, { clientX: 80, clientY: 90 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('the timer does not outlive the element', () => {
    // Une relève qui retire la ligne pendant l'appui ouvrirait un menu sur un
    // élément qui n'est plus là.
    const { onLongPress, row, unmount } = setup();
    fireEvent.touchStart(row, at);
    unmount();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is cancelled when the finger lifts before the delay', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchEnd(row);
    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('swallows the click that ends a completed press', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cancels the compatibility click at the source when a press completed, not after a short tap', () => {
    // Sur téléphone, ce clic tomberait sur le fond de la feuille du bas qui
    // vient de s'ouvrir sous le doigt, et la refermerait aussitôt.
    const { row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fireEvent.touchEnd(row)).toBe(false);
    fireEvent.touchStart(row, at);
    expect(fireEvent.touchEnd(row)).toBe(true);
  });

  it('lets a short tap click', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a new touch clears a swallow that no click consumed', () => {
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    fireEvent.touchStart(row, at);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reports a recent press for the echo window only', () => {
    const { row } = setup();
    expect(firedRecently()).toBe(false);
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(firedRecently()).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_ECHO_MS);
    expect(firedRecently()).toBe(false);
  });

  it('lets a click through once the echo window has passed, even with no intervening touch', () => {
    // Régression : sans nouveau contact pour effacer `fired`, le clic restait
    // avalé indéfiniment — le prochain tap sur un bouton de la ligne se perdait.
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row);
    vi.advanceTimersByTime(LONG_PRESS_ECHO_MS);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('touchcancel before the delay cancels the pending press', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchCancel(row);
    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a second touch cancels a pending press, without starting a new one', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchStart(row, { touches: [{ clientX: 12, clientY: 34 }, { clientX: 50, clientY: 60 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('swallows a stray click even when the finger was held long after the press fired', () => {
    // La fenêtre d'écho part du lever du doigt : un doigt gardé deux secondes
    // sur la ligne ne doit pas laisser passer le clic qui termine le geste.
    const { onClick, row } = setup();
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS + 2000);
    fireEvent.touchEnd(row);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('firedThisContact holds from the press until the next contact starts', () => {
    const { row } = setup();
    fireEvent.touchStart(row, at);
    expect(firedThisContact()).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS + 3000);
    expect(firedThisContact()).toBe(true);
    fireEvent.touchStart(row, at);
    expect(firedThisContact()).toBe(false);
  });

  it('ignores the mouse unless asked to', () => {
    const { onLongPress, row } = setup();
    fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const { onLongPress, row } = setup({ enabled: false, mouse: true });
    fireEvent.touchStart(row, at);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  describe('with the mouse', () => {
    it('the primary button arms the press', () => {
      const { onLongPress, row } = setup({ mouse: true });
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onLongPress).toHaveBeenCalledWith({ x: 12, y: 34 });
    });

    it('the right button does not — right-click is the caller\'s own gesture', () => {
      const { onLongPress, row } = setup({ mouse: true });
      fireEvent.mouseDown(row, { button: 2, clientX: 12, clientY: 34 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('releasing, leaving or moving past the tolerance cancels', () => {
      const { onLongPress, row } = setup({ mouse: true });
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      fireEvent.mouseUp(row, { button: 0 });
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      fireEvent.mouseLeave(row);
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      fireEvent.mouseMove(row, { clientX: 24, clientY: 34 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('a small mouse tremor does not cancel', () => {
      const { onLongPress, row } = setup({ mouse: true });
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      fireEvent.mouseMove(row, { clientX: 16, clientY: 37 });
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(onLongPress).toHaveBeenCalledTimes(1);
    });

    it('swallows the click that ends a held press, however long it was held', () => {
      // Le clic d'une souris arrive au relâchement, qui peut venir bien après
      // le déclenchement : la fenêtre d'écho part du relâchement.
      const { onClick, row } = setup({ mouse: true });
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      vi.advanceTimersByTime(LONG_PRESS_MS + 2000);
      fireEvent.mouseUp(row, { button: 0 });
      fireEvent.click(row);
      expect(onClick).not.toHaveBeenCalled();
      fireEvent.mouseDown(row, { button: 0, clientX: 12, clientY: 34 });
      fireEvent.mouseUp(row, { button: 0 });
      fireEvent.click(row);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
