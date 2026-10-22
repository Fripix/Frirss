import { useId, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, normalizeAiProviderId } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useFeedStore } from '../../../stores/feedStore';
import { useBreakpoint } from '../../../hooks/useBreakpoint';
import { groupFeedsByCategory } from '../../../lib/feedCategories';
import { autoFor, panelFor, type AiAutoPrefs } from '../../../lib/aiAuto';
import type { AiProviderView } from '../../../api/backend';
import type { Subscription } from '../../../types';
import ConfirmDialog from '../../ConfirmDialog';
import FeedFavicon from '../../FeedFavicon';
import { AutoSummaryConfirm, BlockTitle } from './shared';
import { ProviderPicker, RoutingToggle, type ToggleKind, type ToggleState } from './RoutingControls';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];
/** Clé de dépli du groupe « Sans catégorie » : un identifiant de catégorie commence par `user/-/label/`. */
const UNCATEGORISED = '__uncategorised';

type AutoKind = 'summary' | 'translate';

/**
 * Une ligne de la grille : elle reprend les colonnes du bloc (`subgrid`), si
 * bien que les interrupteurs d'une catégorie et ceux de ses flux tombent
 * exactement les uns sous les autres, quelle que soit la longueur des noms.
 * Les marges latérales sont les mêmes partout, en-tête compris (qui porte un
 * filet transparent pour compter comme le cadre d'un groupe).
 */
const rowClass = 'col-span-full grid grid-cols-subgrid items-center pl-2 pr-1.5';

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
 * et des trois automatismes, en **matrice** — une ligne par catégorie, une
 * ligne par flux, jamais deux. Une seule grille pour tout le bloc :
 * `minmax(0,1fr)` pour le nom, puis trois colonnes d'interrupteurs (au moins
 * `--cell`, plus si le mot de l'en-tête est plus large) et le fournisseur.
 * Les mots des colonnes (« Résumer », « Traduire », « Panneau »,
 * « Fournisseur ») ne sont écrits qu'une fois, en tête : la ligne ne porte
 * que des icônes, et se lit d'un coup d'œil.
 *
 * Chaque catégorie forme un groupe cerclé : sa **bande** (fond d'en-tête de
 * panneau, nom en gras, « N flux » et « , N réglés » en accent) puis, une fois
 * dépliée, ses flux, indentés, favicon et nom. Les flux sans catégorie forment
 * un dernier groupe, sans réglage de groupe. Un flux l'emporte sur sa
 * catégorie, qui l'emporte sur le réglage global.
 *
 * « Résumer » et « Traduire » lancent l'action à l'ouverture de chaque article
 * de la ligne ; « Panneau » garde le panneau Résumé IA visible même sans
 * résumé. Un flux affiche sa valeur effective (`autoFor` / `panelFor`) et dit
 * d'où elle vient : **plein**, réglé ici ; **contour**, hérité de la catégorie
 * ou du réglage global. Le toucher écrit toujours une valeur propre, pour
 * qu'éteindre un flux sous une catégorie allumée tienne. Allumer « Traduire »
 * ou « Résumer » demande une fois par compte la confirmation de coût ;
 * « Panneau » ne coûte rien et n'en a pas.
 *
 * Les catégories sont réglées par **nom** : en renommer une perd son réglage.
 */
