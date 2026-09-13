import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Article } from '../../types';
import BottomSheet from '../BottomSheet';
import { articleMenuItems, type ArticleMenuKind } from '../../lib/articleMenu';
import { clampToViewport } from '../../lib/clampToViewport';

interface ArticleContextMenuProps {
  article: Article;
  isReadLater: boolean;
  /** Point d'ouverture, en coordonnées de fenêtre (ignoré en feuille du bas). */
  x: number;
  y: number;
  /** Téléphone : feuille du bas. Ailleurs : menu flottant. */
  sheet: boolean;
  onClose: () => void;
  onOpenSource: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleReadLater: () => void;
  onCopyLink: () => void;
}

/**
 * Menu contextuel d'un article — clic droit, touche Menu, appui long.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 *
 * Boutons simples, pas `role="menu"` : aucun menu de l'application ne l'a, et ce
 * rôle promet une navigation aux flèches qu'on ne fournit pas.
 * Le menu flottant est rendu dans un portail : un ancêtre transformé (les
 * animations de la liste) rendrait sinon `position: fixed` relatif à lui.
 */
export default function ArticleContextMenu({
  article, isReadLater, x, y, sheet,
  onClose, onOpenSource, onToggleRead, onToggleStar, onToggleReadLater, onCopyLink,
}: ArticleContextMenuProps) {
  const { t } = useTranslation();
  const items = articleMenuItems(article, isReadLater);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const actions: Record<ArticleMenuKind, () => void> = {
    openSource: onOpenSource,
    toggleRead: onToggleRead,
    toggleStar: onToggleStar,
    toggleReadLater: onToggleReadLater,
    copyLink: onCopyLink,
  };
  const run = (kind: ArticleMenuKind) => {
    actions[kind]();
    onClose();
  };

  // Menu flottant : fermeture au `pointerdown` extérieur — pas `mousedown`, qu'iOS
  // n'émet pas avant le clic — et à Échap. La feuille du bas gère les siens.
  useEffect(() => {
    if (sheet) return;
    function onPointerDown(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [sheet, onClose]);

  // Replacé dans la fenêtre APRÈS mesure : la largeur dépend du plus long libellé
  // traduit. `useLayoutEffect` corrige avant la peinture, sans saut visible.
  useLayoutEffect(() => {
    if (sheet) return;
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(clampToViewport({
      x, y, w: r.width, h: r.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
  }, [sheet, x, y, items.length]);

  // Menu flottant seulement : ouvert au clavier (touche Menu), il doit rester
  // utilisable au clavier. Focus sur la première entrée à l'ouverture, rendu à
  // l'élément qui l'avait à la fermeture — sauf s'il a déjà perdu ce focus
  // autrement (fermeture par clic ailleurs, qui a déjà déplacé le focus).
  // `useLayoutEffect`, pas `useEffect` : le nettoyage doit encore pouvoir lire
  // `menuRef` au démontage, avant que React ne détache le DOM.
  useLayoutEffect(() => {
    if (sheet) return;
    const previouslyFocused = document.activeElement;
    const menuEl = menuRef.current;
    const firstButton = menuEl?.querySelector('button');
    firstButton?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const stillInMenu = active === document.body || active === null
        || (menuEl?.contains(active) ?? false);
      if (stillInMenu && previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [sheet]);

  if (sheet) {
    return (
      <BottomSheet open onClose={onClose} title={article.title}>
        {items.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => run(item.kind)}
            className="sheet-row w-full flex items-center px-4 py-2.5 text-left font-medium transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-title)' }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </BottomSheet>
    );
  }

  const style: CSSProperties = {
    position: 'fixed', left: pos.left, top: pos.top, zIndex: 100,
    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    minWidth: '200px', overflow: 'hidden',
  };

  return createPortal(
    <div ref={menuRef} style={style} className="py-1">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          onClick={() => run(item.kind)}
          className="w-full flex items-center px-3 py-2 text-xs text-left transition-colors hover:bg-black/5"
          style={{ color: 'var(--list-title)' }}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
