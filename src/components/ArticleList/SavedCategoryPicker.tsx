import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';
import { savedCategories, categoryLabelId } from '../../lib/savedCategories';
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
  const [name, setName] = useState('');
  const cats = savedCategories(labels, prefix);

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

        <div className="h-px mx-2 my-1" style={{ background: 'var(--panel-border)' }} />
        <form
          className="px-2 pb-1 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            file(categoryLabelId(prefix, name));
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('saved.newCategory')}
            className="flex-1 min-w-0 px-2 py-1 rounded text-xs"
            style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)', color: 'var(--list-title)' }}
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-2 py-1 rounded text-xs disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            +
          </button>
        </form>
      </div>
    </>
  );
}
