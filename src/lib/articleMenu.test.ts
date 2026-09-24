import { describe, it, expect } from 'vitest';
import { articleMenuItems, menuAnchor } from './articleMenu';

const base = { url: 'https://example.com/a', read: false, starred: false };

describe('articleMenuItems', () => {
  it('liste les sept entrées, dans l’ordre, pour un article non lu et non favori avec URL', () => {
    expect(articleMenuItems(base, false)).toEqual([
      { kind: 'openSource', labelKey: 'articleRow.openSource' },
      { kind: 'toggleRead', labelKey: 'articleRow.markRead' },
      { kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead' },
      { kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead' },
      { kind: 'toggleStar', labelKey: 'articleRow.addStar' },
      { kind: 'toggleReadLater', labelKey: 'articleRow.addReadLater' },
      { kind: 'copyLink', labelKey: 'articleRow.copyLink' },
    ]);
  });

  it('les libellés suivent l’état de l’article, sauf ceux des deux marquages de plage', () => {
    const labels = articleMenuItems({ ...base, read: true, starred: true }, true).map((i) => i.labelKey);
    expect(labels).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.markBelowRead',
      'articleRow.markAboveRead',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
    ]);
  });

  it('garde les deux marquages de plage même sans URL — ils ne dépendent pas du lien', () => {
    expect(articleMenuItems({ ...base, url: '' }, false).map((i) => i.kind)).toEqual([
      'toggleRead', 'markBelowRead', 'markAboveRead', 'toggleStar', 'toggleReadLater',
    ]);
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
