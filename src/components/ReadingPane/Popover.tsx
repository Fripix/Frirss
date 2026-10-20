import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { clampToViewport } from '../../lib/clampToViewport';

/** Menu ancré sous son déclencheur, ramené dans la fenêtre, fermé par Échap, Tab, clic extérieur ou redimensionnement. */
export default function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    // Aligné sur le bord droit du déclencheur : il vit à droite de l'en-tête.
    setPos(clampToViewport({
      x: r.right - m.width, y: r.bottom + 4, w: m.width, h: m.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab') { onClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[61] min-w-[180px] max-w-[min(280px,calc(100vw-16px))] rounded-lg p-1 shadow-xl"
        style={{ top: pos.top, left: pos.left, background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
      >
        {children}
      </div>
    </>
  );
}
