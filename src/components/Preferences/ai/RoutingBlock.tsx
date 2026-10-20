import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, normalizeAiProviderId } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useFeedStore } from '../../../stores/feedStore';
import { groupFeedsByCategory } from '../../../lib/feedCategories';
import type { AiProviderView } from '../../../api/backend';
import type { Subscription } from '../../../types';
import { BlockTitle, ProviderOptions } from './shared';
import { inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];
/** Clé de dépli du groupe « Sans catégorie » : un identifiant de catégorie commence par `user/-/label/`. */
const UNCATEGORISED = '__uncategorised';

/** Un sélecteur de fournisseur : au moins 8 rem, quitte à faire passer le nom à la ligne. */
const selectClass = 'prefs-tap-row min-w-[8rem] max-w-[50%] flex-shrink-0 px-2 py-1.5 text-sm rounded-md min-h-[36px]';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="flex-shrink-0 transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined }}
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

/**
 * Bloc « Par flux et catégorie » : l'aperçu de tous les choix de fournisseur.
 * Une ligne par catégorie (repliée d'origine) avec son sélecteur ; dépliée,
 * elle liste ses flux, chacun avec le sien. Les flux sans catégorie forment un
 * dernier groupe, sans sélecteur de groupe. Un flux l'emporte sur sa catégorie,
 * qui l'emporte sur le fournisseur préféré.
 *
 * Les catégories sont réglées par **nom** : en renommer une perd son réglage.
 */
export default function RoutingBlock() {
  const { t } = useTranslation();
  const uid = useId();
  const providers = useAiStore((s) => s.config?.providers) ?? NO_PROVIDERS;
  const subscriptions = useFeedStore((s) => s.subscriptions);
  const categoryProviders = useUiStore((s) => s.aiCategoryProviders);
  const setCategoryProvider = useUiStore((s) => s.setAiCategoryProvider);
  const feedSettings = useUiStore((s) => s.feedSettings);
  const setFeedProvider = useUiStore((s) => s.setFeedAiProvider);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { categories, uncategorised } = useMemo(() => groupFeedsByCategory(subscriptions), [subscriptions]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Les réglages synchronisés ne sont pas normalisés : une valeur corrompue vaut « par défaut ».
  const feedValue = (feedId: string) => normalizeAiProviderId(feedSettings[feedId]?.aiProvider);
  const categoryValue = (name: string) =>
    Object.hasOwn(categoryProviders, name) ? normalizeAiProviderId(categoryProviders[name]) : null;
  const tuned = (feeds: Subscription[]) => feeds.filter((f) => feedValue(f.id) !== null).length;

  const groups: { key: string; label: string; feeds: Subscription[]; category: boolean }[] = [
    ...categories.map((c) => ({ key: c.id, label: c.label, feeds: c.feeds, category: true })),
    ...(uncategorised.length ? [{ key: UNCATEGORISED, label: t('ai.routing.uncategorised'), feeds: uncategorised, category: false }] : []),
  ];

  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.routing.title')}</BlockTitle>
      <p className="text-sm max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.routing.hint')}</p>
      <div className="space-y-1">
        {groups.map((group, i) => {
          const expanded = open.has(group.key);
          const panelId = `${uid}-group-${i}`;
          const count = tuned(group.feeds);
          const value = group.category ? categoryValue(group.label) : null;
          return (
            <div key={group.key}>
              <div className="flex items-center gap-2">
                <button
                  type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(group.key)}
                  className="prefs-tap-row flex flex-1 min-w-0 items-center gap-2 text-left text-sm cursor-pointer"
                  style={{ color: 'var(--list-title)' }}
                >
                  <Chevron open={expanded} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold">{group.label}</span>
                    {count > 0 && (
                      <span className="block text-[11px] font-normal" style={{ color: 'var(--list-summary)' }}>
                        {t('ai.routing.overrides', { count })}
                      </span>
                    )}
                  </span>
                </button>
                {group.category && (
                  <select
                    aria-label={t('ai.routing.categorySelect', { name: group.label })}
                    value={value === null ? '' : String(value)} className={selectClass} style={inputStyle}
                    onChange={(e) => setCategoryProvider(group.label, e.target.value ? Number(e.target.value) : null)}
                  >
                    <ProviderOptions providers={providers} value={value} defaultLabel={t('ai.routing.default')} />
                  </select>
                )}
              </div>
              <ul id={panelId} hidden={!expanded} className="ml-5 pl-3 space-y-1 border-l" style={{ borderColor: 'var(--panel-border)' }}>
                {expanded && group.feeds.map((feed) => {
                  const feedProvider = feedValue(feed.id);
                  const name = feed.title || feed.id;
                  return (
                    <li key={feed.id} className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 py-2 text-sm [overflow-wrap:anywhere]" style={{ color: 'var(--list-title)' }}>{name}</span>
                      <select
                        aria-label={t('ai.routing.feedSelect', { name })}
                        value={feedProvider === null ? '' : String(feedProvider)} className={selectClass} style={inputStyle}
                        onChange={(e) => setFeedProvider(feed.id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <ProviderOptions providers={providers} value={feedProvider} defaultLabel={t('ai.routing.default')} />
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
