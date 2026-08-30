import { describe, it, expect } from 'vitest';
import { scrolledPastTop, shouldMark, MARK_READ_DELAY_MS } from './markReadOnScroll';
import type { Article } from '../types';

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a1',
  title: 't',
  summary: '',
  content: '',
  url: '',
  source: 's',
  sourceId: 'feed/1',
  published: 0,
  read: false,
  starred: false,
  ...over,
} as Article);

describe('scrolledPastTop', () => {
  it('is true when the row sits entirely above the viewport top', () => {
    expect(scrolledPastTop({ bottom: 40 }, { top: 100 })).toBe(true);
  });

  it('is false when the row is only partly above', () => {
    expect(scrolledPastTop({ bottom: 140 }, { top: 100 })).toBe(false);
  });

  it('is false when the row left downwards', () => {
    // Scrolling up pushes rows off the BOTTOM. Those must not be marked read:
    // they have not been passed, they are about to be reached.
    expect(scrolledPastTop({ bottom: 900 }, { top: 100 })).toBe(false);
  });

  it('is false without a root rectangle rather than guessing', () => {
    expect(scrolledPastTop({ bottom: 40 }, null)).toBe(false);
  });
});

describe('shouldMark', () => {
  const seen = new Set(['a1']);

  it('marks an unread row that was seen and has scrolled past', () => {
    expect(shouldMark(article(), true, seen)).toBe(true);
  });

  it('never marks a row that was never visible', () => {
    // The observer reports the state of every row on its first callback, so a
    // list restored mid-scroll would otherwise mark everything above as read.
    expect(shouldMark(article(), true, new Set())).toBe(false);
  });

  it('never marks a row that has not scrolled past', () => {
    expect(shouldMark(article(), false, seen)).toBe(false);
  });

  it('never touches an article that is already read', () => {
    // The write goes through toggleRead, which would flip a read article back
    // to unread — the opposite of what the setting promises.
    expect(shouldMark(article({ read: true }), true, seen)).toBe(false);
  });
});

describe('MARK_READ_DELAY_MS', () => {
  it('leaves time to scroll back', () => {
    expect(MARK_READ_DELAY_MS).toBeGreaterThanOrEqual(600);
  });
});
