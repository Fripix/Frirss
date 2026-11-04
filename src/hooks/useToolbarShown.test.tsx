// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const bp = vi.hoisted(() => ({ value: 'desktop' as 'desktop' | 'tablet' | 'mobile' }));
vi.mock('./useBreakpoint', () => ({ useBreakpoint: () => bp.value }));

import { useToolbarShown } from './useToolbarShown';
import { useUiStore } from '../stores/uiStore';
import { DEFAULT_TOOLBAR_VISIBILITY } from '../lib/toolbarItems';

describe('useToolbarShown — les réglages ne valent que sur desktop', () => {
  beforeEach(() => {
    useUiStore.setState({ toolbarVisibility: { ...DEFAULT_TOOLBAR_VISIBILITY, random: false } });
  });

  it('sur desktop, un élément masqué l’est', () => {
    bp.value = 'desktop';
    const { result } = renderHook(() => useToolbarShown());
    expect(result.current('random')).toBe(false);
    expect(result.current('search')).toBe(true);
  });

  it('sur tablette et téléphone, tout reste affiché', () => {
    for (const v of ['tablet', 'mobile'] as const) {
      bp.value = v;
      const { result } = renderHook(() => useToolbarShown());
      expect(result.current('random')).toBe(true);
    }
  });
});
