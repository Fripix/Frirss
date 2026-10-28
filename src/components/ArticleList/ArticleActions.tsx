import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import SavedCategoryPicker from './SavedCategoryPicker';
import { READ_LATER_PREFIX, STARRED_PREFIX } from '../../lib/savedCategories';
import type { Article } from '../../types';
import { rowActionSlots, type RowActionSettings } from '../../lib/rowActions';
import { useLongPress } from '../../hooks/useLongPress';
import { useRegisterRowPress } from '../../hooks/rowPress';
import { safeHref } from '../../lib/safeHref';

/**
 * Classer un article dans une catégorie : un appui long — au doigt ou à la
 * souris (`useLongPress`, `mouse: true`) — ouvre `SavedCategoryPicker`, tandis
 * qu'un clic simple garde son effet immédiat. Le clic droit fait de même, pour
 * qui le cherche. La découverte se fait dans la barre latérale, où vivent les
 * catégories : aucune affordance n'est ajoutée à ces lignes denses.
 *
 * Ce hook ne porte que l'état du sélecteur et son ancre ; le geste est
 * l'appui long commun (tolérance, `touchcancel`, second doigt, écho).
 */
function useCategoryPicker(enabled: boolean) {
  const [picking, setPicking] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const btn = useRef<HTMLButtonElement | null>(null);
  /** Ancre sous le bouton, en coordonnées de la fenêtre. */
  const open = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect();
    if (r) setAnchor({ x: r.left + r.width / 2, y: r.bottom });
    setPicking(true);
  };
  const press = useLongPress(() => open(btn.current), { mouse: true, enabled });
  // Inscrit dans le registre de la ligne : le balayage et le drag natif de
  // la ligne doivent voir cet appui aussi (`rowPress.ts`).
  useRegisterRowPress(press.control);

  const handlers = enabled
    ? {
        ref: btn,
        onTouchStart: press.onTouchStart,
        onTouchMove: press.onTouchMove,
        onTouchEnd: press.onTouchEnd,
        onTouchCancel: press.onTouchCancel,
        onMouseDown: press.onMouseDown,
        onMouseMove: press.onMouseMove,
        onMouseUp: press.onMouseUp,
        onMouseLeave: press.onMouseLeave,
        // Le clic qui termine un appui long ne bascule pas l'état en plus.
        onClickCapture: press.onClickCapture,
        onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
          e.preventDefault();
          // Chrome Android émet `contextmenu` pendant l'appui long (mesuré
          // AVANT le minuteur) : l'appui aboutit alors tout de suite, ou son
          // écho est absorbé. Le sélecteur s'ouvre une fois.
          if (press.claimContextMenu(e)) return;
          open(e.currentTarget);
        },
      }
    : {};

  return { picking, setPicking, handlers, anchor };
}

interface StarButtonProps {
  starred: boolean;
  onClick: (e: ReactMouseEvent) => void;
  /** Enables the file-into-a-category gesture. */
  article?: Article;
}

