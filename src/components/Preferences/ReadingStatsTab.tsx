import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getArticleFeedback, type ArticleFeedback } from '../../api/intelligence';
import { useAuthStore } from '../../stores/authStore';
import { useFeedStore } from '../../stores/feedStore';
import { getArticleOpenEvents, type ArticleOpenEvent } from '../../api/readingStats';
import { estimatedSkimMinutes } from '../../lib/readingStats';

type Period = '7d' | '30d' | 'year' | 'all';
const PERIODS: Array<{ value: Period; label: string; ms: number | null }> = [
  { value: '7d', label: '7 days', ms: 7 * 86400000 },
  { value: '30d', label: '30 days', ms: 30 * 86400000 },
  { value: 'year', label: 'Year', ms: 365 * 86400000 },
  { value: 'all', label: 'All time', ms: null },
];

const STOP_WORDS = new Set(('the and for with from that this have has was were are you your our into about after before over under more most than then they them their what when where which who how why will would could should not but all any each only also new says said say one two first last next now still just very much many some other use using used via per its out off get got make made based according their article articles news latest update updates report reports says said from bei und der die das den dem des ein eine einer eines einem einen ist sind war waren wie was mit von für auf aus über nach nicht auch mehr als bei zum zur im am an and or to of in on by as is it be we i a at'.split(/\s+/));

function periodStart(period: Period): number | null {
  const ms = PERIODS.find((p) => p.value === period)?.ms;
  return ms == null ? null : Date.now() - ms;
}

function uniqueInPeriod(events: ArticleOpenEvent[], start: number | null): ArticleOpenEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (start !== null && event.openedAt < start) return false;
    if (seen.has(event.articleId)) return false;
    seen.add(event.articleId);
    return true;
  });
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function buildTopics(events: ArticleOpenEvent[], feedback: ArticleFeedback[], savedSignals: Array<{ title: string; summary: string; starred: boolean; readLater: boolean }> | null, start: number | null) {
  const weights = new Map<string, number>();
  const addText = (text: string, weight: number) => {
    const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
    const local = new Set(words.filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w)));
    for (const word of local) weights.set(word, (weights.get(word) || 0) + weight);
    // Common two-word phrases add useful context without requiring AI.
    const phraseWords = words.filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w));
    for (let i = 0; i < phraseWords.length - 1; i++) {
      const phrase = phraseWords[i] + ' ' + phraseWords[i + 1];
      weights.set(phrase, (weights.get(phrase) || 0) + weight * 1.35);
    }
  };
  for (const event of uniqueInPeriod(events, start)) addText(event.text || event.title, 0.35);
  for (const item of savedSignals || []) {
    const weight = (item.starred ? 1.3 : 0) + (item.readLater ? 1.0 : 0);
    if (weight > 0) addText([item.title, item.summary].filter(Boolean).join(' '), weight);
  }
  for (const item of feedback) {
    const when = Date.parse(item.updatedAt || item.createdAt || '');
    if (start !== null && Number.isFinite(when) && when < start) continue;
    addText([item.title, item.summary].filter(Boolean).join(' '), item.vote === 1 ? 3 : -2.5);
  }
  return [...weights.entries()]
    .filter(([, weight]) => weight > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([word, weight]) => ({ word, weight }));
}

