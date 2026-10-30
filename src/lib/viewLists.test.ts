import { describe, it, expect } from 'vitest';
import {
  viewListKey, parseViewKey, preparedListKey, fallbackSources, offlineViewList, markStreamRead,
  type ViewAddress, type StoredView,
} from './viewLists';
import type { Article } from '../types';

const row = (id: string, over: Partial<Article> = {}): Article => ({
  id, title: 'T', summary: '', content: '', author: '', url: '', source: '', sourceId: 'feed/1',
  published: 0, read: false, starred: false, labels: [], tags: [], ...over,
});
const view = (over: Partial<ViewAddress> = {}): ViewAddress => ({
  scope: '7@1', feedId: 'feed/1', filter: 'unread', order: 'newest', ...over,
});

describe('viewListKey / parseViewKey', () => {
  it('écrit la forme attendue', () => {
    expect(viewListKey(view())).toBe('7@1|feed/1:unread');
    expect(viewListKey(view({ order: 'oldest' }))).toBe('7@1|feed/1:unread:oldest');
    expect(viewListKey(view({ feedId: '', filter: 'all' }))).toBe('7@1|:all');
  });

  it.each([
    view(), view({ order: 'oldest' }), view({ feedId: '', filter: 'starred' }),
    view({ feedId: 'user/-/label/a:unread', filter: 'all' }),
    view({ feedId: 'user/-/label/a|b', filter: 'readlater', order: 'oldest' }),
  ])('relit ce qu’il a écrit (%o)', (v) => {
    expect(parseViewKey(viewListKey(v))).toEqual(v);
  });

  it('une clé qui n’est pas une vue ne se lit pas', () => {
    expect(parseViewKey('7@1|subscriptions')).toBeNull();
    expect(parseViewKey('sans-portee')).toBeNull();
  });

  // Elle n'est pas une vue : aucune boucle sur les clés de vues ne doit la prendre
  // pour une liste qu'une visite ou un geste peut réécrire.
  it('la clé préparée n’est pas une clé de vue', () => {
    expect(preparedListKey('7@1', 'feed/1')).toBe('7@1|feed/1:prepared');
    expect(parseViewKey(preparedListKey('7@1', 'feed/1'))).toBeNull();
  });
});

describe('fallbackSources', () => {
  it('Non lus : la liste « Tous » du même flux, dans les deux ordres, et son propre ordre inverse', () => {
    expect(fallbackSources(view()).map(viewListKey)).toEqual([
      '7@1|feed/1:all', '7@1|feed/1:all:oldest', '7@1|feed/1:unread:oldest',
    ]);
  });

  it('commence par l’ordre de la vue', () => {
    expect(fallbackSources(view({ order: 'oldest' })).map(viewListKey)[0]).toBe('7@1|feed/1:all:oldest');
  });

  it('les autres filtres : leur seul ordre inverse', () => {
    expect(fallbackSources(view({ filter: 'all' })).map(viewListKey)).toEqual(['7@1|feed/1:all:oldest']);
    expect(fallbackSources(view({ filter: 'readlater', feedId: '' })).map(viewListKey)).toEqual(['7@1|:readlater:oldest']);
  });
});

