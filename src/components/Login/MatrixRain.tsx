import { useEffect, useRef } from 'react';

/**
 * Matrix-style digital rain rendered on a full-screen canvas.
 * Sits behind the login form (absolutely positioned, pointer-events: none).
 *
 * - Colour is derived from the theme accent (--accent), so it matches the app.
 * - Honours prefers-reduced-motion: paints a single static frame, no animation.
 */
export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resolve the accent colour from the theme (fallback: classic green)
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
      '#4cd4a1';

    const glyphs =
      'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789ABCDEFRSS<>=*+-#';
    const fontSize = 16;
    let columns = 0;
    let drops: number[] = [];
    let width = 0;
    let height = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.ceil(width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -height / fontSize);
      // Clear to the sidebar background once after a resize
      ctx!.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-bg').trim() || '#201f1b';
      ctx!.fillRect(0, 0, width, height);
    }

    function randomGlyph() {
      return glyphs.charAt(Math.floor(Math.random() * glyphs.length));
    }

    function drawFrame() {
      // Translucent black overlay creates the fading trail
      ctx!.fillStyle = 'rgba(10, 10, 12, 0.08)';
      ctx!.fillRect(0, 0, width, height);
      ctx!.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        // Leading glyph is brighter (white-ish), trail uses the accent
        ctx!.fillStyle = Math.random() > 0.975 ? '#ffffff' : accent;
        ctx!.fillText(randomGlyph(), x, y);

        if (y > height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5;
      }
    }

    resize();
    window.addEventListener('resize', resize);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let rafId: number | undefined;

    if (reduceMotion) {
      // Single dim static frame — no animation loop
      ctx.globalAlpha = 0.4;
      drawFrame();
      ctx.globalAlpha = 1;
    } else {
      let last = 0;
      const loop = (ts: number) => {
        // Throttle to ~24 fps for a calmer, less CPU-hungry effect
        if (ts - last >= 42) {
          drawFrame();
          last = ts;
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      window.removeEventListener('resize', resize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
