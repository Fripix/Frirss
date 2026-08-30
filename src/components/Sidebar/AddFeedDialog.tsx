import { useState, useMemo, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';

interface AddFeedDialogProps {
  onClose: () => void;
}

export default function AddFeedDialog({ onClose }: AddFeedDialogProps) {
  const { t } = useTranslation();
  const { subscriptions, addFeed } = useFeedStore();
  const [feedUrl, setFeedUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    subscriptions.forEach((sub) => {
      const cat = sub.categories?.[0];
      if (cat) map[cat.id] = cat.label;
    });
    return Object.entries(map).map(([id, label]) => ({ id, label }));
  }, [subscriptions]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!feedUrl.trim()) return;

    setLoading(true);
    setError('');

    const catId = category === '__new__' && newCategory.trim()
      ? `user/-/label/${newCategory.trim()}`
      : category;
    const catLabel = category === '__new__' && newCategory.trim()
      ? newCategory.trim()
      : categories.find((c) => c.id === category)?.label || '';

    const ok = await addFeed(feedUrl.trim(), title.trim(), catId, catLabel);

    setLoading(false);
    if (ok) {
      onClose();
    } else {
      setError(t('addFeed.error'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="w-full max-w-md rounded-xl shadow-2xl p-6"
        style={{ background: 'var(--panel-bg)' }}
      >
        <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--list-title)' }}>
          {t('addFeed.title')}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Feed URL */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.urlLabel')} *
            </label>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder={t('addFeed.urlPlaceholder')}
              required
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
            />
          </div>

          {/* Title (optional) */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.nameLabel')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('addFeed.namePlaceholder')}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.categoryLabel')}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
            >
              <option value="">{t('addFeed.noneCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
              <option value="__new__">+ {t('addFeed.newCategory')}</option>
            </select>
          </div>

          {/* New category name */}
          {category === '__new__' && (
            <div>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t('addFeed.newCategoryPlaceholder')}
                className="w-full text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
                style={{
                  borderColor: 'var(--panel-border)',
                  color: 'var(--list-title)',
                  background: 'var(--panel-bg)',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
                autoFocus
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !feedUrl.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              {loading ? t('addFeed.adding') : t('addFeed.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
