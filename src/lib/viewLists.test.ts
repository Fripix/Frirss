import { describe, it, expect } from 'vitest';
import {
  viewListKey, parseViewKey, fallbackSources, deriveFromSource, mergePreparedList, markStreamRead,
  type ViewAddress,
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

describe('deriveFromSource', () => {
  const list = { articles: [row('3'), row('2', { read: true }), row('1')], continuation: 'c' };

  it('Non lus depuis « Tous » : sans les lignes lues', () => {
    const d = deriveFromSource(list, view({ filter: 'all' }), view());
    expect(d.articles.map((a) => a.id)).toEqual(['3', '1']);
  });

  it('ordre inverse : la liste retournée, sans la modifier', () => {
    const d = deriveFromSource(list, view({ filter: 'all' }), view({ filter: 'all', order: 'oldest' }));
    expect(d.articles.map((a) => a.id)).toEqual(['1', '2', '3']);
    expect(list.articles.map((a) => a.id)).toEqual(['3', '2', '1']);
  });

  it('les deux à la fois', () => {
    const d = deriveFromSource(list, view({ filter: 'all' }), view({ order: 'oldest' }));
    expect(d.articles.map((a) => a.id)).toEqual(['1', '3']);
  });

  // La continuation appartient à la liste source : elle ne dit rien de la
  // suite d'une liste filtrée ou lue depuis l'autre bout.
  it('ne promet jamais de page suivante', () => {
    expect(deriveFromSource(list, view({ filter: 'all' }), view()).continuation).toBeNull();
  });
});

describe('mergePreparedList', () => {
  const prepared = [row('5'), row('4'), row('3')];

  it('sans liste rangée : la liste préparée, sans page suivante', () => {
    expect(mergePreparedList(prepared, undefined)).toEqual({ articles: prepared, continuation: null });
  });

  it('remplace une liste rangée plus courte', () => {
    const stored = { articles: [row('4'), row('3')], continuation: 'c' };
    expect(mergePreparedList(prepared, stored)).toEqual({ articles: prepared, continuation: null });
  });

  it('garde la fin d’une liste rangée plus longue, et sa page suivante', () => {
    const stored = { articles: [row('4', { read: true }), row('3'), row('2'), row('1')], continuation: 'c' };
    const merged = mergePreparedList(prepared, stored);
    expect(merged.articles.map((a) => a.id)).toEqual(['5', '4', '3', '2', '1']);
    expect(merged.articles[1].read).toBe(false); // le haut vient de la préparation
    expect(merged.continuation).toBe('c');
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
