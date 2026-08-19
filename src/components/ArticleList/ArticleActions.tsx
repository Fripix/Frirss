import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import SavedCategoryPicker from './SavedCategoryPicker';
import { READ_LATER_PREFIX, STARRED_PREFIX } from '../../lib/savedCategories';
import type { Article } from '../../types';

/**
 * Long press (touch) or right-click (desktop) opens the category picker, while
 * a plain click keeps its instant behaviour — filing must never slow saving.
 */
function useFileGesture(enabled: boolean) {
  const [picking, setPicking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => { if (enabled) timer.current = setTimeout(() => setPicking(true), 500); };
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const handlers = enabled
    ? {
        onTouchStart: start,
        onTouchEnd: cancel,
        onTouchMove: cancel,
        onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); setPicking(true); },
      }
    : {};
  return { picking, setPicking, handlers };
}

interface StarButtonProps {
  starred: boolean;
  onClick: (e: ReactMouseEvent) => void;
  /** Enables the file-into-a-category gesture. */
  article?: Article;
}

export function StarButton({ starred, onClick, article }: StarButtonProps) {
  const { t } = useTranslation();
  const { picking, setPicking, handlers } = useFileGesture(!!article);
  return (
    <span className="relative inline-flex">
    <button
      {...handlers}
      onClick={onClick}
      data-theme="star-color"
      className="p-1 rounded-full transition-colors hover:bg-black/5"
      style={{ color: starred ? 'var(--star-color)' : 'var(--star-inactive)' }}
      title={starred ? t('articleRow.removeStar') : t('articleRow.addStar')}
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
      <SavedCategoryPicker prefix={STARRED_PREFIX} article={article} onClose={() => setPicking(false)} />
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

export function ReadLaterButton({ active, onClick, article }: ReadLaterButtonProps) {
  const { t } = useTranslation();
  const { picking, setPicking, handlers } = useFileGesture(!!article);
  return (
    <span className="relative inline-flex">
    <button
      {...handlers}
      onClick={onClick}
      data-theme="readlater-color"
      className="p-1 rounded-full transition-colors hover:bg-black/5"
      style={{ color: active ? 'var(--readlater-color)' : 'var(--star-inactive)' }}
      title={active ? t('articleRow.removeReadLater') : t('articleRow.addReadLater')}
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
      <SavedCategoryPicker prefix={READ_LATER_PREFIX} article={article} onClose={() => setPicking(false)} />
    )}
    </span>
  );
}

interface MarkReadButtonProps {
  read: boolean;
  onClick: (e: ReactMouseEvent) => void;
}

export function MarkReadButton({ read, onClick }: MarkReadButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="p-1 rounded transition-colors hover:bg-black/5"
      style={{ color: read ? 'var(--star-inactive)' : 'var(--accent)' }}
      title={read ? t('articleRow.markUnread') : t('articleRow.markRead')}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </button>
  );
}