export default function RoutingBlock() {
  const { t } = useTranslation();
  const uid = useId();
  // Même partage que les menus du volet de lecture : souris au format bureau, doigt ailleurs.
  const touch = useBreakpoint() !== 'desktop';
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
  const panelPrefs = { ...autoPrefs, aiCategoryPanel: categoryPanel, aiPanelAlways: panelAlways };
  const categoryAuto = (kind: AutoKind, name: string) => {
    const flags = kind === 'summary' ? categoryAutoSummary : categoryAutoTranslate;
    return Object.hasOwn(flags, name) && flags[name] === true;
  };
  // Une catégorie sans valeur propre montre le réglage global, comme le fait un flux sans catégorie réglée.
  const categoryPanelOn = (name: string) => (Object.hasOwn(categoryPanel, name) ? categoryPanel[name] === true : panelAlways);
  // « N réglés » : un fournisseur ou une valeur propre de résumé / traduction / panneau.
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

  const columns: { kind: ToggleKind; word: string; title: string; aria: string }[] = [
    { kind: 'summary', word: t('ai.routing.autoSummary'), title: t('ai.routing.summaryTitle'), aria: 'ai.routing.autoSummaryFor' },
    { kind: 'translate', word: t('ai.routing.autoTranslate'), title: t('ai.routing.translateTitle'), aria: 'ai.routing.autoTranslateFor' },
    { kind: 'panel', word: t('ai.routing.panel'), title: t('ai.routing.panelTitle'), aria: 'ai.routing.panelFor' },
  ];
  const stateWord: Record<ToggleState | 'global', string> = {
    on: t('ai.routing.stateOn'), off: t('ai.routing.stateOff'),
    inherited: t('ai.routing.stateInherited'), global: t('ai.routing.stateGlobal'),
  };

  /**
   * Les trois interrupteurs d'une ligne. `value` donne l'état affiché et, pour
   * un état hérité, d'où il vient (pour le `title`) ; `write` est l'écriture
   * propre à la ligne. Résumer et Traduire passent par la confirmation de
   * coût, Panneau non.
   */
  const toggles = (name: string, value: (k: ToggleKind) => { state: ToggleState; global?: boolean }, write: Record<ToggleKind, (on: boolean) => void>) =>
    columns.map((c) => {
      const v = value(c.kind);
      const word = v.state === 'inherited' && v.global ? stateWord.global : stateWord[v.state];
      return (
        <RoutingToggle
          key={c.kind} kind={c.kind} state={v.state} touch={touch} describedBy={legendId}
          ariaLabel={t(c.aria, { name })} title={t('ai.routing.labelValue', { label: c.word, value: word })}
          onToggle={(on) => (c.kind === 'panel' ? write.panel(on) : switchAuto(c.kind, on, write[c.kind]))}
        />
      );
    });

  /** L'état d'un flux : sa valeur propre (pleine), sinon l'effective (contour si allumée), et sa source. */
  const feedState = (feed: Subscription) => (kind: ToggleKind): { state: ToggleState; global?: boolean } => {
    const own = feedSettings[feed.id];
    const ownValue = kind === 'summary' ? own?.aiAutoSummary : kind === 'translate' ? own?.aiAutoTranslate : own?.aiPanel;
    if (typeof ownValue === 'boolean') return { state: ownValue ? 'on' : 'off' };
    const on = kind === 'panel' ? panelFor(feed.id, subscriptions, panelPrefs) : autoFor(kind, feed.id, subscriptions, autoPrefs);
    if (!on) return { state: 'off' };
    // Hérité du global si, global éteint, rien ne l'allumerait : aucune catégorie ne le porte.
    const fromCategory = kind === 'panel'
      ? panelFor(feed.id, subscriptions, { ...panelPrefs, aiPanelAlways: false })
      : autoFor(kind, feed.id, subscriptions, { ...autoPrefs, aiAutoSummary: false });
    return { state: 'inherited', global: !fromCategory };
  };

  const groups: { key: string; label: string; feeds: Subscription[]; category: boolean }[] = [
    ...categories.map((c) => ({ key: c.id, label: c.label, feeds: c.feeds, category: true })),
    ...(uncategorised.length ? [{ key: UNCATEGORISED, label: t('ai.routing.uncategorised'), feeds: uncategorised, category: false }] : []),
  ];
  const gridStyle = { '--cell': touch ? '40px' : '32px' } as CSSProperties;
  const defaultLabel = t('ai.routing.default');

  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.routing.title')}</BlockTitle>
      <div className="space-y-1 text-xs max-w-prose" style={{ color: 'var(--list-summary)' }}>
        <p>{t('ai.routing.hint')}</p>
        <p id={legendId}>{t('ai.routing.legend')}</p>
      </div>
      <div className="ai-routing">
        <div data-routing-grid className="ai-routing__grid" style={gridStyle}>
          {/* Les mots des colonnes, une fois. Décoratifs : chaque contrôle porte son nom complet ; le `title` dit ce que fait la colonne. */}
          <div data-routing-header aria-hidden="true" className={`${rowClass} pb-1 border-x border-transparent text-[11px] leading-tight`} style={{ color: 'var(--list-summary)' }}>
            <span />
            {columns.map((c) => <span key={c.kind} title={c.title} className="text-center whitespace-nowrap">{c.word}</span>)}
            <span className="text-center whitespace-nowrap"><span className="ai-routing__wide-text">{t('ai.routing.providerColumn')}</span></span>
          </div>
          <ul className="col-span-full grid grid-cols-subgrid gap-y-2">
            {groups.map((group, index) => {
              const expanded = open.has(group.key);
              const count = tuned(group.feeds);
              const bodyId = `${uid}-group-${index}`;
              const name = group.label;
              return (
                <li key={group.key} className="col-span-full grid grid-cols-subgrid rounded-lg" style={{ border: '1px solid var(--panel-border)' }}>
                  <div
                    data-routing-row="category" className={`${rowClass} py-1 ${expanded ? 'rounded-t-[7px]' : 'rounded-[7px]'}`}
                    style={{ background: 'var(--panel-header-bg)', borderBottom: expanded ? '1px solid var(--panel-border)' : undefined }}
                  >
                    <button
                      type="button" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={() => toggle(group.key)}
                      className="prefs-tap-row min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
                      style={{ color: 'var(--list-title)' }}
                    >
                      <Chevron open={expanded} />
                      <span className="ai-routing__cat-label">
                        <span className="truncate text-[13px] font-semibold" title={name}>{name}</span>
                        {/* Le compte cède la place avant le nom (`shrink-[100]`) ; à l'étroit, il passe sous lui. */}
                        <span className="truncate shrink-[100] text-[11px] font-normal" style={{ color: 'var(--list-summary)' }}>
                          {t('ai.routing.feedCount', { count: group.feeds.length })}
                          {count > 0 && <span style={{ color: 'var(--accent)' }}>{t('ai.routing.overrides', { count })}</span>}
                        </span>
                      </span>
                    </button>
                    {/* « Sans catégorie » n'est pas une catégorie : rien à y régler, ses flux ont chacun les leurs. */}
                    {group.category && (
                      <>
                        {toggles(name, (k) => ({
                          state: (k === 'panel' ? categoryPanelOn(name) : categoryAuto(k, name)) ? 'on' : 'off',
                        }), {
                          summary: (v) => setCategoryAutoSummary(name, v),
                          translate: (v) => setCategoryAutoTranslate(name, v),
                          panel: (v) => setCategoryPanel(name, v),
                        })}
                        <ProviderPicker
                          menuLabel={t('ai.routing.categoryProviderFor', { name })} providers={providers} value={categoryValue(name)}
                          defaultLabel={defaultLabel} touch={touch} onPick={(v) => setCategoryProvider(name, v)}
                        />
                      </>
                    )}
                  </div>
                  {expanded && (
                    <ul id={bodyId} className="col-span-full grid grid-cols-subgrid py-0.5">
                      {group.feeds.map((feed) => {
                        const feedName = feed.title || feed.id;
                        return (
                          <li key={feed.id} data-routing-row="feed" className={`${rowClass} py-0.5`}>
                            <div data-routing-name className="ai-routing__feed-name min-w-0 flex items-center gap-1.5">
                              <FeedFavicon iconUrl={feed.iconUrl} title={feedName} size={14} />
                              <span className="truncate text-[13px]" style={{ color: 'var(--list-title)' }} title={feedName}>{feedName}</span>
                            </div>
                            {toggles(feedName, feedState(feed), {
                              summary: (v) => setFeedAutoSummary(feed.id, v),
                              translate: (v) => setFeedAutoTranslate(feed.id, v),
                              panel: (v) => setFeedPanel(feed.id, v),
                            })}
                            <ProviderPicker
                              menuLabel={t('ai.routing.feedProviderFor', { name: feedName })} providers={providers} value={feedValue(feed.id)}
                              defaultLabel={defaultLabel} touch={touch} onPick={(v) => setFeedProvider(feed.id, v)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
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
