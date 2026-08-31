import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../../stores/feedStore';
import { groupFeedsByCategory, isValidCategoryName, type CategoryGroup } from '../../lib/feedCategories';
import { useUiStore } from '../../stores/uiStore';
import type { Subscription } from '../../types';

/**
 * Gestion des catégories de flux.
 *
 * Ce qui est possible, et pourquoi : une catégorie n'est pas un objet stocké,
 * elle n'existe que **portée par ses flux**. On peut donc la renommer, la
 * supprimer, et y déplacer un flux — mais pas en créer une vide. En créer une
 * se fait en y déplaçant son premier flux, ce que le sélecteur propose sous
 * « nouvelle catégorie ». C'est la même limite du modèle Google Reader que
 * pour les catégories d'articles sauvegardés.
 *
 * Supprimer une catégorie ne supprime AUCUN flux : ils se retrouvent sans
 * catégorie, et l'interface le dit avant de demander confirmation.
 */
export default function CategoryList() {
  const { t } = useTranslation();
  const subscriptions = useFeedStore((s) => s.subscriptions);
  const pushToast = useUiStore((s) => s.pushToast);

  const { categories, uncategorised } = useMemo(
    () => groupFeedsByCategory(subscriptions),
    [subscriptions]
  );

  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allNames = useMemo(() => categories.map((c) => c.label), [categories]);

  async function run(action: () => Promise<boolean>, okKey: string) {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    pushToast(ok ? t(okKey) : t('preferences.categories.failed'), ok ? undefined : { tone: 'error' });
    return ok;
  }

  return (
    <div className="space-y-3">
      <div>
        <h3
          className="text-[11px] font-bold uppercase tracking-widest mb-1"
          style={{ color: 'var(--list-summary)' }}
        >
          {t('preferences.categories.title')}
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.categories.hint')}
        </p>
      </div>

      {categories.length === 0 && uncategorised.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--list-time)' }}>
          {t('preferences.categories.empty')}
        </p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--panel-border)' }}>
          {categories.map((group, index) => (
            <CategoryRow
              key={group.id}
              group={group}
              first={index === 0}
              names={allNames}
              busy={busy}
              expanded={expanded === group.id}
              renaming={renaming === group.id}
              confirming={confirming === group.id}
              onToggle={() => setExpanded((c) => (c === group.id ? null : group.id))}
              onStartRename={() => { setRenaming(group.id); setConfirming(null); }}
              onCancelRename={() => setRenaming(null)}
              onRename={async (name) => {
                const ok = await run(
                  () => useFeedStore.getState().renameCategory(group.id, name),
                  'preferences.categories.renamed'
                );
                if (ok) setRenaming(null);
              }}
              onAskDelete={() => { setConfirming(group.id); setRenaming(null); }}
              onCancelDelete={() => setConfirming(null)}
              onDelete={async () => {
                const ok = await run(
                  () => useFeedStore.getState().deleteCategory(group.id),
                  'preferences.categories.deleted'
                );
                if (ok) { setConfirming(null); setExpanded(null); }
              }}
              onMove={(feedId, name) =>
                run(
                  () => useFeedStore.getState().moveFeedToCategory(feedId, name),
                  'preferences.categories.moved'
                )
              }
            />
          ))}

          {uncategorised.length > 0 && (
            <CategoryRow
              key="__none__"
              group={{ id: '__none__', label: t('preferences.categories.none'), feeds: uncategorised }}
              first={categories.length === 0}
              names={allNames}
              busy={busy}
              readOnly
              expanded={expanded === '__none__'}
              renaming={false}
              confirming={false}
              onToggle={() => setExpanded((c) => (c === '__none__' ? null : '__none__'))}
              onMove={(feedId, name) =>
                run(
                  () => useFeedStore.getState().moveFeedToCategory(feedId, name),
                  'preferences.categories.moved'
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

interface CategoryRowProps {
  group: CategoryGroup;
  first: boolean;
  names: string[];
  busy: boolean;
  /** La pseudo-catégorie « sans catégorie » : ni renommable ni supprimable. */
  readOnly?: boolean;
  expanded: boolean;
  renaming: boolean;
  confirming: boolean;
  onToggle: () => void;
  onStartRename?: () => void;
  onCancelRename?: () => void;
  onRename?: (name: string) => void;
  onAskDelete?: () => void;
  onCancelDelete?: () => void;
  onDelete?: () => void;
  onMove: (feedId: string, categoryName: string) => void;
}

function CategoryRow({
  group, first, names, busy, readOnly, expanded, renaming, confirming,
  onToggle, onStartRename, onCancelRename, onRename, onAskDelete, onCancelDelete, onDelete, onMove,
}: CategoryRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(group.label);

  return (
    <div style={{ borderTop: first ? undefined : '1px solid var(--panel-border)' }}>
      {/* `group` est indispensable : sans lui, les actions ci-dessous portent
          `group-hover:opacity-100` sans jamais avoir de parent à survoler et
          restent invisibles pour toujours. Au doigt, `prefs-row-action` les
          affiche déjà via `@media (hover: none)`. */}
      <div className="group prefs-tap-row flex items-center gap-2 px-3 py-2" style={{ background: 'var(--panel-header-bg)' }}>
        <button
          onClick={onToggle}
          className="prefs-tap-btn flex items-center gap-2 min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <svg
            className={`w-3 h-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--list-time)' }}
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
          <span className="text-[13px] font-medium truncate" style={{ color: 'var(--list-title)' }}>
            {group.label}
          </span>
          <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: 'var(--list-time)' }}>
            {group.feeds.length}
          </span>
        </button>

        {!readOnly && !renaming && !confirming && (
          <>
            <button
              onClick={onStartRename}
              disabled={busy}
              className="prefs-row-action prefs-tap-btn p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              style={{ color: 'var(--list-summary)' }}
              title={t('preferences.categories.rename')}
              aria-label={`${t('preferences.categories.rename')} : ${group.label}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            <button
              onClick={onAskDelete}
              disabled={busy}
              className="prefs-row-action prefs-tap-btn p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              style={{ color: 'var(--danger)' }}
              title={t('preferences.categories.delete')}
              aria-label={`${t('preferences.categories.delete')} : ${group.label}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          </>
        )}
      </div>

      {renaming && (
        <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'var(--panel-bg)' }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValidCategoryName(draft)) onRename?.(draft);
              if (e.key === 'Escape') onCancelRename?.();
            }}
            aria-label={t('preferences.categories.rename')}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-md"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
          />
          <button
            onClick={() => onRename?.(draft)}
            disabled={busy || !isValidCategoryName(draft) || draft.trim() === group.label}
            className="prefs-tap-btn px-2.5 py-1.5 text-xs font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {t('preferences.categories.save')}
          </button>
          <button
            onClick={onCancelRename}
            className="prefs-tap-btn px-2.5 py-1.5 text-xs rounded-md"
            style={{ color: 'var(--list-summary)' }}
          >
            {t('preferences.categories.cancel')}
          </button>
        </div>
      )}

      {confirming && (
        <div className="px-3 py-2.5 space-y-2" style={{ background: 'var(--danger-light)' }}>
          {/* Dire ce qui arrive aux flux : c'est la question que pose toute
              suppression de catégorie, et y répondre après coup est trop tard. */}
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {t('preferences.categories.deleteWarning', { count: group.feeds.length })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              disabled={busy}
              className="prefs-tap-btn px-2.5 py-1.5 text-xs font-medium rounded-md disabled:opacity-40"
              style={{ background: 'var(--danger)', color: 'var(--on-danger)' }}
            >
              {t('preferences.categories.confirmDelete')}
            </button>
            <button
              onClick={onCancelDelete}
              className="prefs-tap-btn px-2.5 py-1.5 text-xs rounded-md"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('preferences.categories.cancel')}
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ background: 'var(--panel-bg)' }}>
          {group.feeds.map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              current={readOnly ? '' : group.label}
              names={names}
              busy={busy}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const NEW_CATEGORY = '__new__';

function FeedRow({
  feed, current, names, busy, onMove,
}: { feed: Subscription; current: string; names: string[]; busy: boolean; onMove: (id: string, name: string) => void }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div className="prefs-tap-row flex items-center gap-2 px-3 py-1.5 pl-8" style={{ borderTop: '1px solid var(--panel-border)' }}>
      <span className="flex-1 min-w-0 text-[13px] truncate" style={{ color: 'var(--list-title)' }}>
        {feed.title}
      </span>

      {creating ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isValidCategoryName(draft)) { onMove(feed.id, draft); setCreating(false); }
              if (e.key === 'Escape') setCreating(false);
            }}
            placeholder={t('preferences.categories.newName')}
            aria-label={t('preferences.categories.newName')}
            className="w-40 px-2 py-1 text-xs rounded-md"
            style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
          />
          <button
            onClick={() => { if (isValidCategoryName(draft)) { onMove(feed.id, draft); setCreating(false); } }}
            disabled={busy || !isValidCategoryName(draft)}
            className="prefs-tap-btn px-2 py-1 text-xs font-medium rounded-md disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {t('preferences.categories.move')}
          </button>
        </>
      ) : (
        <select
          value={current}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === NEW_CATEGORY) { setCreating(true); return; }
            if (e.target.value !== current) onMove(feed.id, e.target.value);
          }}
          aria-label={`${t('preferences.categories.moveTo')} : ${feed.title}`}
          className="px-2 py-1 text-xs rounded-md flex-shrink-0 max-w-[45%]"
          style={{ border: '1px solid var(--panel-border)', color: 'var(--list-title)', background: 'var(--panel-header-bg)' }}
        >
          {/* Un flux sans catégorie n'a pas de valeur courante à sélectionner ;
              l'entrée vide sert d'invite et ne peut pas être rechoisie — le
              modèle n'offre pas de « retirer d'une catégorie ». */}
          {!current && <option value="">{t('preferences.categories.moveTo')}</option>}
          {names.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          <option value={NEW_CATEGORY}>{t('preferences.categories.newCategory')}</option>
        </select>
      )}
    </div>
  );
}
