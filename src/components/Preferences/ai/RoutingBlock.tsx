import { useId, useMemo, useState } from 'react';
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
 * La paire « Résumer » / « Traduire » d'une ligne. Le mot visible, masqué aux
 * lecteurs d'écran, figure dans le nom accessible, qui dit en plus la ligne
 * concernée ; tout le `<label>` se touche. `ml-auto` : quand la
 * ligne n'a plus la place (320 px), la paire passe dessous, calée à droite,
 * sous le sélecteur.
 */
function AutoSwitches({ name, summary, translate, onChange, hintId }: {
  name: string; summary: boolean; translate: boolean; hintId: string;
  onChange: (kind: AutoKind, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const item = (kind: AutoKind, checked: boolean) => (
    <label className="prefs-tap-row inline-flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--list-summary)' }}>
      <span aria-hidden="true">{t(kind === 'summary' ? 'ai.routing.autoSummary' : 'ai.routing.autoTranslate')}</span>
      <ToggleSwitch
        checked={checked} onChange={(on) => onChange(kind, on)} describedBy={hintId}
        ariaLabel={t(kind === 'summary' ? 'ai.routing.autoSummaryFor' : 'ai.routing.autoTranslateFor', { name })}
      />
    </label>
  );
  return (
    <span data-auto-switches="" className="ml-auto flex flex-wrap items-center justify-end gap-x-3">
      {item('summary', summary)}
      {item('translate', translate)}
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
 * Chaque ligne de catégorie ou de flux porte aussi « Résumer » et « Traduire »
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
      <div className="space-y-1">
        {groups.map((group, i) => {
          const expanded = open.has(group.key);
          const panelId = `${uid}-group-${i}`;
          const count = tuned(group.feeds);
          const value = group.category ? categoryValue(group.label) : null;
          return (
            <div key={group.key}>
              <div className="flex flex-wrap items-center gap-x-2">
                <button
                  type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(group.key)}
                  className="prefs-tap-row flex grow basis-[40%] min-w-0 items-center gap-2 text-left text-sm cursor-pointer"
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
                {group.category && (
                  <AutoSwitches
                    name={group.label} hintId={autoHintId}
                    summary={categoryAuto('summary', group.label)} translate={categoryAuto('translate', group.label)}
                    onChange={(kind, on) => switchAuto(kind, on, (v) =>
                      (kind === 'summary' ? setCategoryAutoSummary : setCategoryAutoTranslate)(group.label, v))}
                  />
                )}
              </div>
              <ul id={panelId} hidden={!expanded} className="ml-5 pl-3 space-y-1 border-l" style={{ borderColor: 'var(--panel-border)' }}>
                {expanded && group.feeds.map((feed) => {
                  const feedProvider = feedValue(feed.id);
                  const name = feed.title || feed.id;
                  return (
                    <li key={feed.id} className="flex flex-wrap items-center gap-x-2">
                      <span className="grow basis-[40%] min-w-0 py-2 text-sm [overflow-wrap:anywhere]" style={{ color: 'var(--list-title)' }}>{name}</span>
                      <select
                        aria-label={t('ai.routing.feedSelect', { name })}
                        value={feedProvider === null ? '' : String(feedProvider)} className={selectClass} style={inputStyle}
                        onChange={(e) => setFeedProvider(feed.id, e.target.value ? Number(e.target.value) : null)}
                      >
                        <ProviderOptions providers={providers} value={feedProvider} defaultLabel={t('ai.routing.default')} />
                      </select>
                      <AutoSwitches
                        name={name} hintId={autoHintId}
                        summary={autoFor('summary', feed.id, subscriptions, autoPrefs)}
                        translate={autoFor('translate', feed.id, subscriptions, autoPrefs)}
                        onChange={(kind, on) => switchAuto(kind, on, (v) =>
                          (kind === 'summary' ? setFeedAutoSummary : setFeedAutoTranslate)(feed.id, v))}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
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
