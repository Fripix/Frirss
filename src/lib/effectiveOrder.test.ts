import { describe, it, expect } from 'vitest';
import { effectiveOrder, entryDirection } from './effectiveOrder';

describe('effectiveOrder', () => {
  it('falls back to the global order when the feed has no override', () => {
    expect(effectiveOrder('newest', {}, 'feed/1')).toBe('newest');
  });

  it('uses the feed override when set', () => {
    expect(effectiveOrder('newest', { 'feed/1': { order: 'oldest' } }, 'feed/1')).toBe('oldest');
  });

  it('ignores overrides belonging to other feeds', () => {
    expect(effectiveOrder('newest', { 'feed/9': { order: 'oldest' } }, 'feed/1')).toBe('newest');
  });

  it('falls back to the global order with no feed selected', () => {
    expect(effectiveOrder('oldest', { 'feed/1': { order: 'newest' } }, undefined)).toBe('oldest');
  });

  it('keeps other feed settings untouched', () => {
    expect(effectiveOrder('newest', { 'feed/1': { layout: 'grid' } }, 'feed/1')).toBe('newest');
  });
});

describe('entryDirection', () => {
  // « Au-dessus » / « en dessous » sont des positions à l'écran ; le marquage
  // de plage raisonne en entrées plus récentes / plus anciennes. L'ordre de la
  // vue décide de la correspondance.
  it('keeps "above" = newer entries in the default order', () => {
    expect(entryDirection('above', 'newest')).toBe('above');
    expect(entryDirection('below', 'newest')).toBe('below');
  });

  it('flips the direction when the view shows the oldest first', () => {
    expect(entryDirection('above', 'oldest')).toBe('below');
    expect(entryDirection('below', 'oldest')).toBe('above');
  });
});
