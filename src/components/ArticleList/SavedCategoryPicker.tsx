import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';
import { savedCategories } from '../../lib/savedCategories';
import { useUiStore } from '../../stores/uiStore';
import type { Article } from '../../types';

interface Props {
  prefix: string;
  article: Article;
  /** Where to anchor the popover, in viewport coordinates. */
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * File a saved article into a category, or create one on the spot — the
 * Instagram-style gesture the request was really about. Categories are prefixed
 * labels, so this only ever calls toggleArticleLabel.
 */
export default function SavedCategoryPicker({ prefix, article, anchor, onClose }: Props) {
  const { t } = useTranslation();
  const labels = useFeedStore((s) => s.labels);
  const toggleArticleLabel = useFeedStore((s) => s.toggleArticleLabel);
  const names = useUiStore((s) => s.savedCategoryNames[prefix]);
  const cats = savedCategories(labels, prefix, names);

  const file = (labelId: string) => {
    toggleArticleLabel(article, labelId);
    onClose();
  };

  // A portal, not an inline popover: inside the toolbar it was clipped by the
  // surrounding flex row and pushed the buttons around.
  const WIDTH = 210;
  const left = Math.min(Math.max(8, anchor.x - WIDTH / 2), window.innerWidth - WIDTH - 8);
  const top = Math.min(anchor.y + 6, window.innerHeight - 260);

  return createPortal(
    <>
      {/* Click-away layer */}
      <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        className="fixed z-[61] rounded-lg shadow-xl py-1"
        style={{
          left, top, width: WIDTH,
          background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--list-time)' }}
        >
          {t('saved.fileInto')}
        </div>

        {cats.map((cat) => {
          const inIt = article.labels?.includes(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => file(cat.id)}
              className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-black/5"
              style={{ color: inIt ? 'var(--accent)' : 'var(--list-title)' }}
            >
              <span className="w-3">{inIt ? '✓' : ''}</span>
              <span className="truncate">{cat.name}</span>
            </button>
          );
        })}

        {!cats.length && (
          <div className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--list-summary)' }}>
            {t('saved.noCategory')}
          </div>
        )}

      </div>
    </>,
    document.body,
  );
}
