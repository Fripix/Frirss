import { describe, it, expect } from 'vitest';
import { effectiveLayout } from './effectiveLayout';

describe('effectiveLayout', () => {
  it('falls back to the global layout when the feed has no override', () => {
    expect(effectiveLayout('3', {}, 'feed/1')).toBe('3');
  });

  it('uses the feed override when set', () => {
    expect(effectiveLayout('3', { 'feed/1': { layout: 'grid' } }, 'feed/1')).toBe('grid');
  });

  it('ignores overrides belonging to other feeds', () => {
    expect(effectiveLayout('2', { 'feed/9': { layout: 'grid' } }, 'feed/1')).toBe('2');
  });

  it('falls back to the global layout with no feed selected', () => {
    expect(effectiveLayout('grid', { 'feed/1': { layout: '2' } }, undefined)).toBe('grid');
  });

  it('treats an empty override as "use the default"', () => {
    expect(effectiveLayout('3', { 'feed/1': { layout: '' } }, 'feed/1')).toBe('3');
  });

  it('keeps other feed settings untouched', () => {
    expect(effectiveLayout('3', { 'feed/1': { autoExtract: true } }, 'feed/1')).toBe('3');
  });
});
