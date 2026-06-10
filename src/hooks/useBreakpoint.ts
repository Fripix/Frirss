import { useState, useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

/** Width-derived breakpoint, ignoring any manual layout override. */
export function useRawBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    let tid: ReturnType<typeof setTimeout>;
    function handleResize() {
      clearTimeout(tid);
      tid = setTimeout(() => setBp(getBreakpoint()), 100);
    }
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(tid);
    };
  }, []);

  return bp;
}

/**
 * Effective breakpoint that drives the layout. Follows the screen width unless
 * the user forced a layout (uiStore.layoutMode) — used on tablets to pick
 * between the desktop experience and the mobile (gesture-first) experience.
 */
export function useBreakpoint(): Breakpoint {
  const raw = useRawBreakpoint();
  const layoutMode = useUiStore((s) => s.layoutMode);
  if (layoutMode === 'desktop') return 'desktop';
  if (layoutMode === 'mobile') return 'mobile';
  return raw;
}
