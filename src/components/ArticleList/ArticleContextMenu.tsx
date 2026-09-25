import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Article } from '../../types';
import BottomSheet from '../BottomSheet';
import { articleMenuItems, type ArticleMenuItem, type ArticleMenuKind } from '../../lib/articleMenu';
import { clampToViewport } from '../../lib/clampToViewport';
import { markAllReadAction } from '../../lib/markAllRead';

/** Direction d'un marquage de plage, pour les deux seules entrées concernées. */
type RangeDirection = 'above' | 'below';
const RANGE_DIRECTION: Partial<Record<ArticleMenuKind, RangeDirection>> = {
  markBelowRead: 'below',
  markAboveRead: 'above',
};

/**
 * Icônes du menu — retouche visuelle décidée avec le propriétaire.
 *
 * Chaque entrée reprend le MÊME tracé SVG que le même geste sur une ligne
 * d'article (`ArticleActions.tsx` / `ReadingPane.tsx`) : on ne fabrique pas un
 * second vocabulaire pour désigner la même action. Les deux marquages de
 * plage n'ont pas d'icône existante : ils reprennent le ✓ de « Marquer lu »,
 * accompagné d'un chevron directionnel — elles doivent se lire comme des
 * variantes de « Marquer lu », pas comme des actions étrangères. Les groupes
 * scale/stroke-width des sous-tracés compensent la mise à l'échelle, pour
 * garder un trait visuellement proche des 1.75 px des icônes simples.
 */
function ArticleMenuIcon({ kind }: { kind: ArticleMenuKind }) {
  switch (kind) {
    case 'openSource':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      );
    case 'toggleRead':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'markAboveRead':
    case 'markBelowRead':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <g transform="translate(-1,5) scale(0.72)">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
          </g>
          <g transform="translate(9,-3) scale(0.62)">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.6}
              d={kind === 'markAboveRead' ? 'M12 19V5m0 0l-6 6m6-6l6 6' : 'M12 5v14m0 0l-6-6m6 6l6-6'}
            />
          </g>
        </svg>
      );
    case 'toggleStar':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      );
    case 'toggleReadLater':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'copyLink':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
      );
  }
}

/** Largeur de la colonne d'icône : fixe, pour que les libellés s'alignent. */
const ICON_COLUMN: CSSProperties = {
  width: 20, height: 20, flex: '0 0 20px',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

interface ArticleContextMenuProps {
  article: Article;
  isReadLater: boolean;
  /** `canMarkAllRead(filter)` : porte jusqu'ici le refus de Favoris et À lire
   * plus tard — une entrée qui ne fait rien est plus déroutante qu'une entrée
   * absente. */
  canMarkRange: boolean;
  /** Réglage « Confirmer avant de tout marquer comme lu » (`uiStore`) : les
   * deux marquages de plage le respectent, comme le bouton « Tout lu ». */
  confirmMarkAllRead: boolean;
  /** Point d'ouverture, en coordonnées de fenêtre (ignoré en feuille du bas). */
  x: number;
  y: number;
  /** Téléphone : feuille du bas. Ailleurs : menu flottant. */
  sheet: boolean;
  onClose: () => void;
  onOpenSource: () => void;
  onToggleRead: () => void;
  /** Marquage de plage (au-dessus/en dessous) : une seule prop, direction en paramètre —
   * la correspondance entrée→direction vit ici, là où ce fichier la teste, plutôt que
   * dans deux littéraux câblés côté appelant et jamais vérifiés. */
  onMarkRange: (direction: 'above' | 'below') => void;
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
  article, isReadLater, canMarkRange, confirmMarkAllRead, x, y, sheet,
  onClose, onOpenSource, onToggleRead, onMarkRange,
  onToggleStar, onToggleReadLater, onCopyLink,
}: ArticleContextMenuProps) {
  const { t } = useTranslation();
  const items = articleMenuItems(article, isReadLater, canMarkRange);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Marquage de plage en attente de confirmation (réglage `confirmMarkAllRead`,
  // comme le bouton « Tout lu » — `markAllReadAction`). Une seule direction à
  // la fois : cliquer l'autre entrée redemande pour elle, ce qui annule
  // implicitement la première demande. Le menu se démonte à la fermeture,
  // donc quitter le menu annule la demande sans code dédié.
  const [confirming, setConfirming] = useState<RangeDirection | null>(null);

  const actions: Record<ArticleMenuKind, () => void> = {
    openSource: onOpenSource,
    toggleRead: onToggleRead,
    markBelowRead: () => onMarkRange('below'),
    markAboveRead: () => onMarkRange('above'),
    toggleStar: onToggleStar,
    toggleReadLater: onToggleReadLater,
    copyLink: onCopyLink,
  };
  const run = (kind: ArticleMenuKind) => {
    const direction = RANGE_DIRECTION[kind];
    if (direction) {
      if (markAllReadAction(confirmMarkAllRead, confirming === direction) === 'ask') {
        setConfirming(direction);
        return;
      }
    }
    actions[kind]();
    onClose();
  };
  const labelFor = (item: (typeof items)[number]): string => {
    const direction = RANGE_DIRECTION[item.kind];
    if (direction && confirming === direction) return t('articleList.confirm');
    return t(item.labelKey);
  };
  // Icône secondaire (`--list-summary`) par défaut ; sur l'entrée en attente
  // de confirmation, elle suit la couleur du libellé (`--list-title`) — seul
  // le libellé change côté texte, mais l'icône doit rester cohérente avec lui.
  const iconColorFor = (item: ArticleMenuItem): string => {
    const direction = RANGE_DIRECTION[item.kind];
    if (direction && confirming === direction) return 'var(--list-title)';
    return 'var(--list-summary)';
  };
  // Un filet ne sépare que deux entrées de groupes DIFFÉRENTS — jamais à
  // l'intérieur d'un même groupe, et jamais avant la première entrée.
  const needsDividerBefore = (item: ArticleMenuItem, index: number): boolean =>
    index > 0 && items[index - 1].group !== item.group;
  const divider = <div className="article-menu-divider" style={{ height: 1, margin: '4px 0', background: 'var(--panel-border)' }} />;

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
        {items.map((item, index) => (
          <Fragment key={item.kind}>
            {needsDividerBefore(item, index) && divider}
            <button
              type="button"
              onClick={() => run(item.kind)}
              className="sheet-row w-full flex items-center gap-3 px-4 py-2.5 text-left font-medium transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-title)' }}
            >
              <span aria-hidden="true" style={{ ...ICON_COLUMN, color: iconColorFor(item) }}>
                <ArticleMenuIcon kind={item.kind} />
              </span>
              {labelFor(item)}
            </button>
          </Fragment>
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
      {items.map((item, index) => (
        <Fragment key={item.kind}>
          {needsDividerBefore(item, index) && divider}
          <button
            type="button"
            onClick={() => run(item.kind)}
            className="context-menu-item w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-title)' }}
          >
            <span aria-hidden="true" style={{ ...ICON_COLUMN, color: iconColorFor(item) }}>
              <ArticleMenuIcon kind={item.kind} />
            </span>
            {labelFor(item)}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
