import { describe, it, expect } from 'vitest';
import type { Subscription } from '../types';
import { homeStreamId, inMainStream, mainStreamFeedIds, homeUnreadTotal, READING_LIST_STREAM, MAIN_STREAM } from './mainStream';

const sub = (id: string, priority?: Subscription['priority']): Subscription =>
  ({ id, title: id, ...(priority ? { priority } : {}) }) as Subscription;

describe('homeStreamId', () => {
  it("demande reading-list à un FreshRSS qui n'annonce aucune priorité (< 1.28)", () => {
    expect(homeStreamId([sub('feed/1'), sub('feed/2')])).toBe(READING_LIST_STREAM);
  });

  it('demande le flux principal dès qu’un abonnement porte une priorité', () => {
    expect(homeStreamId([sub('feed/1'), sub('feed/2', 'main')])).toBe(MAIN_STREAM);
  });

  it('sans abonnement, reste sur reading-list', () => {
    expect(homeStreamId([])).toBe(READING_LIST_STREAM);
  });
});

describe('inMainStream', () => {
  it('un flux sans priorité connue est dans le flux principal (ancien serveur)', () => {
    expect(inMainStream(sub('feed/1'))).toBe(true);
  });

  it('main et important y sont, category et feed non', () => {
    expect(inMainStream(sub('feed/1', 'main'))).toBe(true);
    expect(inMainStream(sub('feed/1', 'important'))).toBe(true);
    expect(inMainStream(sub('feed/1', 'category'))).toBe(false);
    expect(inMainStream(sub('feed/1', 'feed'))).toBe(false);
  });
});

describe('mainStreamFeedIds', () => {
  it('ne garde que les identifiants des flux du flux principal', () => {
    expect(mainStreamFeedIds([sub('feed/1', 'main'), sub('feed/2', 'category'), sub('feed/3')]))
      .toEqual(['feed/1', 'feed/3']);
  });
});

describe('homeUnreadTotal', () => {
  it('additionne les non-lus des seuls flux du flux principal, et ignore les clés dérivées', () => {
    const subs = [sub('feed/1', 'main'), sub('feed/2', 'category'), sub('feed/3')];
    const counts = { 'feed/1': 3, 'feed/2': 10, 'feed/3': 4, 'user/-/label/X': 13, 'user/-/state/com.google/reading-list': 17 };
    expect(homeUnreadTotal(counts, subs)).toBe(7);
  });
});
