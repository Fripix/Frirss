// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { canMorph, withMorph } from './viewTransition';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).startViewTransition;
});

function stubSupport(supported: boolean) {
  if (supported) {
    (document as unknown as Record<string, unknown>).startViewTransition = (cb: () => void) => {
      cb();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    };
  } else {
    delete (document as unknown as Record<string, unknown>).startViewTransition;
  }
}

describe('canMorph', () => {
  it('is true on a layout where the list is replaced by the reader', () => {
    stubSupport(true);
    expect(canMorph({ listIsReplaced: true, reducedMotion: false })).toBe(true);
  });

  it('is false in the three-pane layout', () => {
    // List and reader are on screen at the same time, so both titles would
    // claim the same view-transition-name and the browser would skip it.
    stubSupport(true);
    expect(canMorph({ listIsReplaced: false, reducedMotion: false })).toBe(false);
  });

  it('is false when the system asks for reduced motion', () => {
    stubSupport(true);
    expect(canMorph({ listIsReplaced: true, reducedMotion: true })).toBe(false);
  });

  it('is false where the browser has no view transitions', () => {
    stubSupport(false);
    expect(canMorph({ listIsReplaced: true, reducedMotion: false })).toBe(false);
  });
});

describe('withMorph', () => {
  it('runs the update through the transition when enabled', () => {
    stubSupport(true);
    let ran = false;
    withMorph(() => { ran = true; }, true);
    expect(ran).toBe(true);
  });

  it('runs the update plainly when disabled', () => {
    stubSupport(false);
    let ran = false;
    withMorph(() => { ran = true; }, false);
    expect(ran).toBe(true);
  });

  it('still runs the update if the transition throws', () => {
    // A failed animation must never cost the navigation itself.
    (document as unknown as Record<string, unknown>).startViewTransition = () => {
      throw new Error('nope');
    };
    let ran = false;
    withMorph(() => { ran = true; }, true);
    expect(ran).toBe(true);
  });
});
