import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, normalizeAiProviderId } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useFeedStore } from '../../../stores/feedStore';
import { groupFeedsByCategory } from '../../../lib/feedCategories';
import { autoFor, panelFor, type AiAutoPrefs } from '../../../lib/aiAuto';
import type { AiProviderView } from '../../../api/backend';
import type { Subscription } from '../../../types';
import ConfirmDialog from '../../ConfirmDialog';
import { AutoSummaryConfirm, BlockTitle, Pill, ProviderOptions } from './shared';
import { inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];
/** Clé de dépli du groupe « Sans catégorie » : un identifiant de catégorie commence par `user/-/label/`. */
const UNCATEGORISED = '__uncategorised';

type AutoKind = 'summary' | 'translate';

/** Le sélecteur d'une catégorie ou d'un flux : compact, il ne grandit pas avec le nom (7 à 11 rem). */
const selectClass = 'prefs-tap-row min-w-[7rem] max-w-[11rem] px-2 py-1.5 text-sm rounded-md min-h-[36px]';
/**
 * Une ligne (catégorie ou flux) : le nom, éventuellement un sélecteur, les
 * pastilles. `flex-wrap`, pour que rien ne déborde à 320 px ni dans une fenêtre
 * de préférences étroite : le nom prend alors toute sa ligne (`basis-full`),
 * le reste passe dessous.
 */
const rowClass = 'flex flex-wrap items-center gap-x-2 gap-y-1';
/**
 * Le nom : toute la ligne à l'étroit, la place libre au large (`sm:flex-1` avec
 * un plancher, pour qu'un nom court ne force pas les pastilles à passer sous
 * lui). `min-w-0` + `truncate` : une ligne, jamais d'élargissement du bloc.
 */
