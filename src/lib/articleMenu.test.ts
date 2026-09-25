import { describe, it, expect } from 'vitest';
import { articleMenuItems, menuAnchor } from './articleMenu';

const base = { url: 'https://example.com/a', read: false, starred: false };

describe('articleMenuItems', () => {
  it('liste les sept entrées, dans l’ordre, pour un article non lu et non favori avec URL', () => {
    expect(articleMenuItems(base, false, true)).toEqual([
      { kind: 'openSource', labelKey: 'articleRow.openSource', group: 1 },
      { kind: 'toggleRead', labelKey: 'articleRow.markRead', group: 2 },
      { kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead', group: 2 },
      { kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead', group: 2 },
      { kind: 'toggleStar', labelKey: 'articleRow.addStar', group: 3 },
      { kind: 'toggleReadLater', labelKey: 'articleRow.addReadLater', group: 3 },
      { kind: 'copyLink', labelKey: 'articleRow.copyLink', group: 3 },
    ]);
  });

  // Retouche visuelle (décidée avec le propriétaire) : trois blocs séparés
  // par un filet — 1 : ouvrir à la source ; 2 : marquer lu et ses deux
  // marquages de plage ; 3 : favoris, à lire plus tard, copier le lien.
  it('range chaque entrée dans le bon groupe, y compris quand certaines sont absentes', () => {
    expect(articleMenuItems(base, false, false).map((i) => ({ kind: i.kind, group: i.group }))).toEqual([
      { kind: 'openSource', group: 1 },
      { kind: 'toggleRead', group: 2 },
      { kind: 'toggleStar', group: 3 },
      { kind: 'toggleReadLater', group: 3 },
      { kind: 'copyLink', group: 3 },
    ]);
  });

  it('les libellés suivent l’état de l’article, sauf ceux des deux marquages de plage', () => {
    const labels = articleMenuItems({ ...base, read: true, starred: true }, true, true).map((i) => i.labelKey);
    expect(labels).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.markAboveRead',
      'articleRow.markBelowRead',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
    ]);
  });

  it('garde les deux marquages de plage même sans URL — ils ne dépendent pas du lien', () => {
    expect(articleMenuItems({ ...base, url: '' }, false, true).map((i) => i.kind)).toEqual([
      'toggleRead', 'markAboveRead', 'markBelowRead', 'toggleStar', 'toggleReadLater',
    ]);
  });

  // Décision du propriétaire : en Favoris et À lire plus tard, l'action du
  // store se refuse déjà (`canMarkAllRead`) — mais une entrée de menu qui ne
  // fait rien est plus déroutante qu'une entrée absente. `canMarkRange` porte
  // ce refus jusqu'au menu.
  it('efface les deux marquages de plage quand canMarkRange est faux — Favoris / À lire plus tard', () => {
    expect(articleMenuItems(base, false, false).map((i) => i.kind)).toEqual([
      'openSource', 'toggleRead', 'toggleStar', 'toggleReadLater', 'copyLink',
    ]);
  });

  it('garde les cinq autres entrées, dans l’ordre, quand canMarkRange est faux', () => {
    expect(articleMenuItems({ ...base, read: true, starred: true }, true, false).map((i) => i.labelKey)).toEqual([
      'articleRow.openSource',
      'articleRow.markUnread',
      'articleRow.removeStar',
      'articleRow.removeReadLater',
      'articleRow.copyLink',
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
