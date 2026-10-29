import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Se désabonner parcourait TOUTE la table des listes, toutes portées
 * confondues, dans une transaction en écriture : chaque liste désérialisée,
 * articles et HTML compris (plusieurs Mo après une préparation), pendant que
 * les lectures hors ligne attendaient. Le parcours se limite à la portée.
 */
const seen = vi.hoisted(() => ({ ranges: [] as unknown[] }));

vi.mock('./idbConnection', () => ({
  cachedConnection: () => ({ get: async () => ({}), reset: () => {} }),
  transactionOn: () => {
    const t: { objectStore?: unknown; oncomplete?: () => void } = {};
    t.objectStore = () => ({
      openCursor: (range?: unknown) => {
        seen.ranges.push(range);
        const req: { result: null; onsuccess?: () => void } = { result: null };
        setTimeout(() => { req.onsuccess?.(); setTimeout(() => t.oncomplete?.()); });
        return req;
      },
    });
    return t;
  },
}));

import { listsWithoutSource } from './offlineStore';

beforeEach(() => {
  seen.ranges = [];
  (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = {
    bound: (lower: string, upper: string) => ({ lower, upper }),
  };
});

describe('listsWithoutSource', () => {
  it('ne parcourt que les clés de la portée', async () => {
    await listsWithoutSource('7@1|', 'feed/12');
    expect(seen.ranges).toEqual([{ lower: '7@1|', upper: '7@1|￿' }]);
  });
});