const nameClass = 'basis-full sm:basis-0 sm:flex-1 sm:min-w-[6rem] min-w-0';
/** Les pastilles, rangées à droite ; elles passent à la ligne entre elles plutôt que de déborder. */
const pillsClass = 'flex flex-wrap justify-end gap-1.5 ml-auto flex-shrink-0 max-w-full';

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
 * Bloc « Par flux et catégorie » : l'aperçu de tous les choix de fournisseur
 * et des trois automatismes. Un accordéon : une ligne par catégorie (repliée
 * d'origine), avec ses trois pastilles « Résumer », « Traduire » et « Panneau IA » ;
 * dépliée, elle montre d'abord le fournisseur de la catégorie, puis ses flux,
 * chacun avec son fournisseur et ses pastilles. Les flux sans catégorie
 * forment un dernier groupe, sans sélecteur ni pastilles de groupe. Un flux
 * l'emporte sur sa catégorie, qui l'emporte sur le réglage global.
 *
 * « Résumer » et « Traduire » lancent l'action à l'ouverture de chaque article
 * de la ligne ; « Panneau IA » garde le panneau Résumé IA visible même sans
 * résumé. Un flux affiche sa valeur effective (`autoFor` / `panelFor` : la
 * sienne, sinon celle de ses catégories, sinon le réglage global — la
 * traduction n'en a pas) et le toucher écrit toujours une valeur propre, pour
 * qu'éteindre un flux sous une catégorie allumée tienne. Allumer « Traduire »
 * ou « Résumer » demande une fois par compte la confirmation de coût ;
 * « Panneau IA » ne coûte rien et n'en a pas.
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
  const categoryPanel = useUiStore((s) => s.aiCategoryPanel);
  const setCategoryPanel = useUiStore((s) => s.setAiCategoryPanel);
  const setFeedPanel = useUiStore((s) => s.setFeedAiPanel);
  const panelAlways = useUiStore((s) => s.aiPanelAlways);
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
  // Une catégorie sans valeur propre montre le réglage global, comme le fait un flux sans catégorie réglée.
  const categoryPanelOn = (name: string) => (Object.hasOwn(categoryPanel, name) ? categoryPanel[name] === true : panelAlways);
  // « N flux réglés » : un fournisseur ou une valeur propre de résumé / traduction / panneau.
  const tuned = (feeds: Subscription[]) => feeds.filter((f) => {
    const own = feedSettings[f.id];
    return feedValue(f.id) !== null || typeof own?.aiAutoSummary === 'boolean' || typeof own?.aiAutoTranslate === 'boolean'
      || typeof own?.aiPanel === 'boolean';
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
  const legendId = `${uid}-legend`;

  /** Les trois pastilles d'une ligne ; seules les valeurs et les écritures changent entre catégorie et flux. */
  const pills = (name: string, v: {
    summary: boolean; translate: boolean; panel: boolean;
    setSummary: (v: boolean) => void; setTranslate: (v: boolean) => void; setPanel: (v: boolean) => void;
  }) => (
    <div className={pillsClass}>
      <Pill
        word={t('ai.routing.autoSummary')} title={t('ai.routing.summaryTitle')} checked={v.summary} describedBy={legendId}
        ariaLabel={t('ai.routing.autoSummaryFor', { name })} onChange={(on) => switchAuto('summary', on, v.setSummary)}
      />
      <Pill
        word={t('ai.routing.autoTranslate')} title={t('ai.routing.translateTitle')} checked={v.translate} describedBy={legendId}
        ariaLabel={t('ai.routing.autoTranslateFor', { name })} onChange={(on) => switchAuto('translate', on, v.setTranslate)}
      />
      <Pill
        word={t('ai.routing.panel')} title={t('ai.routing.panelTitle')} checked={v.panel} describedBy={legendId}
        ariaLabel={t('ai.routing.panelFor', { name })} onChange={v.setPanel}
      />
    </div>
  );

  const groups: { key: string; label: string; feeds: Subscription[]; category: boolean }[] = [
    ...categories.map((c) => ({ key: c.id, label: c.label, feeds: c.feeds, category: true })),
    ...(uncategorised.length ? [{ key: UNCATEGORISED, label: t('ai.routing.uncategorised'), feeds: uncategorised, category: false }] : []),
  ];

  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.routing.title')}</BlockTitle>
      <div className="space-y-1 text-sm max-w-prose" style={{ color: 'var(--list-summary)' }}>
        <p>{t('ai.routing.hint')}</p>
        <p id={legendId}>{t('ai.routing.legend')}</p>
      </div>
      <ul className="divide-y divide-[color:var(--panel-border)]">
        {groups.map((group, index) => {
          const expanded = open.has(group.key);
          const count = tuned(group.feeds);
          const value = group.category ? categoryValue(group.label) : null;
          const bodyId = `${uid}-group-${index}`;
          return (
            <li key={group.key} className="py-1">
              <div className={rowClass}>
                <button
                  type="button" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={() => toggle(group.key)}
                  className={`prefs-tap-row ${nameClass} flex items-center gap-2 text-left text-sm cursor-pointer`}
                  style={{ color: 'var(--list-title)' }}
                >
                  <Chevron open={expanded} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold" title={group.label}>{group.label}</span>
                    {count > 0 && (
                      <span className="block truncate text-[11px] font-normal" style={{ color: 'var(--list-summary)' }}>
                        {t('ai.routing.overrides', { count })}
                      </span>
                    )}
                  </span>
                </button>
                {/* « Sans catégorie » n'est pas une catégorie : rien à y régler, ses flux ont chacun les leurs. */}
                {group.category && pills(group.label, {
                  summary: categoryAuto('summary', group.label), translate: categoryAuto('translate', group.label),
                  panel: categoryPanelOn(group.label),
                  setSummary: (v) => setCategoryAutoSummary(group.label, v),
                  setTranslate: (v) => setCategoryAutoTranslate(group.label, v),
                  setPanel: (v) => setCategoryPanel(group.label, v),
                })}
              </div>
              {expanded && (
                <div id={bodyId} className="mt-1">
                  {group.category && (
                    <div className={`${rowClass} pl-6 pb-1`}>
                      <span className="flex-1 min-w-[8rem] truncate text-sm" style={{ color: 'var(--list-summary)' }}>
                        {t('ai.routing.categoryProvider')}
                      </span>
                      <select
                        aria-label={t('ai.routing.categorySelect', { name: group.label })}
                        value={value === null ? '' : String(value)} className={`${selectClass} ml-auto`} style={inputStyle}
                        onChange={(e) => setCategoryProvider(group.label, e.target.value ? Number(e.target.value) : null)}
                      >
                        <ProviderOptions providers={providers} value={value} defaultLabel={t('ai.routing.default')} />
                      </select>
                    </div>
                  )}
                  <ul>
                    {group.feeds.map((feed) => {
                      const feedProvider = feedValue(feed.id);
                      const name = feed.title || feed.id;
                      const panelPrefs = { ...autoPrefs, aiCategoryPanel: categoryPanel, aiPanelAlways: panelAlways };
                      return (
                        <li key={feed.id} className="pl-6 py-1">
                          <div className={rowClass}>
                            <span className={`${nameClass} truncate text-sm`} style={{ color: 'var(--list-title)' }} title={name}>{name}</span>
                            <select
                              aria-label={t('ai.routing.feedSelect', { name })}
                              value={feedProvider === null ? '' : String(feedProvider)} className={`${selectClass} flex-1`} style={inputStyle}
                              onChange={(e) => setFeedProvider(feed.id, e.target.value ? Number(e.target.value) : null)}
                            >
                              <ProviderOptions providers={providers} value={feedProvider} defaultLabel={t('ai.routing.default')} />
                            </select>
                            {pills(name, {
                              summary: autoFor('summary', feed.id, subscriptions, autoPrefs),
                              translate: autoFor('translate', feed.id, subscriptions, autoPrefs),
                              panel: panelFor(feed.id, subscriptions, panelPrefs),
                              setSummary: (v) => setFeedAutoSummary(feed.id, v),
                              setTranslate: (v) => setFeedAutoTranslate(feed.id, v),
                              setPanel: (v) => setFeedPanel(feed.id, v),
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
