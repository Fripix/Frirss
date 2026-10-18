import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { DEFAULT_CUSTOM_INTERESTING_WEIGHTS, type ExternalSignalSource } from '../../lib/intelligenceRanking';

const SOURCES: Array<{ key: ExternalSignalSource; label: string; description: string }> = [
  { key: 'gdelt', label: 'GDELT', description: 'Breadth of recent news coverage' },
  { key: 'github', label: 'GitHub', description: 'Repository traction and recent activity' },
  { key: 'hackerNews', label: 'Hacker News', description: 'Interest in the Hacker News community' },
  { key: 'lobsters', label: 'Lobsters', description: 'Interest in the Lobsters community' },
];

export default function RankingWeightsTab() {
  const { t } = useTranslation();
  const weights = useUiStore((s) => s.interestingRankingWeights);
  const setWeights = useUiStore((s) => s.setInterestingRankingWeights);
  const fieldClass = 'w-20 rounded-lg px-2 py-1.5 text-sm text-right outline-none';
  const fieldStyle = { background: 'var(--panel-header-bg)', color: 'var(--list-title)', border: '1px solid var(--panel-border)' };

  function updateSource(source: ExternalSignalSource, value: number) {
    setWeights({ ...weights, sources: { ...weights.sources, [source]: Math.max(0, Math.min(100, Math.round(value))) } });
  }

  return (
    <div className="p-4 sm:p-5 space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--list-title)' }}>
          {t('preferences.rankingWeights.title', 'Interesting ranking weights')}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.rankingWeights.intro', 'Tune how much external attention influences the Interesting view. These settings apply when the Custom algorithm is selected. Existing ranking presets are unchanged.')}
        </p>
      </div>

      <section className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--panel-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <label htmlFor="ranking-external-influence" className="text-sm font-medium" style={{ color: 'var(--list-title)' }}>
              {t('preferences.rankingWeights.externalInfluence', 'External influence')}
            </label>
            <p className="text-xs mt-1" style={{ color: 'var(--list-summary)' }}>
              {t('preferences.rankingWeights.externalInfluenceHelp', 'The share of the final ranking score driven by external signals.')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input id="ranking-external-influence-number" type="number" min={0} max={100} step={5} value={weights.externalInfluence}
              onChange={(e) => setWeights({ ...weights, externalInfluence: Number(e.target.value) })}
              aria-label={t('preferences.rankingWeights.externalInfluence', 'External influence')}
              className={fieldClass} style={fieldStyle} />
            <span className="text-sm" style={{ color: 'var(--list-summary)' }}>%</span>
          </div>
        </div>
        <input id="ranking-external-influence" type="range" min={0} max={100} step={5} value={weights.externalInfluence}
          onChange={(e) => setWeights({ ...weights, externalInfluence: Number(e.target.value) })}
          aria-label={t('preferences.rankingWeights.externalInfluence', 'External influence')}
          className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-xs" style={{ color: 'var(--list-summary)' }}>
          <span>0% · Personal relevance only</span><span>100% · External signals only</span>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--list-title)' }}>
            {t('preferences.rankingWeights.sourcesTitle', 'External source weights')}
          </h4>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--list-summary)' }}>
            {t('preferences.rankingWeights.sourcesHelp', 'These weights set the relative mix between sources. They are normalized automatically, so they do not need to add up to 100%. Set a source to 0% to exclude it.')}
          </p>
        </div>
        {SOURCES.map((source) => (
          <div key={source.key} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <label htmlFor={`ranking-source-${source.key}`} className="text-sm font-medium" style={{ color: 'var(--list-title)' }}>{source.label}</label>
                <p className="text-xs mt-0.5" style={{ color: 'var(--list-summary)' }}>{source.description}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input type="number" min={0} max={100} step={5} value={weights.sources[source.key]}
                  onChange={(e) => updateSource(source.key, Number(e.target.value))}
                  aria-label={`${source.label} weight`} className={fieldClass} style={fieldStyle} />
                <span className="text-sm" style={{ color: 'var(--list-summary)' }}>%</span>
              </div>
            </div>
            <input id={`ranking-source-${source.key}`} type="range" min={0} max={100} step={5} value={weights.sources[source.key]}
              onChange={(e) => updateSource(source.key, Number(e.target.value))}
              aria-label={`${source.label} weight`} className="w-full accent-[var(--accent)]" />
          </div>
        ))}
      </section>

      <div className="flex items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--list-summary)' }}>
          {t('preferences.rankingWeights.savedAutomatically', 'Changes save automatically to your account. Select Custom in the Interesting view to use them.')}
        </p>
        <button type="button" onClick={() => setWeights(DEFAULT_CUSTOM_INTERESTING_WEIGHTS)}
          className="rounded-lg px-3 py-2 text-xs font-medium shrink-0"
          style={{ color: 'var(--list-title)', border: '1px solid var(--panel-border)' }}>
          {t('preferences.rankingWeights.reset', 'Reset')}
        </button>
      </div>
    </div>
  );
}
