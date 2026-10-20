import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../../stores/uiStore';
import { BlockTitle } from './shared';

/**
 * Bloc « Résumés » : la longueur visée, en pour cent de l'article. Le
 * pourcentage est formaté par la langue (« 20 % » en français, « 20% » en
 * anglais), sans clé de traduction.
 */
export default function SummariesBlock({ showIntro }: { showIntro: boolean }) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const ratio = useUiStore((s) => s.aiSummaryRatio);
  const setRatio = useUiStore((s) => s.setAiSummaryRatio);
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
    </section>
  );
}