describe('offlineViewList', () => {
  // Plus grand = plus récent, comme les identifiants d'entrée de FreshRSS.
  const id = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
  const line = (n: number, over: Partial<Article> = {}) => row(id(n), over);
  const stored = (at: number, rows: Article[], continuation: string | null = null): StoredView => ({ articles: rows, continuation, at });
  const shown = (v: { articles: Article[] } | null) => v?.articles.map((a) => a.id);
  const all = view({ filter: 'all' });
  const prepared = stored(10, [line(5), line(4), line(3), line(2), line(1)]);

  it('rien à servir : null', () => {
    expect(offlineViewList(view(), {})).toBeNull();
  });

  it('la liste exacte seule garde sa page suivante, et n’est pas construite', () => {
    const v = offlineViewList(all, { own: stored(1, [line(2)], 'c') });
    expect(v).toEqual({ articles: [line(2)], continuation: 'c', rebuilt: false });
  });

  it('une préparation plus récente que la liste exacte est la base', () => {
    const v = offlineViewList(view(), { own: stored(5, [line(9)]), prepared });
    expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    expect(v?.continuation).toBeNull();
    expect(v?.rebuilt).toBe(true);
  });

  it('une liste exacte plus récente reste la base, et la préparation donne la fin', () => {
    const v = offlineViewList(view(), { own: stored(20, [line(5, { starred: true }), line(4)], '50'), prepared });
    expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    expect(v?.articles[0].starred).toBe(true);
    expect(v?.continuation).toBeNull();
    expect(v?.rebuilt).toBe(true);
  });

  it('à date égale, la liste exacte l’emporte', () => {
    expect(shown(offlineViewList(view(), { own: stored(10, [line(5)]), prepared }))).toEqual([id(5)]);
  });

  it('une liste vidée après la préparation reste vide', () => {
    const v = offlineViewList(view(), { own: stored(20, []), prepared });
    expect(v).toEqual({ articles: [], continuation: null, rebuilt: false });
  });

  // Sa fin n'est pas une coupure : elle dit qu'il n'y a plus rien, à une date
  // postérieure à la préparation. Ce que celle-ci croyait non lu au-delà a été lu.
  it('une liste exacte complète ne reçoit aucune fin', () => {
    expect(shown(offlineViewList(view(), { own: stored(20, [line(5), line(4)]), prepared }))).toEqual([id(5), id(4)]);
  });

  // Elle les a vues, puis perdues : un ✓ sous Non lus, une purge.
  it('une ligne absente AU MILIEU de la liste exacte n’y revient pas', () => {
    const v = offlineViewList(view(), { own: stored(20, [line(5), line(3)], '50'), prepared });
    expect(shown(v)).toEqual([5, 3, 2, 1].map(id));
  });

  it('une liste exacte à page suivante, sans aucune ligne après elle : rien de construit', () => {
    const v = offlineViewList(view(), { own: stored(20, [line(5), line(1)], '50'), prepared });
    expect(v).toEqual({ articles: [line(5), line(1)], continuation: '50', rebuilt: false });
  });

  it('Non lus filtre aussi la fin rapportée', () => {
    const p = stored(10, [line(3), line(2, { read: true }), line(1)]);
    expect(shown(offlineViewList(view(), { own: stored(20, [line(3)], '50'), prepared: p }))).toEqual([id(3), id(1)]);
  });

  it('Tous garde les lignes lues', () => {
    const p = stored(10, [line(3), line(2, { read: true })]);
    expect(shown(offlineViewList(all, { prepared: p }))).toEqual([id(3), id(2)]);
  });

  it('ordre inverse : la préparation retournée, sans la modifier', () => {
    const v = offlineViewList(view({ filter: 'all', order: 'oldest' }), { prepared });
    expect(shown(v)).toEqual([1, 2, 3, 4, 5].map(id));
    expect(shown(prepared)).toEqual([5, 4, 3, 2, 1].map(id));
  });

  it('ordre inverse : la fin d’une liste exacte, ce sont les lignes plus récentes', () => {
    const v = offlineViewList(view({ filter: 'all', order: 'oldest' }), { own: stored(20, [line(1), line(2)], 'c'), prepared });
    expect(shown(v)).toEqual([1, 2, 3, 4, 5].map(id));
  });

  it('Favoris et À lire plus tard ne se servent pas de la préparation', () => {
    expect(offlineViewList(view({ filter: 'starred' }), { prepared })).toBeNull();
    expect(offlineViewList(view({ filter: 'readlater' }), { prepared })).toBeNull();
  });

  // Un flux calme : rien dans les 30 jours. Elle ne dit pas que le flux est vide.
  it('une préparation vide ne compte pas', () => {
    const v = offlineViewList(all, { own: stored(1, [line(1)]), prepared: stored(10, []) });
    expect(shown(v)).toEqual([id(1)]);
  });

  describe('sans liste exacte', () => {
    const source = view({ filter: 'all' });

    it('une liste sœur : filtrée, sans page suivante', () => {
      const v = offlineViewList(view(), { fallback: { list: stored(1, [line(2), line(1, { read: true })], 'c'), source } });
      expect(shown(v)).toEqual([id(2)]);
      expect(v?.continuation).toBeNull();
      expect(v?.rebuilt).toBe(true);
    });

    it('elle se retourne quand elle vient de l’autre ordre', () => {
      const v = offlineViewList(view({ order: 'oldest' }), { fallback: { list: stored(1, [line(2), line(1)]), source } });
      expect(shown(v)).toEqual([id(1), id(2)]);
    });

    it('plus récente que la préparation, elle reste la base et la préparation donne la fin', () => {
      const v = offlineViewList(view(), { fallback: { list: stored(20, [line(5), line(4)], '50'), source }, prepared });
      expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    });

    it('plus ancienne, elle s’efface', () => {
      const v = offlineViewList(view(), { fallback: { list: stored(1, [line(9)], '50'), source }, prepared });
      expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    });

    // Lue depuis l'autre bout, elle ne montre pas le même morceau du flux.
    it('venue de l’autre ordre, elle ne passe pas devant la préparation', () => {
      const other = view({ filter: 'all', order: 'oldest' });
      const v = offlineViewList(view(), { fallback: { list: stored(20, [line(1)], '50'), source: other }, prepared });
      expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    });
  });

  describe('le recalage', () => {
    const lu = (rows: Article[]) => rows.map((a) => (a.id === id(5) ? { ...a, read: true } : a));

    it('passe AVANT le filtre : une ligne lue en file sort de Non lus', () => {
      expect(shown(offlineViewList(view(), { prepared }, { overlay: lu }))).toEqual([4, 3, 2, 1].map(id));
    });

    it('une ligne rendue non lue en file y entre', () => {
      const p = stored(10, [line(2, { read: true })]);
      const nonLu = (rows: Article[]) => rows.map((a) => ({ ...a, read: false }));
      expect(shown(offlineViewList(view(), { prepared: p }, { overlay: nonLu }))).toEqual([id(2)]);
    });

    it('l’article ouvert reste, même lu', () => {
      const v = offlineViewList(view(), { prepared }, { overlay: lu, stays: (a) => a.id === id(5) });
      expect(shown(v)).toEqual([5, 4, 3, 2, 1].map(id));
    });
  });
});

describe('markStreamRead', () => {
  const rows = [row('1'), row('2', { sourceId: 'feed/2' })];

  it('toute la liste quand elle EST le flux marqué', () => {
    const out = markStreamRead(rows, { whole: true, sourceIds: new Set(), drop: false });
    expect(out.every((a) => a.read)).toBe(true);
  });

  it('sinon, les seuls articles des flux marqués', () => {
    const out = markStreamRead(rows, { whole: false, sourceIds: new Set(['feed/2']), drop: false });
    expect(out.map((a) => a.read)).toEqual([false, true]);
  });

  it('sous Non lus, les lignes marquées sortent de la liste', () => {
    const out = markStreamRead(rows, { whole: false, sourceIds: new Set(['feed/2']), drop: true });
    expect(out.map((a) => a.id)).toEqual(['1']);
  });

  it('rend la même liste quand rien ne change', () => {
    const read = [row('1', { read: true })];
    expect(markStreamRead(read, { whole: true, sourceIds: new Set(), drop: false })).toBe(read);
    expect(markStreamRead(rows, { whole: false, sourceIds: new Set(['feed/9']), drop: true })).toBe(rows);
  });
});
