// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ActionBtn } from './ReadingPane';
import { LONG_PRESS_MS, LONG_PRESS_ECHO_MS } from '../../hooks/useLongPress';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

function setup(withFile = true) {
  const spies = { onClick: vi.fn(), onFile: vi.fn() };
  const c = render(
    <ActionBtn
      icon={null}
      label="Favori"
      activeColor="var(--star-color)"
      highlight
      onClick={spies.onClick}
      onFile={withFile ? spies.onFile : undefined}
    />,
  );
  return { ...spies, btn: c.getByRole('button', { name: 'Favori' }), unmount: c.unmount };
}

const at = { touches: [{ clientX: 10, clientY: 10 }] };
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('reading pane Favourite / Read later — long press files the article', () => {
  it('a long press with the finger files, and the release does not toggle', () => {
    const { onClick, onFile, btn } = setup();
    fireEvent.touchStart(btn, at);
    wait(LONG_PRESS_MS);
    expect(fireEvent.touchEnd(btn)).toBe(false);
    fireEvent.click(btn);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a short tap toggles', () => {
    const { onClick, onFile, btn } = setup();
    fireEvent.touchStart(btn, at);
    fireEvent.touchEnd(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('tolerates a tremor; a scroll, a touchcancel or a second finger cancel', () => {
    const { onFile, btn } = setup();
    fireEvent.touchStart(btn, at);
    fireEvent.touchMove(btn, { touches: [{ clientX: 10, clientY: 40 }] });
    wait(LONG_PRESS_MS);
    fireEvent.touchStart(btn, at);
    fireEvent.touchCancel(btn);
    wait(LONG_PRESS_MS);
    fireEvent.touchStart(btn, at);
    fireEvent.touchStart(btn, { touches: [{ clientX: 10, clientY: 10 }, { clientX: 50, clientY: 10 }] });
    wait(LONG_PRESS_MS);
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.touchStart(btn, at);
    fireEvent.touchMove(btn, { touches: [{ clientX: 13, clientY: 14 }] });
    wait(LONG_PRESS_MS);
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('the primary mouse button held files and its click does not toggle; the right button does not arm', () => {
    const { onClick, onFile, btn } = setup();
    fireEvent.mouseDown(btn, { button: 2, clientX: 10, clientY: 10 });
    wait(LONG_PRESS_MS);
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.mouseDown(btn, { button: 0, clientX: 10, clientY: 10 });
    wait(LONG_PRESS_MS + 1500);
    fireEvent.mouseUp(btn, { button: 0 });
    fireEvent.click(btn);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('right-click files; the contextmenu echo of a long press does not file twice', () => {
    const { onFile, btn } = setup();
    expect(fireEvent.contextMenu(btn)).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(1);
    wait(LONG_PRESS_ECHO_MS);
    fireEvent.touchStart(btn, at);
    wait(LONG_PRESS_MS);
    expect(fireEvent.contextMenu(btn)).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it('a contextmenu arriving before the timer (Chrome Android) files once, at the button', () => {
    const { onClick, onFile, btn } = setup();
    fireEvent.touchStart(btn, at);
    wait(491);
    expect(fireEvent.contextMenu(btn)).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(1);
    wait(LONG_PRESS_MS);
    expect(fireEvent.touchEnd(btn)).toBe(false);
    fireEvent.click(btn);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the timer does not outlive the button', () => {
    const { onFile, btn, unmount } = setup();
    fireEvent.touchStart(btn, at);
    unmount();
    wait(LONG_PRESS_MS);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('without onFile, no gesture: a held button only clicks', () => {
    const { onClick, onFile, btn } = setup(false);
    fireEvent.touchStart(btn, at);
    wait(LONG_PRESS_MS);
    fireEvent.touchEnd(btn);
    fireEvent.click(btn);
    expect(onFile).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
