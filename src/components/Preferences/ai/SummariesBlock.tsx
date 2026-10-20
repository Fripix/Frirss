import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../../stores/uiStore';
import { useAiStore } from '../../../stores/aiStore';
import { useAuthStore } from '../../../stores/authStore';
import type { AiProviderView } from '../../../api/backend';
import ToggleSwitch from '../../ToggleSwitch';
import { AutoSummaryConfirm, BlockTitle, ProviderOptions } from './shared';
import { inputClass, inputStyle } from './styles';

/** Référence stable : un `?? []` dans le sélecteur ferait rerendre sans fin. */
const NO_PROVIDERS: AiProviderView[] = [];

/**
 * Bloc « Résumés » : la longueur visée, en pour cent de l'article (formatée par
 * la langue — « 20 % » en français, « 20% » en anglais —, sans clé de
 * traduction), puis le fournisseur préféré, le repli, le résumé automatique
 * (qu'on n'active qu'après une confirmation de coût, partagée avec les
 * interrupteurs « Résumer » de « Par flux et catégorie ») et, quand l'instance
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
  const setAutoConfirmed = useUiStore((s) => s.setAiAutoSummaryConfirmed);
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
  return (
    <section className="space-y-3">
      <BlockTitle>{t('ai.user.title')}</BlockTitle>
      {showIntro && <p className="text-sm max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.userIntro')}</p>}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <label htmlFor={`${uid}-ratio`} className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.user.ratio')}</label>
          <span aria-hidden="true" className="text-sm font-semibold tabular-nums" style={{ color: 'var(--list-title)' }}>{shown}</span>
        </div>
        <input
          id={`${uid}-ratio`} type="range" min={5} max={50} step={5} value={ratio}
          aria-valuetext={shown} aria-describedby={`${uid}-ratio-hint`}
          onChange={(e) => setRatio(Number(e.target.value))}
          className="prefs-tap-row w-full cursor-pointer accent-[var(--accent)]"
        />
        <p id={`${uid}-ratio-hint`} className="text-[11px] mt-1 max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.ratioHint')}</p>
      </div>

      <div>
        <label htmlFor={`${uid}-preferred`} className="block text-sm mb-1" style={{ color: 'var(--list-title)' }}>{t('ai.user.preferred')}</label>
        <select
          id={`${uid}-preferred`} value={preferred === null ? '' : String(preferred)} className={inputClass} style={inputStyle}
          onChange={(e) => setPreferred(e.target.value ? Number(e.target.value) : null)}
        >
          <ProviderOptions providers={providers} value={preferred} defaultLabel={defaultLabel} />
        </select>
      </div>

      <div>
        <div className="prefs-tap-row flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.user.fallback')}</span>
          <ToggleSwitch checked={fallback} onChange={setFallback} ariaLabel={t('ai.user.fallback')} describedBy={`${uid}-fallback-hint`} />
        </div>
        <p id={`${uid}-fallback-hint`} className="text-[11px] mt-1 max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.user.fallbackHint')}</p>
      </div>

      <div>
        <div className="prefs-tap-row flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: 'var(--list-title)' }}>{t('ai.user.auto')}</span>
          <ToggleSwitch checked={auto} onChange={(on) => (on ? setConfirmAuto(true) : setAuto(false))} ariaLabel={t('ai.user.auto')} describedBy={`${uid}-auto-hint`} />
        </div>
        <p id={`${uid}-auto-hint`} className="text-[11px] mt-1 max-w-prose" style={{ color: 'var(--list-summary)' }}>{t('ai.user.autoHint')}</p>
      </div>

      {showUsage && (
        <p className="text-xs" style={{ color: 'var(--list-summary)' }}>{t('ai.user.usage', { used: usageToday, cap: dailyCap })}</p>
      )}

      <AutoSummaryConfirm
        open={confirmAuto}
        onConfirm={() => { setAuto(true); setAutoConfirmed(true); setConfirmAuto(false); }}
        onCancel={() => setConfirmAuto(false)}
      />
    </section>
  );
}
