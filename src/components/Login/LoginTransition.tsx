import { useLayoutEffect, useRef } from 'react';

interface LoginTransitionProps {
  variant?: string;
  onDone?: () => void;
}

/**
 * Full-screen Matrix-styled transition played once, right after login,
 * over the freshly-mounted interface. Variants:
 *
 *  - 'surge'    : rain accelerates, then the whole layer fades out.
 *  - 'portal'   : an iris hole opens from the centre (glowing accent ring) to reveal the app.
 *  - 'scanline' : a glowing line sweeps top→bottom, clearing the code above it.
 *  - 'drain'    : falling code loses gravity and spirals into the centre.
 *
 * Technique: the canvas paints an opaque sidebar-bg layer (masking the app) plus
 * falling glyphs, then "reveals" the app behind via destination-out compositing
 * (or a container fade for 'surge'). The first frame is painted opaque and
 * synchronously (useLayoutEffect) so the interface is never glimpsed underneath.
 * Honours prefers-reduced-motion.
 */
export default function LoginTransition({ variant = 'portal', onDone }: LoginTransitionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useLayoutEffect(() => {
    const canvas0 = canvasRef.current;
    const container = containerRef.current;
    if (!canvas0 || !container) return;
    const canvas = canvas0; // non-null aliases (narrowing must survive nested closures)
    const ctx0 = canvas.getContext('2d');
    if (!ctx0) return;
    const ctx = ctx0;

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#4cd4a1';
    const bg = css.getPropertyValue('--sidebar-bg').trim() || '#201f1b';

    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789ABCDEFRSS<>=*+-#';
    const fontSize = 16;
    let width = 0, height = 0, columns = 0;
    let drops: number[] = [];
    let speeds: number[] = [];

    const dpr = window.devicePixelRatio || 1;
    function setup() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.ceil(width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * (height / fontSize));
      speeds = Array.from({ length: columns }, () => 0.5 + Math.random() * 0.5);
    }
    setup();

    const randomGlyph = () => glyphs.charAt((Math.random() * glyphs.length) | 0);

    // Paint an opaque first frame *synchronously* (we're in useLayoutEffect) so the
    // interface underneath is never visible for even a single frame.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    // Seed a populated rain frame so it doesn't start from an empty dark screen
    ctx.font = `${fontSize}px monospace`;
    for (let i = 0; i < columns; i++) {
      const head = drops[i];
      for (let j = 0; j < 6; j++) {
        const yy = (head - j) * fontSize;
        if (yy < 0 || yy > height) continue;
        ctx.fillStyle = j === 0 ? '#ffffff' : accent;
        ctx.globalAlpha = Math.max(0.15, 1 - j * 0.18);
        ctx.fillText(randomGlyph(), i * fontSize, yy);
      }
    }
    ctx.globalAlpha = 1;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const DURATION = reduceMotion ? 450 : 1500;

    const start = performance.now();
    let rafId: number | undefined;

    function finish() {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone?.();
    }

    // Paint the masking layer (opaque bg + accelerating rain)
    function paintRain(speedMul: number, brightness: number) {
      // Trailing fade keeps the rain readable while staying opaque enough to mask
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      ctx.font = `${fontSize}px monospace`;
      for (let i = 0; i < columns; i++) {
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillStyle = Math.random() > 0.96 ? '#ffffff' : accent;
        ctx.globalAlpha = brightness;
        ctx.fillText(randomGlyph(), x, y);
        if (y > height && Math.random() > 0.92) drops[i] = 0;
        drops[i] += speeds[i] * speedMul;
      }
      ctx.globalAlpha = 1;
    }

    function frame(now: number) {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = t * t * (3 - 2 * t); // smoothstep

      if (reduceMotion) {
        // Simple opaque-to-clear fade
        ctx.clearRect(0, 0, width, height);
        ctx.globalAlpha = 1 - eased;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        if (t >= 1) { finish(); return; }
        rafId = requestAnimationFrame(frame);
        return;
      }

      if (variant === 'portal') {
        paintRain(1 + eased * 2, 1);
        // Punch an expanding hole from the centre to reveal the app behind
        const maxR = Math.hypot(width, height) / 2;
        const r = eased * maxR * 1.05;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Glowing accent ring at the hole's edge
        if (r > 2) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        if (t >= 1) { finish(); return; }
      }

      else { // 'scanline'
        // A glowing horizontal line sweeps top→bottom. Above it the code is wiped
        // away to reveal the interface; below it the rain keeps falling.
        paintRain(1 + eased * 1.5, 1);
        const sweepY = eased * height;
        // Reveal everything above the sweep line
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(0, 0, width, sweepY);
        ctx.globalCompositeOperation = 'source-over';
        // Glowing accent scan bar
        if (sweepY > 0 && sweepY < height) {
          ctx.save();
          ctx.shadowColor = accent;
          ctx.shadowBlur = 28;
          const grad = ctx.createLinearGradient(0, sweepY - 14, 0, sweepY + 2);
          grad.addColorStop(0, hexA(accent, 0));
          grad.addColorStop(1, hexA(accent, 0.85));
          ctx.fillStyle = grad;
          ctx.fillRect(0, sweepY - 14, width, 16);
          ctx.fillStyle = accent;
          ctx.fillRect(0, sweepY, width, 2);
          ctx.restore();
        }
        if (t >= 1) { finish(); return; }
      }

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    // Safety: never leave the overlay stuck
    const safety = setTimeout(finish, DURATION + 600);

    function onResize() { setup(); }
    window.addEventListener('resize', onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(safety);
      window.removeEventListener('resize', onResize);
    };
  }, [variant, onDone]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 100 }}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}

// #rrggbb + alpha → rgba()
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
