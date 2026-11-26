import { describe, it, expect } from 'vitest';
import type { Subscription } from '../types';
import { nextUnreadView, orderSidebarCategories, UNCATEGORIZED } from './sidebarOrder';

const feed = (id: string, cat?: string): Subscription =>
  ({ id, title: id, categories: cat ? [{ id: `user/-/label/${cat}`, label: cat }] : [] }) as unknown as Subscription;

const subs = [feed('feed/3', 'Tech'), feed('feed/1', 'News'), feed('feed/2', 'News'), feed('feed/4', 'Tech'), feed('feed/9')];

describe('orderSidebarCategories', () => {
  it('suit l’ordre personnel, puis l’alphabet', () => {
    const cats = orderSidebarCategories(subs, ['user/-/label/Tech'], { 'user/-/label/Tech': ['feed/4', 'feed/3'] }, 'Sans catégorie');
    expect(cats.map((c) => c.label)).toEqual(['Tech', 'News', 'Sans catégorie']);
    expect(cats[0].feeds.map((f) => f.id)).toEqual(['feed/4', 'feed/3']);
    expect(cats[2].id).toBe(UNCATEGORIZED);
  });
});

describe('nextUnreadView (issue #35)', () => {
  const cats = orderSidebarCategories(subs, [], {}, 'Sans catégorie');
  // Ordre affiché : News (feed/1, feed/2), Sans catégorie (feed/9), Tech (feed/3, feed/4).

  it('depuis un flux, prend le flux suivant qui a des non-lus, en sautant les vides', () => {
    const next = nextUnreadView('feed/1', cats, { 'feed/2': 0, 'feed/9': 0, 'feed/3': 5 });
    expect(next).toEqual({ kind: 'feed', feed: expect.objectContaining({ id: 'feed/3' }) });
  });

  it('repart du haut une fois en bas de la liste', () => {
    const next = nextUnreadView('feed/4', cats, { 'feed/1': 2 });
    expect(next).toEqual({ kind: 'feed', feed: expect.objectContaining({ id: 'feed/1' }) });
  });

  it('ne rend jamais la vue de départ, même si son compteur date d’avant', () => {
    expect(nextUnreadView('feed/1', cats, { 'feed/1': 7 })).toEqual({ kind: 'none' });
  });

  it('depuis une catégorie, prend la catégorie suivante qui a des non-lus', () => {
    const next = nextUnreadView('user/-/label/News', cats, { 'feed/1': 3, 'feed/3': 1 });
    expect(next).toEqual({ kind: 'category', category: expect.objectContaining({ label: 'Tech' }) });
  });

  it('ne saute pas sur la catégorie synthétique des flux sans catégorie', () => {
    const next = nextUnreadView('user/-/label/Tech', cats, { 'feed/9': 4 });
    expect(next).toEqual({ kind: 'none' });
  });

  it('depuis l’accueil ou une étiquette, prend le premier flux qui a des non-lus', () => {
    expect(nextUnreadView(null, cats, { 'feed/9': 1, 'feed/4': 1 })).toEqual({ kind: 'feed', feed: expect.objectContaining({ id: 'feed/9' }) });
    expect(nextUnreadView('user/-/label/Lu plus tard', cats, { 'feed/4': 1 })).toEqual({ kind: 'feed', feed: expect.objectContaining({ id: 'feed/4' }) });
  });

  it('plus rien de non lu : none', () => {
    expect(nextUnreadView('feed/2', cats, {})).toEqual({ kind: 'none' });
  });
});
