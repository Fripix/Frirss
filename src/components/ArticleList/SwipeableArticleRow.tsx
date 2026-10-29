import { useRef, useState, useEffect, useCallback, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { LONG_PRESS_MOVE_TOLERANCE_PX } from '../../hooks/useLongPress';

/** Distance à partir de laquelle la direction du geste est décidée : la
 *  tolérance de l'appui long, importée pour que les deux ne divergent jamais. */
const DECIDE_PX = LONG_PRESS_MOVE_TOLERANCE_PX;
const THRESHOLD = 80;
const MAX_DRAG = 130;

interface RowTouch {
  startX?: number;
  startY?: number;
  decided?: boolean;
  active?: boolean;
}

interface SwipeableArticleRowProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeLeftLabel?: string;
  swipeRightLabel?: string;
  swipeLeftColor?: string;
  swipeRightColor?: string;
  /** Encre du libellé révélé, lisible sur sa couleur (blanc par défaut). */
  swipeLeftInk?: string;
  swipeRightInk?: string;
  /** Appelé une fois, dès que la direction du geste est décidée (horizontale
   *  ou verticale) : l'appelant y annule l'appui long en cours. */
  onSwipeDecided?: () => void;
  /** Vrai quand un appui long a abouti pendant ce contact : le menu est
   *  ouvert, le balayage ne déclenche plus rien. */
  swipeBlocked?: () => boolean;
}

/**
 * iOS-style swipe actions for article rows.
 * - Swipe left → action (e.g. toggle read/unread)
 * - Swipe right → action (e.g. read later)
 * Row content slides with finger, revealing colored action panel behind.
 *
 * L'appui long (menu de l'article) et le balayage s'excluent : la direction
 * décidée annule l'appui long (`onSwipeDecided`), et un appui long abouti
 * bloque le balayage (`swipeBlocked`). Sans quoi un doigt posé ouvrait le menu
 * à 500 ms, puis le glisser qui suivait basculait AUSSI lu / à lire plus tard.
 */
export default function SwipeableArticleRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  swipeLeftLabel = 'Lu',
  swipeRightLabel = 'Plus tard',
  swipeLeftColor = 'var(--accent)',
  swipeRightColor = 'var(--accent)',
  swipeLeftInk = 'var(--on-accent)',
  swipeRightInk = 'var(--on-accent)',
  onSwipeDecided,
  swipeBlocked,
}: SwipeableArticleRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchRef = useRef<RowTouch>({});
  // Le gestionnaire natif ci-dessous est posé une fois : il lit les props
  // courantes par ces refs.
  const decidedRef = useRef(onSwipeDecided);
  const blockedRef = useRef(swipeBlocked);
  useEffect(() => {
    decidedRef.current = onSwipeDecided;
    blockedRef.current = swipeBlocked;
  });

  // Native touchmove for passive:false (allows e.preventDefault)
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    function handleMove(e: TouchEvent) {
      const t = touchRef.current;
      if (t.startX === undefined || t.startY === undefined) return;

      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;

      // Decide gesture direction once
      if (!t.decided) {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return; // not enough movement
        t.decided = true;
        decidedRef.current?.();
        // Le menu de l'appui long est ouvert : ce contact ne balaie plus.
        if (blockedRef.current?.()) { t.active = false; return; }
        t.active = Math.abs(dx) > Math.abs(dy) * 1.2;
        if (!t.active) return; // vertical → let browser scroll
        // horizontal → fall through to preventDefault on this same event
      }
      if (!t.active) return;

      e.preventDefault(); // Block scroll + suppress click
      // Rubber-band resistance past threshold
      const sign = Math.sign(dx);
      const abs = Math.abs(dx);
      const clamped = abs <= THRESHOLD
        ? abs
        : THRESHOLD + (abs - THRESHOLD) * 0.3;
      setDragX(sign * Math.min(clamped, MAX_DRAG));
      setDragging(true);
    }

    el.addEventListener('touchmove', handleMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleMove);
  }, []);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      decided: false,
      active: false,
    };
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!dragging) { touchRef.current = {}; return; }

    if (swipeBlocked?.()) {
      // Filet : rien ne devrait arriver ici, la direction décidée ayant annulé
      // l'appui long — mais un balayage ne doit jamais suivre un menu ouvert.
    } else if (dragX < -THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    } else if (dragX > THRESHOLD && onSwipeRight) {
      onSwipeRight();
    }

    setDragX(0);
    setDragging(false);
    touchRef.current = {};
  }, [dragging, dragX, onSwipeLeft, onSwipeRight, swipeBlocked]);

  // Le système reprend le contact (iOS : bandeau d'appel, centre de
  // notifications, indicateur d'accueil) : rien n'est décidé, la ligne revient.
  // Sans cela, elle restait décalée et la tape suivante exécutait le balayage.
  const handleTouchCancel = useCallback(() => {
    setDragX(0);
    setDragging(false);
    touchRef.current = {};
  }, []);

  const isLeft = dragX < 0;  // Swiping left — reveals right-side action
  const isRight = dragX > 0; // Swiping right — reveals left-side action
  const progress = Math.min(1, Math.abs(dragX) / THRESHOLD);

  return (
    <div
      ref={rowRef}
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Action revealed when swiping RIGHT (read later) */}
      {isRight && (
        <div
          className="absolute inset-0 flex items-center pl-5"
          style={{ background: swipeRightColor }}
        >
          <div
            className="flex items-center gap-2"
            style={{ color: swipeRightInk, opacity: progress, transform: `scale(${0.8 + progress * 0.2})` }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold">{swipeRightLabel}</span>
          </div>
        </div>
      )}

      {/* Action revealed when swiping LEFT (read/unread) */}
      {isLeft && (
        <div
          className="absolute inset-0 flex items-center justify-end pr-5"
          style={{ background: swipeLeftColor }}
        >
          <div
            className="flex items-center gap-2"
            style={{ color: swipeLeftInk, opacity: progress, transform: `scale(${0.8 + progress * 0.2})` }}
          >
            <span className="text-xs font-semibold">{swipeLeftLabel}</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}

      {/* Sliding content */}
      <div
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
          position: 'relative',
          zIndex: 1,
          background: 'var(--panel-bg)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
