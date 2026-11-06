import { useState, useMemo, useEffect, useId, useRef, type FormEvent } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBackLayer } from '../../hooks/useAndroidBack';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';
import { nameOwners } from '../../lib/labelNames';
import { newCategoryChoice, subscribedFeed } from '../../lib/addFeedCheck';
import NameRefusal from '../NameRefusal';

interface AddFeedDialogProps {
  onClose: () => void;
}

export default function AddFeedDialog({ onClose }: AddFeedDialogProps) {
  const { t } = useTranslation();
  const { subscriptions, addFeed, labels, categoryIds, folderIds } = useFeedStore();
  const [feedUrl, setFeedUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  // Android : le retour ferme cette surface, elle seule (M-08).
  useBackLayer(true, onClose);
  const fieldId = useId();

  // Échap ferme. La boîte est `role="dialog"` : `useKeyboardNav` se tait tant
  // qu'elle est ouverte, donc rien d'autre n'écouterait la touche. Capture +
  // stopPropagation, comme les autres surfaces : un seul effet par pression.
  // Le focus revient au déclencheur à la fermeture (il retombait sur la
  // page) ; à l'ouverture, le champ URL le prend (`autoFocus`). Relevé au
  // premier rendu : dans un effet, `autoFocus` l'aurait déjà déplacé.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null));
  useEffect(() => () => {
    if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
  }, [opener]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const categories = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    subscriptions.forEach((sub) => {
      const cat = sub.categories?.[0];
      if (cat) map[cat.id] = cat.label;
    });
    return Object.entries(map).map(([id, label]) => ({ id, label }));
  }, [subscriptions]);

  // Mêmes règles que Préférences pour une nouvelle catégorie (R3T1-3) ; un
  // flux déjà abonné est reconnu sur place plutôt que par l'erreur générique.
  // « Nouvelle catégorie » sans nom grise « Ajouter », comme Préférences : le
  // flux partait en silence sans catégorie.
  const owners = useMemo(() => nameOwners({ labels, categoryIds, folderIds }), [labels, categoryIds, folderIds]);
  const choice = category === '__new__' ? newCategoryChoice(newCategory, owners) : null;
  const already = subscribedFeed(feedUrl, subscriptions);
  const canAdd = !!feedUrl.trim() && !already && (!choice || !!choice.id);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd) return;

    setLoading(true);
    setError('');

    const catId = choice?.id ?? category;
    const catLabel = choice ? choice.label : categories.find((c) => c.id === category)?.label || '';

    const ok = await addFeed(feedUrl.trim(), title.trim(), catId, catLabel);

    setLoading(false);
    if (ok) {
      onClose();
    } else {
      setError(t('addFeed.error'));
    }
  }

  // Par portail sous <body> : ouverte depuis la barre latérale, donc dans le
  // tiroir mobile (`fixed` + `transform` + `overflow: hidden`), elle s'y
  // ancrait et y était rognée.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl shadow-2xl p-6"
        style={{ background: 'var(--panel-bg)' }}
      >
        <h2 id={titleId} className="text-lg font-bold mb-4" style={{ color: 'var(--list-title)' }}>
          {t('addFeed.title')}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Feed URL */}
          <div>
            <label htmlFor={`${fieldId}-url`} className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.urlLabel')} *
            </label>
            <input
              id={`${fieldId}-url`}
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder={t('addFeed.urlPlaceholder')}
              required
              autoFocus
              aria-invalid={already ? true : undefined}
              aria-describedby={`${fieldId}-url-issue`}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none transition-colors"
              style={{
                borderColor: 'var(--panel-border)',
                color: 'var(--list-title)',
                background: 'var(--panel-bg)',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
            />
            {/* Toujours présente (région annoncée) ; vide, elle ne prend aucune place. */}
            <p
              id={`${fieldId}-url-issue`}
              aria-live="polite"
              className={`text-xs leading-snug ${already ? 'mt-1' : ''}`}
              style={{ color: 'var(--danger)' }}
            >
              {already ? t('addFeed.alreadySubscribed', { name: already.title }) : ''}
            </p>
          </div>

          {/* Title (optional) */}
          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.nameLabel')}
            </label>
            <input
              id={`${fieldId}-name`}
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
            <label htmlFor={`${fieldId}-category`} className="block text-xs font-medium mb-1" style={{ color: 'var(--list-summary)' }}>
              {t('addFeed.categoryLabel')}
            </label>
            <select
              id={`${fieldId}-category`}
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
                aria-label={t('addFeed.newCategory')}
                aria-invalid={choice?.issue ? true : undefined}
                aria-describedby={`${fieldId}-category-issue`}
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
              <NameRefusal id={`${fieldId}-category-issue`} issue={choice?.issue ?? null} name={newCategory} className="text-xs" />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-danger">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg transition-colors hover-tint"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !canAdd}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              {loading ? t('addFeed.adding') : t('addFeed.add')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
