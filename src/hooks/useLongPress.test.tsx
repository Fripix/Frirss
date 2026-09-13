// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useLongPress, LONG_PRESS_MS, LONG_PRESS_ECHO_MS, type PressPoint } from './useLongPress';

let firedRecently: () => boolean = () => false;

function Harness({ onLongPress, onClick }: { onLongPress: (p: PressPoint) => void; onClick: () => void }) {
  const lp = useLongPress(onLongPress);
  firedRecently = lp.firedRecently;
  return (
    <div
      role="button"
      onTouchStart={lp.onTouchStart}
      onTouchMove={lp.onTouchMove}
      onTouchEnd={lp.onTouchEnd}
      onTouchCancel={lp.onTouchCancel}
      onClickCapture={lp.onClickCapture}
      onClick={onClick}
    >
      row
    </div>
  );
}

function setup() {
  const onLongPress = vi.fn();
  const onClick = vi.fn();
  const c = render(<Harness onLongPress={onLongPress} onClick={onClick} />);
  return { onLongPress, onClick, row: c.getByRole('button') };
}

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

  it('is cancelled as soon as the finger moves — a scroll or a swipe must not open the menu', () => {
    const { onLongPress, row } = setup();
    fireEvent.touchStart(row, at);
    fireEvent.touchMove(row);
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
});
