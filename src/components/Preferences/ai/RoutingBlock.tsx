import { Fragment, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, normalizeAiProviderId } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useFeedStore } from '../../../stores/feedStore';
import { groupFeedsByCategory } from '../../../lib/feedCategories';
import { autoFor, type AiAutoPrefs } from '../../../lib/aiAuto';
import type { AiProviderView } from '../../../api/backend';
import type { Subscription } from '../../../types';
import ToggleSwitch from '../../ToggleSwitch';
import ConfirmDialog from '../../ConfirmDialog';
import { AutoSummaryConfirm, BlockTitle, ProviderOptions } from './shared';
import { inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];
/** Clé de dépli du groupe « Sans catégorie » : un identifiant de catégorie commence par `user/-/label/`. */
const UNCATEGORISED = '__uncategorised';

type AutoKind = 'summary' | 'translate';

/** Le sélecteur de fournisseur : il remplit sa colonne de la grille (7 à 12 rem). */
const selectClass = 'prefs-tap-row w-full min-w-0 px-2 py-1.5 text-sm rounded-md min-h-[36px]';
/**
 * Colonnes de la grille unique du bloc : nom, fournisseur, résumé, traduction.
 * Étroit (< 640 px), la cellule du nom prend toute la ligne (`col-span-3`) et
 * les trois contrôles passent dessous, sous les en-têtes.
 */
const gridClass = 'grid items-center gap-x-3 gap-y-1 grid-cols-[minmax(7rem,1fr)_max-content_max-content] '
  + 'sm:grid-cols-[minmax(0,1fr)_minmax(7rem,12rem)_max-content_max-content]';
const nameCell = 'col-span-3 sm:col-span-1 min-w-0';
const headerClass = 'text-[11px] leading-tight';

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
 * Un interrupteur de la grille, centré sous son en-tête. Le mot « Résumer » /
 * « Traduire » est celui de la colonne ; le nom accessible dit en plus la ligne.
 */
function AutoSwitch({ kind, name, checked, hintId, onChange }: {
  kind: AutoKind; name: string; checked: boolean; hintId: string; onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="prefs-tap-btn inline-flex items-center justify-center justify-self-center">
      <ToggleSwitch
        checked={checked} onChange={onChange} describedBy={hintId}
        ariaLabel={t(kind === 'summary' ? 'ai.routing.autoSummaryFor' : 'ai.routing.autoTranslateFor', { name })}
      />
    </span>
  );
}