function StarButton({ starred, onClick, article }: StarButtonProps) {
  const { t } = useTranslation();
  const { picking, setPicking, handlers, anchor } = useCategoryPicker(!!article);
  return (
    <span className="relative inline-flex">
    <button
      {...handlers}
      onClick={onClick}
      data-theme="star-color"
      className="p-1 rounded-full transition-colors hover-tint"
      style={{ color: starred ? 'var(--star-color)' : 'var(--star-inactive)' }}
      aria-label={starred ? t('articleRow.removeStar') : t('articleRow.addStar')}
      aria-pressed={starred}
      title={
        (starred ? t('articleRow.removeStar') : t('articleRow.addStar'))
        + (article ? ` — ${t('saved.holdHint')}` : '')
      }
    >
      <svg
        className="w-3.5 h-3.5"
        fill={starred ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        />
      </svg>
    </button>
    {picking && article && (
      <SavedCategoryPicker prefix={STARRED_PREFIX} article={article} anchor={anchor} onClose={() => setPicking(false)} />
    )}
    </span>
  );
}

interface ReadLaterButtonProps {
  active?: boolean;
  onClick: (e: ReactMouseEvent) => void;
  /** Enables the file-into-a-category gesture. */
  article?: Article;
}

function ReadLaterButton({ active, onClick, article }: ReadLaterButtonProps) {
  const { t } = useTranslation();
  const { picking, setPicking, handlers, anchor } = useCategoryPicker(!!article);
  return (
    <span className="relative inline-flex">
    <button
      {...handlers}
      onClick={onClick}
      data-theme="readlater-color"
      className="p-1 rounded-full transition-colors hover-tint"
      style={{ color: active ? 'var(--readlater-color)' : 'var(--star-inactive)' }}
      aria-label={active ? t('articleRow.removeReadLater') : t('articleRow.addReadLater')}
      aria-pressed={!!active}
      title={
        (active ? t('articleRow.removeReadLater') : t('articleRow.addReadLater'))
        + (article ? ` — ${t('saved.holdHint')}` : '')
      }
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={active ? 2.5 : 2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
    {picking && article && (
      <SavedCategoryPicker prefix={READ_LATER_PREFIX} article={article} anchor={anchor} onClose={() => setPicking(false)} />
    )}
    </span>
  );
}

interface MarkReadButtonProps {
  read: boolean;
  onClick: (e: ReactMouseEvent) => void;
}

function MarkReadButton({ read, onClick }: MarkReadButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="p-1 rounded transition-colors hover-tint"
      style={{ color: read ? 'var(--star-inactive)' : 'var(--accent)' }}
      title={read ? t('articleRow.markUnread') : t('articleRow.markRead')}
      aria-label={read ? t('articleRow.markUnread') : t('articleRow.markRead')}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </button>
  );
}

interface OpenSourceButtonProps {
  /** URL d'origine de l'article, brute : seule une URL `http(s)` devient le `href` (`safeHref`). */
  href: string | undefined;
  onClick: (e: ReactMouseEvent) => void;
}

/**
 * Ouvrir l'article à sa source.
 *
 * Le glyphe est celui de « Ouvrir le site » dans le menu contextuel d'un flux :
 * même verbe, même signe. L'icône porte l'action (« ouvrir ailleurs »), le
 * contexte porte l'objet — un article ici, un flux là-bas.
 *
 * **Un lien, pas un bouton** (issue #21) : les extensions de prévisualisation,
 * « copier l'adresse du lien » et le clic molette natif lisent le `href`. Le
 * clic simple, lui, est neutralisé (`preventDefault`) et passe par `onClick`
 * comme avant — c'est ce gestionnaire qui ouvre l'onglet ET sélectionne
 * l'article (`openArticleAtSource`), le même chemin que le clic molette sur
 * la ligne ; laisser la navigation native en plus ouvrirait l'URL deux fois.
 *
 * Pas de geste d'appui long, contrairement à l'étoile et à « à lire plus
 * tard » : cette action n'a rien à classer.
 *
 * Le `href` passe par `safeHref` : une URL non `http(s)` laisse l'emplacement
 * réservé en amont (`rowActionSlots`), et ce composant la refuse aussi de son
 * côté — un second appelant qui ne consulterait pas les emplacements ne
 * rendrait jamais un `javascript:` en lien.
 */
export function OpenSourceButton({ href, onClick }: OpenSourceButtonProps) {
  const { t } = useTranslation();
  return (
    <a
      href={safeHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { e.preventDefault(); onClick(e); }}
      className="p-1 rounded inline-flex transition-colors hover-tint"
      style={{ color: 'var(--star-inactive)' }}
      title={t('articleRow.openSource')}
      aria-label={t('articleRow.openSource')}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

interface ArticleRowActionsProps {
  article: Article;
  isReadLater: boolean;
  /** Classe du conteneur : chaque mode d'affichage garde sa disposition. */
  className: string;
  /** Réglages de visibilité. La grille passe les mêmes que les lignes. */
  settings: RowActionSettings;
  /** Utilisé par la grille, qui empêche le clic d'atteindre la carte. */
  onContainerClick?: (e: ReactMouseEvent) => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
  onOpenSource: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
}

/**
 * La barre d'actions d'une ligne — un seul composant pour les trois modes.
 *
 * Avant, les trois boutons étaient écrits trois fois, et la ligne compacte
 * n'avait même pas de conteneur : ses boutons étaient enfants directs de la
 * ligne, donc écartés du `gap-3` de celle-ci, comme le titre et l'heure.
 *
 * Un emplacement indisponible (`available: false`) rend une case VIDE de la
 * même taille qu'un bouton, jamais rien : c'est ce qui empêche le ✓ de danser
 * d'une ligne à l'autre. Même raison que la pastille « non lu », dont la place
 * est déjà réservée quelques lignes plus haut dans `ArticleList.tsx`.
 */
export function ArticleRowActions({
  article, isReadLater, className, settings,
  onContainerClick, onToggleStar, onToggleReadLater, onOpenSource, onToggleRead,
}: ArticleRowActionsProps) {
  const slots = rowActionSlots(article, settings);
  if (!slots.length) return null;
  return (
    <div className={className} onClick={onContainerClick}>
      {slots.map((slot) => {
        if (!slot.available) {
          // Même boîte qu'un bouton : `p-1` autour d'un carré de 3.5.
          return (
            <span key={slot.kind} className="p-1 inline-flex" aria-hidden="true">
              <span className="w-3.5 h-3.5" />
            </span>
          );
        }
        switch (slot.kind) {
          case 'star':
            return <StarButton key={slot.kind} starred={article.starred} onClick={onToggleStar} article={article} />;
          case 'readLater':
            return <ReadLaterButton key={slot.kind} active={isReadLater} onClick={onToggleReadLater} article={article} />;
          case 'openSource':
            return <OpenSourceButton key={slot.kind} href={article.url} onClick={onOpenSource} />;
          case 'markRead':
            return <MarkReadButton key={slot.kind} read={article.read} onClick={onToggleRead} />;
        }
      })}
    </div>
  );
}
