import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';
import { savedCategories } from '../../lib/savedCategories';
import { useUiStore } from '../../stores/uiStore';
import type { Article } from '../../types';

interface Props {
  prefix: string;
  article: Article;
  onClose: () => void;
}

/**
 * File a saved article into a category, or create one on the spot — the
 * Instagram-style gesture the request was really about. Categories are prefixed
 * labels, so this only ever calls toggleArticleLabel.
 */
export default function SavedCategoryPicker({ prefix, article, onClose }: Props) {
  const { t } = useTranslation();
  const labels = useFeedStore((s) => s.labels);
  const toggleArticleLabel = useFeedStore((s) => s.toggleArticleLabel);
  const names = useUiStore((s) => s.savedCategoryNames[prefix]);
  const cats = savedCategories(labels, prefix, names);

  const file = (labelId: string) => {
    toggleArticleLabel(article, labelId);
    onClose();
  };

  return (
    <>
      {/* Click-away layer */}
      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-xl py-1 min-w-[190px]"
        style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
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
    </>
  );
}