/**
 * Bloc « Par flux et catégorie » : l'aperçu de tous les choix de fournisseur.
 * Une ligne par catégorie (repliée d'origine) avec son sélecteur ; dépliée,
 * elle liste ses flux, chacun avec le sien. Les flux sans catégorie forment un
 * dernier groupe, sans sélecteur de groupe. Un flux l'emporte sur sa catégorie,
 * qui l'emporte sur le fournisseur préféré.
 *
 * Tout le bloc est une seule grille (en-têtes, catégories, flux dépliés) : les
 * colonnes « Fournisseur », « Résumer » et « Traduire » s'alignent d'une ligne à
 * l'autre. Chaque ligne de catégorie ou de flux porte « Résumer » et « Traduire »
 * à l'ouverture. Un flux affiche sa valeur effective (`autoFor` : la sienne,
 * sinon celle de ses catégories, sinon — résumé seulement — le réglage
 * global) et le toucher écrit toujours une valeur propre, pour qu'éteindre un
 * flux sous une catégorie allumée tienne. Allumer demande une fois par compte
 * la confirmation de coût : celle de la traduction, ou celle du résumé
 * automatique global, sauf si ce dernier est déjà allumé.
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
  const categoryAutoSummary = useUiStore((s) => s.aiCategoryAutoSummary);
  const categoryAutoTranslate = useUiStore((s) => s.aiCategoryAutoTranslate);
  const setCategoryAutoSummary = useUiStore((s) => s.setAiCategoryAutoSummary);
  const setCategoryAutoTranslate = useUiStore((s) => s.setAiCategoryAutoTranslate);
  const setFeedAutoSummary = useUiStore((s) => s.setFeedAiAutoSummary);
  const setFeedAutoTranslate = useUiStore((s) => s.setFeedAiAutoTranslate);
  const autoSummary = useUiStore((s) => s.aiAutoSummary);
  const summaryConfirmed = useUiStore((s) => s.aiAutoSummaryConfirmed);
  const setSummaryConfirmed = useUiStore((s) => s.setAiAutoSummaryConfirmed);
  const translateConfirmed = useUiStore((s) => s.aiAutoTranslateConfirmed);
  const setTranslateConfirmed = useUiStore((s) => s.setAiAutoTranslateConfirmed);
  // Un allumage en attente de la confirmation de coût.
  const [pending, setPending] = useState<{ kind: AutoKind; apply: () => void } | null>(null);
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
  const autoPrefs: AiAutoPrefs = {
    feedSettings, aiCategoryAutoSummary: categoryAutoSummary, aiCategoryAutoTranslate: categoryAutoTranslate, aiAutoSummary: autoSummary,
  };
  const categoryAuto = (kind: AutoKind, name: string) => {
    const flags = kind === 'summary' ? categoryAutoSummary : categoryAutoTranslate;
    return Object.hasOwn(flags, name) && flags[name] === true;
  };
  // « N flux réglés » : un fournisseur ou une valeur propre de résumé / traduction.
  const tuned = (feeds: Subscription[]) => feeds.filter((f) => {
    const own = feedSettings[f.id];
    return feedValue(f.id) !== null || typeof own?.aiAutoSummary === 'boolean' || typeof own?.aiAutoTranslate === 'boolean';
  }).length;
  /** Éteindre s'applique tout de suite ; allumer passe d'abord, une fois par compte, par l'avertissement de coût. */
  const switchAuto = (kind: AutoKind, on: boolean, apply: (on: boolean) => void) => {
    const ask = on && (kind === 'translate' ? !translateConfirmed : !autoSummary && !summaryConfirmed);
    if (ask) setPending({ kind, apply: () => apply(true) });
    else apply(on);
  };
  const confirmPending = () => {
    if (!pending) return;
    pending.apply();
    if (pending.kind === 'translate') setTranslateConfirmed(true);
    else setSummaryConfirmed(true);
    setPending(null);
  };
  const autoHintId = `${uid}-auto-hint`;

  const groups: { key: string; label: string; feeds: Subscription[]; category: boolean }[] = [
    ...categories.map((c) => ({ key: c.id, label: c.label, feeds: c.feeds, category: true })),
    ...(uncategorised.length ? [{ key: UNCATEGORISED, label: t('ai.routing.uncategorised'), feeds: uncategorised, category: false }] : []),
  ];

  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.routing.title')}</BlockTitle>
      <div className="space-y-1 text-sm max-w-prose" style={{ color: 'var(--list-summary)' }}>
        <p>{t('ai.routing.hint')}</p>
        <p id={autoHintId}>{t('ai.routing.autoHint')}</p>
      </div>
      <div data-routing-grid="" className={gridClass}>
        <span aria-hidden="true" className="hidden sm:block" />
        <span className={`${headerClass} sm:col-start-2`} style={{ color: 'var(--list-summary)' }}>{t('ai.translation.provider')}</span>
        <span className={`${headerClass} justify-self-center`} style={{ color: 'var(--list-summary)' }}>{t('ai.routing.autoSummary')}</span>
        <span className={`${headerClass} justify-self-center`} style={{ color: 'var(--list-summary)' }}>{t('ai.routing.autoTranslate')}</span>
        {groups.map((group) => {
          const expanded = open.has(group.key);
          const count = tuned(group.feeds);
          const value = group.category ? categoryValue(group.label) : null;
          return (
            <Fragment key={group.key}>
              <button
                type="button" aria-expanded={expanded} onClick={() => toggle(group.key)}
                className={`prefs-tap-row ${nameCell} flex items-center gap-2 text-left text-sm cursor-pointer`}
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
              {group.category ? (
                <>
                  <select
                    aria-label={t('ai.routing.categorySelect', { name: group.label })}
                    value={value === null ? '' : String(value)} className={selectClass} style={inputStyle}
                    onChange={(e) => setCategoryProvider(group.label, e.target.value ? Number(e.target.value) : null)}
                  >
                    <ProviderOptions providers={providers} value={value} defaultLabel={t('ai.routing.default')} />
                  </select>
                  {(['summary', 'translate'] as const).map((kind) => (
                    <AutoSwitch
                      key={kind} kind={kind} name={group.label} hintId={autoHintId} checked={categoryAuto(kind, group.label)}
                      onChange={(on) => switchAuto(kind, on, (v) =>
                        (kind === 'summary' ? setCategoryAutoSummary : setCategoryAutoTranslate)(group.label, v))}
                    />
                  ))}
                </>
              ) : (
                // Le groupe « Sans catégorie » n'a pas de réglage propre : des cellules vides tiennent la grille.
                <>
                  <span aria-hidden="true" className="hidden sm:block" />
                  <span aria-hidden="true" className="hidden sm:block" />
                  <span aria-hidden="true" className="hidden sm:block" />
                </>
              )}
              {expanded && group.feeds.map((feed) => {
                const feedProvider = feedValue(feed.id);
                const name = feed.title || feed.id;
                return (
                  <Fragment key={feed.id}>
                    <span className={`${nameCell} py-2 pl-6 text-sm [overflow-wrap:anywhere]`} style={{ color: 'var(--list-title)' }}>{name}</span>
                    <select
                      aria-label={t('ai.routing.feedSelect', { name })}
                      value={feedProvider === null ? '' : String(feedProvider)} className={selectClass} style={inputStyle}
                      onChange={(e) => setFeedProvider(feed.id, e.target.value ? Number(e.target.value) : null)}
                    >
                      <ProviderOptions providers={providers} value={feedProvider} defaultLabel={t('ai.routing.default')} />
                    </select>
                    {(['summary', 'translate'] as const).map((kind) => (
                      <AutoSwitch
                        key={kind} kind={kind} name={name} hintId={autoHintId} checked={autoFor(kind, feed.id, subscriptions, autoPrefs)}
                        onChange={(on) => switchAuto(kind, on, (v) =>
                          (kind === 'summary' ? setFeedAutoSummary : setFeedAutoTranslate)(feed.id, v))}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <AutoSummaryConfirm open={pending?.kind === 'summary'} onConfirm={confirmPending} onCancel={() => setPending(null)} />
      <ConfirmDialog
        open={pending?.kind === 'translate'}
        title={t('ai.routing.translateConfirmTitle')}
        message={t('ai.routing.translateConfirmMessage')}
        confirmLabel={t('ai.user.autoConfirm')}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
