import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, normalizeAiProviderId } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useFeedStore } from '../../../stores/feedStore';
import { useBreakpoint } from '../../../hooks/useBreakpoint';
import { groupFeedsByCategory } from '../../../lib/feedCategories';
import { autoFor, panelFor, type AiAutoPrefs } from '../../../lib/aiAuto';
import { nextRoutingValue } from '../../../lib/routingLook';
import { targetLanguage } from '../../../lib/aiLanguages';
import type { AiProviderView } from '../../../api/backend';
import type { Subscription } from '../../../types';
import ConfirmDialog from '../../ConfirmDialog';
import FeedFavicon from '../../FeedFavicon';
import { AutoSummaryConfirm, BlockTitle } from './shared';
import { ProviderPicker, RoutingToggle, type ToggleKind, type ToggleState } from './RoutingControls';
import RoutingKey from './RoutingKey';

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

/**
 * L'état affiché d'un interrupteur et, pour un héritage, sa source : le
 * réglage global (`global`), la catégorie (ni l'un ni l'autre) ou, pour
 * « Résumé FR », la colonne Traduire (`viaTranslate`).
 */
type RowState = { state: ToggleState; global?: boolean; viaTranslate?: boolean };

/**
 * « Résumé FR » sur une ligne dont l'article est traduit automatiquement : le
 * volet de lecture traduit alors le résumé quoi que dise la colonne
 * (`ReadingPane`, `autoTranslate || …`). Elle l'affiche donc cerclée de vert,
 * « activé par Traduire » — sauf un « activé » propre, qui reste plein. Le
 * clic n'y alterne qu'entre ces deux-là (voir `toggles`).
 */
