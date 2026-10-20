import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { clampToViewport } from '../../lib/clampToViewport';

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * Menu ancré sous son déclencheur, ramené dans la fenêtre, fermé par Échap,
 * clic extérieur ou redimensionnement. Flèches haut/bas entre les éléments.
 *
 * `header` (un champ de filtre) se pose AU-DESSUS du `role="menu"` — un champ
 * de saisie n'est pas un enfant permis d'un menu. Avec lui, le focus part dans
 * le champ ; Flèche bas entre dans la liste, Flèche haut depuis le premier
 * élément y revient, et Tab passe du champ à la liste au lieu de fermer.
 * Sans lui, Tab ferme le menu.
 */
export default function Popover({ anchor, onClose, children, header, label }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; header?: ReactNode; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const box = ref.current;
    if (!anchor || !box) return;
    const r = anchor.getBoundingClientRect();
    const m = box.getBoundingClientRect();
    // Aligné sur le bord droit du déclencheur : il vit à droite de l'en-tête.
    setPos(clampToViewport({
      x: r.right - m.width, y: r.bottom + 4, w: m.width, h: m.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
    (box.querySelector<HTMLElement>('[data-popover-header] input') ?? box.querySelector<HTMLElement>(ITEMS))?.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      const filter = ref.current?.querySelector<HTMLElement>('[data-popover-header] input') ?? null;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
      const active = document.activeElement as HTMLElement | null;
      if (e.key === 'Tab') {
        if (!filter) { onClose(); return; }
        // Deux arrêts : le champ et la liste, dans les deux sens.
        e.preventDefault();
        (active === filter ? items[0] ?? filter : filter).focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (filter && active === filter) {
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); }
        return;
      }
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(active as HTMLElement);
      if (e.key === 'ArrowUp' && i === 0 && filter) { filter.focus(); return; }
      const next = i < 0
        ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
        : (e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length);
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const boxClass = 'fixed z-[61] min-w-[180px] max-w-[min(280px,calc(100vw-16px))] rounded-lg p-1 shadow-xl';
  const boxStyle = { top: pos.top, left: pos.left, background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' };

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden="true" />
      {header ? (
        <div ref={ref} className={boxClass} style={boxStyle}>
          <div data-popover-header>{header}</div>
          <div role="menu" aria-label={label}>{children}</div>
        </div>
      ) : (
        <div ref={ref} role="menu" aria-label={label} className={boxClass} style={boxStyle}>
          {children}
        </div>
      )}
    </>
  );
}
