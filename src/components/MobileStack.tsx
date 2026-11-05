import { useRef, useState, useEffect, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/reducedMotion';

interface MobileStackProps {
  showOverlay: boolean;
  /**
   * L'article affiché : à la fermeture, le focus revient sur sa ligne
   * (`[data-article-id]`) dans la vue de base. Sans lui, le bouton Retour
   * partait sous le focus et la tabulation repartait du haut de la page.
   */
  focusKey?: string | null;
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
export default function MobileStack({ showOverlay, focusKey, base, overlay }: MobileStackProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Cache overlay content during exit animation
  const cachedOverlay = useRef<ReactNode>(null);
  if (overlay) cachedOverlay.current = overlay;

  const baseRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef<string | null>(null);
  if (focusKey) lastKey.current = focusKey;
  const wasShown = useRef(showOverlay);

  // ── Retour du focus ──────────────────────────────────────────────
  // Seulement si le focus était dans l'article (ou déjà perdu) : un focus
  // posé ailleurs entre-temps n'est pas à nous.
  useEffect(() => {
    const closing = wasShown.current && !showOverlay;
    wasShown.current = showOverlay;
    if (!closing) return;
    const active = document.activeElement;
    const inOverlay = !!active && !!overlayRef.current?.contains(active);
    if (!inOverlay && active && active !== document.body) return;
    const key = lastKey.current;
    const row = key
      ? Array.from(baseRef.current?.querySelectorAll<HTMLElement>('[data-article-id]') ?? [])
        .find((el) => el.getAttribute('data-article-id') === key)
      : undefined;
    row?.focus({ preventScroll: true });
  }, [showOverlay]);

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
      {/* ── Base view (article list) ──
          Inerte sous l'article : elle reste montée (position de défilement),
          mais ni la tabulation ni un lecteur d'écran ne doivent l'atteindre. */}
      <div
        ref={baseRef}
        className="absolute inset-0"
        style={{ transform: `translateX(${listX}px)`, transition }}
        inert={showOverlay}
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

      {/* ── Overlay view (reading pane) ── inerte dès qu'il repart, pendant
          son animation de sortie. */}
      {mounted && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-20"
          style={{
            transform: `translateX(${overlayX}px)`,
            transition,
            boxShadow: '-2px 0 20px rgba(0,0,0,0.1)',
            background: 'var(--panel-bg)',
          }}
          inert={!showOverlay}
        >
          {cachedOverlay.current}
        </div>
      )}
    </div>
  );
}