export default function ReadingStatsTab({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const serverId = useAuthStore((s) => s.activeServerId);
  const starredCount = useFeedStore((s) => s.starredCount);
  const readLaterCount = useFeedStore((s) => s.readLaterCount);
  const savedArticleSignals = useFeedStore((s) => s.savedArticleSignals);
  const [period, setPeriod] = useState<Period>('30d');
  const [events, setEvents] = useState<ArticleOpenEvent[]>([]);
  const [feedback, setFeedback] = useState<ArticleFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    if (!active || !serverId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await getArticleOpenEvents(serverId);
        if (!cancelled) setEvents(rows);
      } catch {
        if (!cancelled) setEvents([]);
      }
    };
    void refresh();
    window.addEventListener('frirss:reading-stats-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('frirss:reading-stats-updated', refresh);
    };
  }, [active, serverId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setFeedbackLoading(true);
    getArticleFeedback()
      .then((items) => { if (!cancelled) setFeedback(Array.isArray(items) ? items : []); })
      .catch(() => { if (!cancelled) setFeedback([]); })
      .finally(() => { if (!cancelled) setFeedbackLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  const start = periodStart(period);
  const opened = useMemo(() => uniqueInPeriod(events, start), [events, start]);
  const votes = useMemo(() => feedback.filter((item) => {
    if (start === null) return true;
    const when = Date.parse(item.updatedAt || item.createdAt || '');
    return !Number.isFinite(when) || when >= start;
  }), [feedback, start]);
  const upvotes = votes.filter((item) => item.vote === 1).length;
  const downvotes = votes.filter((item) => item.vote === -1).length;
  const totalMinutes = opened.reduce((sum, item) => sum + estimatedSkimMinutes(item.wordCount), 0);
  const averageMinutes = opened.length ? Math.round(totalMinutes / opened.length) : 0;
  const topics = useMemo(() => buildTopics(events, feedback, savedArticleSignals, start), [events, feedback, savedArticleSignals, start]);
  const maxTopicWeight = topics[0]?.weight || 1;
  const activity = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      day.setDate(now.getDate() - (6 - i));
      return { day, count: 0 };
    });
    const startOfDays = days[0]?.day.getTime() || 0;
    const counts = new Map<string, Set<string>>();
    for (const event of events) {
      if (event.openedAt < startOfDays) continue;
      const dayKey = new Date(event.openedAt).toLocaleDateString();
      if (!counts.has(dayKey)) counts.set(dayKey, new Set());
      counts.get(dayKey)!.add(event.articleId);
    }
    return days.map(({ day }) => {
      const count = counts.get(day.toLocaleDateString())?.size || 0;
      return { label: day.toLocaleDateString(undefined, { weekday: 'short' }), count };
    });
  }, [events]);
  const maxActivity = Math.max(1, ...activity.map((d) => d.count));

  const card = (icon: string, value: string | number, label: string, tint: string) => (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--panel-header-bg)' }}>
      <div className="text-sm mb-2" style={{ color: tint }}>{icon}</div>
      <div className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ color: 'var(--list-title)' }}>{value}</div>
      <div className="text-sm mt-1" style={{ color: 'var(--list-summary)' }}>{label}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold" style={{ color: 'var(--list-title)' }}>{t('readingStats.title', 'Reading Stats')}</h3>
        <p className="text-sm mt-1" style={{ color: 'var(--list-summary)' }}>{t('readingStats.subtitle', 'Your personal reading dashboard')}</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: 'var(--panel-header-bg)' }} role="group" aria-label="Statistics period">
        {PERIODS.map((item) => (
          <button key={item.value} onClick={() => setPeriod(item.value)} className="px-3 py-2 rounded-lg text-sm"
            aria-pressed={period === item.value}
            style={{ background: period === item.value ? 'var(--panel-bg)' : 'transparent', color: 'var(--list-title)', fontWeight: period === item.value ? 600 : 400 }}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {card('▤', opened.length, 'Articles opened', '#3979e8')}
        {card('👍', upvotes, 'Upvotes', '#16865b')}
        {card('👎', downvotes, 'Downvotes', '#c34b4b')}
        {card('☆', starredCount, 'Currently starred', '#b8860b')}
        {card('▱', readLaterCount, 'Saved for later now', '#8061b2')}
        {card('◷', formatHours(totalMinutes), 'Estimated skim-adjusted reading time', '#3979e8')}
      </div>
      <p className="text-xs" style={{ color: 'var(--list-summary)' }}>
        Estimated time uses opened articles only, at 230 words/minute with a 60% skim factor. Opening history is collected from now on and stored on the FriRSS server for this FreshRSS account.
        {feedbackLoading ? ' Loading feedback…' : ''}
      </p>
      <section className="border-t pt-5" style={{ borderColor: 'var(--panel-border)' }}>
        <h4 className="text-base font-semibold mb-4" style={{ color: 'var(--list-title)' }}>Reading activity · last 7 days</h4>
        <div className="space-y-3">
          {activity.map((day) => (
            <div key={day.label} className="flex items-center gap-3">
              <span className="text-sm w-9" style={{ color: 'var(--list-summary)' }}>{day.label}</span>
              <div className="h-2.5 rounded-full overflow-hidden flex-1" style={{ background: 'var(--panel-header-bg)' }}>
                <div className="h-full rounded-full" style={{ width: `${day.count / maxActivity * 100}%`, background: 'var(--accent)' }} />
              </div>
              <span className="text-xs tabular-nums w-5 text-right" style={{ color: 'var(--list-summary)' }}>{day.count}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="border-t pt-5" style={{ borderColor: 'var(--panel-border)' }}>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h4 className="text-base font-semibold" style={{ color: 'var(--list-title)' }}>Your topics</h4>
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>Based on opened headlines and votes</span>
        </div>
        {topics.length ? (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3 py-4">
            {topics.map((topic, i) => (
              <span key={topic.word} title={`Interest weight: ${topic.weight.toFixed(1)}`}
                style={{ fontSize: `${Math.round(13 + 19 * topic.weight / maxTopicWeight)}px`, fontWeight: i < 5 ? 650 : 450,
                  color: ['var(--accent)', '#16865b', '#8061b2', '#b8860b', 'var(--list-title)'][i % 5] }}>
                {topic.word}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--list-summary)' }}>
            Topics will appear as you open articles and vote on them. Existing votes are included when available.
          </p>
        )}
      </section>
    </div>
  );
}
