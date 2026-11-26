import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useAuthStore } from '../../../stores/authStore';
import type { AiProviderView } from '../../../api/backend';
import ToggleSwitch from '../../ToggleSwitch';
import { AutoSummaryConfirm, BlockTitle, ProviderOptions } from './shared';
import { PrefCard, PrefIntro, PrefRow } from '../prefsUi';
import { inputClass, inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];

/**
 * Bloc « Résumés » : la longueur visée, en pour cent de l'article (formatée par
 * la langue — « 20 % » en français, « 20% » en anglais —, sans clé de
 * traduction), puis le fournisseur préféré, le repli, le résumé automatique
 * (qu'on n'active qu'après une confirmation de coût, une fois par compte,
 * partagée avec les interrupteurs « Résumer » de « Par flux et catégorie »),
 * la traduction automatique du résumé (sans confirmation : un court appel
 * sur un résumé déjà là), la visibilité du panneau « Résumé IA » dans la lecture (toujours là, ou
 * seulement avec un résumé) et, quand l'instance
 * paie sous plafond, la consommation du jour.
 */
export default function SummariesBlock({ showIntro }: { showIntro: boolean }) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const ratio = useUiStore((s) => s.aiSummaryRatio);
  const setRatio = useUiStore((s) => s.setAiSummaryRatio);
  const providers = useAiStore((s) => s.config?.providers) ?? NO_PROVIDERS;
  const defaultProvider = useAiStore((s) => s.config?.defaultProvider ?? null);
  const dailyCap = useAiStore((s) => s.config?.dailyCap ?? 0);
  const usageToday = useAiStore((s) => s.config?.usageToday ?? 0);
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  const preferred = useUiStore((s) => s.aiPreferredProvider);
  const setPreferred = useUiStore((s) => s.setAiPreferredProvider);
  const fallback = useUiStore((s) => s.aiFallback);
  const setFallback = useUiStore((s) => s.setAiFallback);
  const auto = useUiStore((s) => s.aiAutoSummary);
  const setAuto = useUiStore((s) => s.setAiAutoSummary);
  const autoConfirmed = useUiStore((s) => s.aiAutoSummaryConfirmed);
  const setAutoConfirmed = useUiStore((s) => s.setAiAutoSummaryConfirmed);
  const summaryTranslate = useUiStore((s) => s.aiAutoSummaryTranslate);
  const setSummaryTranslate = useUiStore((s) => s.setAiAutoSummaryTranslate);
  const panelAlways = useUiStore((s) => s.aiPanelAlways);
  const setPanelAlways = useUiStore((s) => s.setAiPanelAlways);
  const [confirmAuto, setConfirmAuto] = useState(false);
  // « Par défaut (X) » nomme ce que la résolution du serveur prendra sans
  // préféré : le défaut admin s'il est utilisable par CE lecteur, sinon le
  // premier disponible (`resolveProvider`, ordre de l'admin). Nommer un défaut
  // admin hors de sa portée annonçait un fournisseur qui ne servirait jamais.
  const usable = providers.filter((p) => p.available);
  const defaultName = (usable.find((p) => p.id === defaultProvider) ?? usable[0])?.name;
  const defaultLabel = defaultName ? t('ai.user.preferredDefault', { name: defaultName }) : t('ai.user.preferredAuto');
  // La consommation n'a de sens que si le plafond s'applique à ce lecteur : un
  // admin n'y est pas soumis, et une clé personnelle n'y compte pas.
  const instancePays = providers.some((p) => p.available && p.hasAdminKey && p.shared && !p.hasUserKey);
  const showUsage = !isAdmin && dailyCap > 0 && instancePays;
  let shown: string;
  try {
    shown = new Intl.NumberFormat(i18n?.language || undefined, { style: 'percent' }).format(ratio / 100);
  } catch {
    shown = `${ratio} %`;
  }
  const toggle = (key: string, label: string, checked: boolean, onChange: (on: boolean) => void, hints: [string, string][]) => (
    <PrefRow
      label={label}
      hint={hints.map(([id, text], i) => <span key={id} id={id} className={i ? 'block mt-1' : 'block'}>{text}</span>)}
      control={<ToggleSwitch checked={checked} onChange={onChange} ariaLabel={label} describedBy={hints.map(([id]) => id).join(' ')} />}
      key={key}
    />
  );
  return (
    <section>
      <BlockTitle>{t('ai.user.title')}</BlockTitle>
      {showIntro && <PrefIntro>{t('ai.userIntro')}</PrefIntro>}
      <PrefCard>
        <PrefRow
          stacked
          labelFor={`${uid}-ratio`}
          label={(
            <span className="flex items-baseline justify-between gap-3">
              <span>{t('ai.user.ratio')}</span>
              <span aria-hidden="true" className="font-semibold tabular-nums">{shown}</span>
            </span>
          )}
          hint={t('ai.ratioHint')}
          hintId={`${uid}-ratio-hint`}
          control={(
            <input
              id={`${uid}-ratio`} type="range" min={5} max={50} step={5} value={ratio}
              aria-label={t('ai.user.ratio')} aria-valuetext={shown} aria-describedby={`${uid}-ratio-hint`}
              onChange={(e) => setRatio(Number(e.target.value))}
              className="prefs-tap-row w-full cursor-pointer accent-[var(--accent)]"
            />
          )}
        />
        <PrefRow
          stacked
          labelFor={`${uid}-preferred`}
          label={t('ai.user.preferred')}
          control={(
            <select
              id={`${uid}-preferred`} value={preferred === null ? '' : String(preferred)} className={inputClass} style={inputStyle}
              onChange={(e) => setPreferred(e.target.value ? Number(e.target.value) : null)}
            >
              <ProviderOptions providers={providers} value={preferred} defaultLabel={defaultLabel} />
            </select>
          )}
        />
      </PrefCard>

      <PrefCard className="mt-3">
        {toggle('fallback', t('ai.user.fallback'), fallback, setFallback, [
          [`${uid}-fallback-hint`, t('ai.user.fallbackHint')],
          [`${uid}-fallback-manual-hint`, t('ai.user.fallbackManualHint')],
        ])}
        {toggle('auto', t('ai.user.auto'), auto, (on) => (on && !autoConfirmed ? setConfirmAuto(true) : setAuto(on)), [
          [`${uid}-auto-hint`, t('ai.user.autoHint')],
        ])}
        {toggle('summaryTranslate', t('ai.user.summaryTranslate'), summaryTranslate, setSummaryTranslate, [
          [`${uid}-summary-translate-hint`, t('ai.user.summaryTranslateHint')],
        ])}
        {toggle('panel', t('ai.user.panel'), panelAlways, setPanelAlways, [
          [`${uid}-panel-hint`, t('ai.user.panelHint')],
        ])}
      </PrefCard>

      {showUsage && (
        <p className="prefs-hint mt-3">{t('ai.user.usage', { used: usageToday, cap: dailyCap })}</p>
      )}

      <AutoSummaryConfirm
        open={confirmAuto}
        onConfirm={() => { setAuto(true); setAutoConfirmed(true); setConfirmAuto(false); }}
        onCancel={() => setConfirmAuto(false)}
      />
    </section>
  );
}
