import { useRef, useState, useEffect, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/reducedMotion';

interface MobileStackProps {
  showOverlay: boolean;
  base: ReactNode;
  overlay: ReactNode;
}

/**
 * iOS-style push/pop navigation stack for mobile.
 *
 * - Overlay slides in from the right when `showOverlay` becomes true
 * - Parallax on the base view + dim layer
 * - Back navigation via toolbar button inside the overlay (ReadingPane);
 *   no swipe-back — swipe gestures drive next/prev article instead.
 */
export default function MobileStack({ showOverlay, base, overlay }: MobileStackProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Cache overlay content during exit animation
  const cachedOverlay = useRef<ReactNode>(null);
  if (overlay) cachedOverlay.current = overlay;

  // ── Mount / animate ──────────────────────────────────────────────
  useEffect(() => {
    if (showOverlay) {
      setMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 400);
      return () => clearTimeout(t);
    }
  }, [showOverlay]);

  // ── Computed styles ──────────────────────────────────────────────
  const w = typeof window !== 'undefined' ? window.innerWidth : 375;
  const listX = mounted ? (visible ? -80 : 0) : 0;
  const overlayX = visible ? 0 : w;
  const dimOpacity = mounted ? (visible ? 0.15 : 0) : 0;

  // Inline style, out of reach of the CSS `prefers-reduced-motion` blocks —
  // read the preference here instead. The push/pop still happens, it just
  // happens at once.
  const reduced = prefersReducedMotion();
  const transition = reduced ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div className="h-full relative overflow-hidden">
      {/* ── Base view (article list) ── */}
      <div
        className="absolute inset-0"
        style={{ transform: `translateX(${listX}px)`, transition }}
      >
        {base}
      </div>

      {/* ── Dim layer ── */}
      {mounted && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'black',
            opacity: dimOpacity,
            transition: reduced ? 'none' : 'opacity 0.35s ease',
          }}
        />
      )}

      {/* ── Overlay view (reading pane) ── */}
      {mounted && (
        <div
          className="absolute inset-0 z-20"
          style={{
            transform: `translateX(${overlayX}px)`,
            transition,
            boxShadow: '-2px 0 20px rgba(0,0,0,0.1)',
            background: 'var(--panel-bg)',
          }}
        >
          {cachedOverlay.current}
        </div>
      )}
    </div>
  );
}
