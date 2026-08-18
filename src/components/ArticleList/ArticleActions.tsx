import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface StarButtonProps {
  starred: boolean;
  onClick: (e: ReactMouseEvent) => void;
}

export function StarButton({ starred, onClick }: StarButtonProps) {
  const { t } = useTranslation();
  return (
    <button
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
  );
}

interface ReadLaterButtonProps {
  active?: boolean;
  onClick: (e: ReactMouseEvent) => void;
}

export function ReadLaterButton({ active, onClick }: ReadLaterButtonProps) {
  const { t } = useTranslation();
  return (
    <button
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