function withTranslate(kind: ToggleKind, v: RowState, translateOn: boolean): RowState {
  return kind === 'summaryTranslate' && translateOn && v.state !== 'on' ? { state: 'inherited', viaTranslate: true } : v;
}

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
 * et des quatre réglages, en **matrice** — une ligne par catégorie, une
 * ligne par flux, jamais deux. Une seule grille pour tout le bloc :
 * `minmax(0,1fr)` pour le nom, puis quatre colonnes d'interrupteurs (au moins
 * `--cell`, plus si le mot de l'en-tête est plus large) et le fournisseur.
 * Les mots des colonnes (« Résumer », « Traduire », « Résumé traduit »,
 * « Panneau », « IA ») ne sont écrits qu'une fois, en tête : la ligne ne porte
 * que des icônes, et se lit d'un coup d'œil. Au-dessus, la **clé**
 * (`RoutingKey`) : un tableau icône / nom / description des quatre colonnes,
 * puis les trois aspects d'un interrupteur. À l'étroit (< 420 px de
 * conteneur), l'en-tête de mots disparaît — ses mots élargissaient les
 * colonnes aux dépens du nom — et la clé, toujours visible, les porte ; la
 * mise en page étroite vit dans `index.css`.
 *
 * Chaque catégorie forme un groupe cerclé : sa **bande** (fond d'en-tête de
 * panneau, nom en gras, « N flux » et « , N réglés » en accent) puis, une fois
 * dépliée, ses flux, indentés, favicon et nom. Les flux sans catégorie forment
 * un dernier groupe, sans réglage de groupe. Un flux l'emporte sur sa
 * catégorie, qui l'emporte sur le réglage global.
 *
 * « Résumer » et « Traduire » lancent l'action à l'ouverture de chaque article
 * de la ligne ; « Résumé traduit » traduit le résumé dès qu'il s'affiche
 * (aussi, sans ce réglage, sur un article traduit automatiquement) ;
 * « Panneau » garde le panneau Résumé IA visible même sans résumé. Les quatre
 * colonnes héritent de la même façon. Un flux affiche sa
 * valeur effective (`autoFor` / `panelFor`), une catégorie la sienne ou le
 * réglage global, et chacun dit d'où elle vient : **plein**, réglé ici (vert
 * activé, gris désactivé) ; **cerclé**, hérité de la catégorie ou du réglage
 * global (vert s'il active, gris sinon). Un clic passe à l'état suivant —
 * désactivé → activé → hérité — si bien qu'une valeur propre se retire
 * comme elle se pose, et qu'éteindre un flux sous une catégorie allumée, ou
 * une catégorie sous un réglage global allumé, tient. Allumer « Traduire »
 * ou « Résumer » demande une fois par compte la confirmation de coût ;
 * « Résumé traduit » (un court appel de plus) et « Panneau » n'en ont pas.
 *
 * Les catégories sont réglées par **nom** : en renommer une perd son réglage.
 */
export default function RoutingBlock() {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const translationLanguage = useUiStore((s) => s.aiTranslationLanguage);
  // « Résumé FR » : la langue cible, en code court, porte le mot de la colonne sur une ligne.
  const targetCode = (translationLanguage === 'ui' ? targetLanguage(i18n?.language ?? 'fr') : translationLanguage).split('-')[0].toUpperCase();
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
  const categorySummaryTranslate = useUiStore((s) => s.aiCategoryAutoSummaryTranslate);
  const setCategorySummaryTranslate = useUiStore((s) => s.setAiCategoryAutoSummaryTranslate);
  const setFeedSummaryTranslate = useUiStore((s) => s.setFeedAiAutoSummaryTranslate);
  const summaryTranslate = useUiStore((s) => s.aiAutoSummaryTranslate);
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
    aiCategoryAutoSummaryTranslate: categorySummaryTranslate, aiAutoSummaryTranslate: summaryTranslate,
  };
  const panelPrefs = { ...autoPrefs, aiCategoryPanel: categoryPanel, aiPanelAlways: panelAlways };
  /**
   * L'état d'une catégorie, même règle pour les quatre colonnes : sa valeur
   * propre (pleine : verte activée, grise désactivée), sinon le réglage global
   * — cerclée de vert s'il l'active, de gris sinon (« hérité du réglage
   * global »). La traduction de l'article n'a pas de réglage global : sans
   * valeur propre, elle hérite d'un « désactivé ».
   */
  const categoryValues = (kind: ToggleKind) => (kind === 'summary' ? categoryAutoSummary : kind === 'translate' ? categoryAutoTranslate
    : kind === 'summaryTranslate' ? categorySummaryTranslate : categoryPanel);
  const categoryState = (name: string) => (kind: ToggleKind): RowState => {
    const translateOn = Object.hasOwn(categoryAutoTranslate, name) && categoryAutoTranslate[name] === true;
    const values = categoryValues(kind);
    if (Object.hasOwn(values, name) && typeof values[name] === 'boolean') return withTranslate(kind, { state: values[name] ? 'on' : 'off' }, translateOn);
    const global = kind === 'summary' ? autoSummary : kind === 'panel' ? panelAlways : kind === 'summaryTranslate' ? summaryTranslate : false;
    return withTranslate(kind, { state: global ? 'inherited' : 'inheritedOff', global: true }, translateOn);
  };
  // « N réglés » : un fournisseur ou une valeur propre de résumé / traduction / résumé traduit / panneau.
  const tuned = (feeds: Subscription[]) => feeds.filter((f) => {
    const own = feedSettings[f.id];
    return feedValue(f.id) !== null || typeof own?.aiAutoSummary === 'boolean' || typeof own?.aiAutoTranslate === 'boolean'
      || typeof own?.aiPanel === 'boolean' || typeof own?.aiAutoSummaryTranslate === 'boolean';
  }).length;
  /**
   * Désactiver ou revenir à l'héritage s'applique tout de suite ; activer
   * Résumer ou Traduire passe d'abord, une fois par compte, par
   * l'avertissement de coût.
   */
  const switchAuto = (kind: AutoKind, value: boolean | null, apply: (v: boolean | null) => void) => {
    const ask = value === true && (kind === 'translate' ? !translateConfirmed : !autoSummary && !summaryConfirmed);
    if (ask) setPending({ kind, apply: () => apply(true) });
    else apply(value);
  };
  const confirmPending = () => {
    if (!pending) return;
    pending.apply();
    if (pending.kind === 'translate') setTranslateConfirmed(true);
    else setSummaryConfirmed(true);
    setPending(null);
  };
  const keyId = `${uid}-key`;

  // `label` : le nom de la colonne dans l'infobulle d'un interrupteur, en toutes lettres.
  const columns: { kind: ToggleKind; word: string; title: string; aria: string; label?: string }[] = [
    { kind: 'summary', word: t('ai.routing.autoSummary'), title: t('ai.routing.summaryTitle'), aria: 'ai.routing.autoSummaryFor' },
    { kind: 'translate', word: t('ai.routing.autoTranslate'), title: t('ai.routing.translateTitle'), aria: 'ai.routing.autoTranslateFor' },
    { kind: 'summaryTranslate', word: t('ai.routing.summaryTranslateShort', { lang: targetCode }), title: t('ai.routing.summaryTranslateTitle'), aria: 'ai.routing.summaryTranslateFor', label: t('ai.routing.summaryTranslate') },
    { kind: 'panel', word: t('ai.routing.panel'), title: t('ai.routing.panelTitle'), aria: 'ai.routing.panelFor' },
  ];
  const stateOn = t('ai.routing.stateOn');
  const stateOff = t('ai.routing.stateOff');
  /** « activé », « désactivé », ou pour un héritage sa source puis ce qu'elle donne : « hérité de la catégorie (activé) ». */
  const stateWord = (v: RowState) => {
    if (v.viaTranslate) return t('ai.routing.stateViaTranslate');
    if (v.state === 'on') return stateOn;
    if (v.state === 'off') return stateOff;
    const source = v.global ? t('ai.routing.stateGlobal') : t('ai.routing.stateInherited');
    return `${source} (${v.state === 'inherited' ? stateOn : stateOff})`;
  };

  /**
   * Les quatre interrupteurs d'une ligne. `value` donne l'état affiché et,
   * pour un état hérité, d'où il vient (pour le `title`) ; `write` est
   * l'écriture propre à la ligne — `null` retire la valeur propre. Un clic
   * écrit l'état suivant (`nextRoutingValue`). Activer Résumer ou Traduire
   * passe par la confirmation de coût ; Résumé traduit (un court appel, sur
   * un résumé déjà demandé) et Panneau non.
   */
  const toggles = (name: string, value: (k: ToggleKind) => RowState, write: Record<ToggleKind, (v: boolean | null) => void>) =>
    columns.map((c) => {
      const v = value(c.kind);
      // Forcé par Traduire, le seul choix qui change quelque chose est un
      // « activé » propre (il tient si Traduire s'éteint) : le clic va et vient
      // entre lui et l'héritage. Calculé sur l'état affiché, le cycle restait
      // bloqué — « hérité » → `false`, qui s'affichait encore « hérité ».
      const next = v.viaTranslate ? true : nextRoutingValue(v.state);
      return (
        <RoutingToggle
          key={c.kind} kind={c.kind} state={v.state} touch={touch} describedBy={keyId}
          ariaLabel={t(c.aria, { name })} title={t('ai.routing.labelValue', { label: c.label ?? c.word, value: stateWord(v) })}
          onNext={() => (c.kind === 'summary' || c.kind === 'translate' ? switchAuto(c.kind, next, write[c.kind]) : write[c.kind](next))}
        />
      );
    });

  /**
   * L'état d'un flux : sa valeur propre (plein), sinon l'effective (cerclé,
   * vert ou gris), et sa source : la catégorie si l'une d'elles porte une
   * valeur propre pour cette colonne, le réglage global sinon.
   */
  const feedState = (feed: Subscription) => (kind: ToggleKind): RowState => {
    const own = feedSettings[feed.id];
    const ownValue = kind === 'summary' ? own?.aiAutoSummary : kind === 'translate' ? own?.aiAutoTranslate
      : kind === 'summaryTranslate' ? own?.aiAutoSummaryTranslate : own?.aiPanel;
    const translateOn = kind === 'summaryTranslate' && autoFor('translate', feed.id, subscriptions, autoPrefs);
    if (typeof ownValue === 'boolean') return withTranslate(kind, { state: ownValue ? 'on' : 'off' }, translateOn);
    const on = kind === 'panel' ? panelFor(feed.id, subscriptions, panelPrefs) : autoFor(kind, feed.id, subscriptions, autoPrefs);
    const values = categoryValues(kind);
    const fromCategory = (feed.categories ?? []).some((c) => !!c.label && Object.hasOwn(values, c.label) && typeof values[c.label] === 'boolean');
    return withTranslate(kind, { state: on ? 'inherited' : 'inheritedOff', global: !fromCategory }, translateOn);
  };

  const groups: { key: string; label: string; feeds: Subscription[]; category: boolean }[] = [
    ...categories.map((c) => ({ key: c.id, label: c.label, feeds: c.feeds, category: true })),
    ...(uncategorised.length ? [{ key: UNCATEGORISED, label: t('ai.routing.uncategorised'), feeds: uncategorised, category: false }] : []),
  ];
  const defaultLabel = t('ai.routing.default');

  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.routing.title')}</BlockTitle>
      <RoutingKey id={keyId} />
      <div className="ai-routing">
        <div data-routing-grid data-touch={touch ? '' : undefined} className="ai-routing__grid">
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
                        {toggles(name, categoryState(name), {
                          summary: (v) => setCategoryAutoSummary(name, v),
                          translate: (v) => setCategoryAutoTranslate(name, v),
                          summaryTranslate: (v) => setCategorySummaryTranslate(name, v),
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
                              summary: (v) => setFeedAutoSummary(feed.id, v ?? ''),
                              translate: (v) => setFeedAutoTranslate(feed.id, v ?? ''),
                              summaryTranslate: (v) => setFeedSummaryTranslate(feed.id, v ?? ''),
                              panel: (v) => setFeedPanel(feed.id, v ?? ''),
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
