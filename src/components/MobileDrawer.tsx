import { useRef, useEffect, useState, useCallback, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { prefersReducedMotion } from '../lib/reducedMotion';

interface DrawerTouch {
  startX?: number;
  startY?: number;
  decided?: boolean;
  active?: boolean;
}

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/**
 * iOS-style sidebar drawer.
 * - Slides in from the left with dark backdrop
 * - Interactive close: swipe left follows finger
 * - Backdrop opacity tracks drawer position
 * - Close via: backdrop tap, swipe left, Escape
 */
export default function MobileDrawer({ open, onClose, children, width = 280 }: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchRef = useRef<DrawerTouch>({});

  // Lock body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Reset drag on open/close
  useEffect(() => {
    setDragX(0);
    setDragging(false);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Touch handlers (via native listener for passive:false) ───────
  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const x = e.touches[0].clientX;
    touchRef.current = {
      startX: x,
      startY: e.touches[0].clientY,
      decided: false,
      active: false,
    };
  }, []);

  useEffect(() => {
    const el = drawerRef.current;
    if (!el || !open) return;

    function handleMove(e: TouchEvent) {
      const t = touchRef.current;
      if (t.startX === undefined || t.startY === undefined) return;

      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;

      if (!t.decided) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          t.decided = true;
          t.active = Math.abs(dx) > Math.abs(dy);
        }
        return;
      }
      if (!t.active) return;

      e.preventDefault();
      setDragX(Math.min(0, dx)); // Only leftward
      setDragging(true);
    }

    el.addEventListener('touchmove', handleMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleMove);
  }, [open]);

  const handleTouchEnd = useCallback(() => {
    if (!dragging) { touchRef.current = {}; return; }

    if (dragX < -(width * 0.35)) {
      onClose();
    }
    setDragX(0);
    setDragging(false);
    touchRef.current = {};
  }, [dragging, dragX, width, onClose]);

  // ── Computed styles ──────────────────────────────────────────────
  const progress = open ? Math.max(0, 1 + dragX / width) : 0; // 1 = fully open

  // These durations are inline styles, so no `@media (prefers-reduced-motion)`
  // rule can reach them — the preference has to be read in JS.
  const reduced = prefersReducedMotion();
  const transition = dragging || reduced
    ? 'none'
    : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.35s ease';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: open ? (dragging ? progress : 1) : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: dragging || reduced ? 'none' : 'opacity 0.35s ease',
        }}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed top-0 left-0 h-full z-50 shadow-2xl overflow-hidden"
        style={{
          width,
          transform: open
            ? `translateX(${dragging ? dragX : 0}px)`
            : `translateX(-${width}px)`,
          transition,
          pointerEvents: open ? 'auto' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </>
  );
}
