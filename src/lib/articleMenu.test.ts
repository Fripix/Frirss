import { describe, it, expect } from 'vitest';
import { articleMenuItems, menuAnchor } from './articleMenu';

const base = { url: 'https://example.com/a', read: false, starred: false };

describe('articleMenuItems', () => {
  it('lists the five entries in order for an unread, unstarred article with a URL', () => {
    expect(articleMenuItems(base, false)).toEqual([
      { kind: 'openSource', labelKey: 'articleRow.openSource' },
      { kind: 'toggleRead', labelKey: 'articleRow.markRead' },
      { kind: 'toggleStar', labelKey: 'articleRow.addStar' },
      { kind: 'toggleReadLater', labelKey: 'articleRow.addReadLater' },
      { kind: 'copyLink', labelKey: 'articleRow.copyLink' },
    ]);
  });

  it('labels follow the article state', () => {
    const labels = articleMenuItems({ ...base, read: true, starred: true }, true).map((i) => i.labelKey);
    expect(labels).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
    ]);
  });

  it('drops open-at-source and copy-link without a URL', () => {
    for (const url of ['', '   ', undefined]) {
      expect(articleMenuItems({ ...base, url }, false).map((i) => i.kind)).toEqual([
        'toggleRead',
        'toggleStar',
        'toggleReadLater',
      ]);
    }
  });
});

describe('menuAnchor', () => {
  it('opens at the pointer for a mouse right-click', () => {
    expect(menuAnchor({ clientX: 120, clientY: 45 }, { left: 10, bottom: 300 })).toEqual({ x: 120, y: 45 });
  });

  it('opens under the row when the keyboard Menu key fired it (clientX = clientY = 0)', () => {
    expect(menuAnchor({ clientX: 0, clientY: 0 }, { left: 10, bottom: 300 })).toEqual({ x: 10, y: 300 });
  });
});
