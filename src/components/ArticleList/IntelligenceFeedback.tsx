import { useEffect, useState } from 'react';
import type { Article } from '../../types';
import { getArticleFeedback, removeArticleFeedback, setArticleFeedback } from '../../api/intelligence';

let feedbackPromise: ReturnType<typeof getArticleFeedback> | null = null;
const feedbackById = new Map<string, 1 | -1>();
// Ignore a feedback snapshot that started before a vote mutation completed.
// Otherwise its stale response can clear the just-updated map and turn the
// clicked arrow grey again, even though the backend saved the vote.
let feedbackRevision = 0;

async function loadFeedback() {
  if (!feedbackPromise) {
    const revisionAtRequest = feedbackRevision;
    feedbackPromise = getArticleFeedback().then((rows) => {
      if (revisionAtRequest === feedbackRevision) {
        feedbackById.clear();
        rows.forEach((row) => feedbackById.set(row.articleId, row.vote));
      }
      return rows;
    }).catch((error) => {
      feedbackPromise = null;
      throw error;
    });
  }
  return feedbackPromise;
}

export default function IntelligenceFeedback({ article, compact = false }: { article: Article; compact?: boolean }) {
  const [vote, setVote] = useState<1 | -1 | null>(feedbackById.get(article.id) ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadFeedback().then(() => {
      if (active) setVote(feedbackById.get(article.id) ?? null);
    }).catch(() => { /* feedback must never block reading */ });
    return () => { active = false; };
  }, [article.id]);

  async function voteFor(next: 1 | -1) {
    setBusy(true);
    try {
      if (vote === next) {
        await removeArticleFeedback(article.id);
        feedbackRevision += 1;
        feedbackById.delete(article.id);
        feedbackPromise = null;
        setVote(null);
        window.dispatchEvent(new Event('frirss-intelligence-feedback-changed'));
      } else {
        await setArticleFeedback({
          articleId: article.id,
          url: article.url || '',
          title: article.title || '',
          summary: article.summary || '',
          content: article.content || '',
          sourceId: article.sourceId || '',
          vote: next,
        });
        feedbackRevision += 1;
        feedbackById.set(article.id, next);
        feedbackPromise = null;
        setVote(next);
        window.dispatchEvent(new Event('frirss-intelligence-feedback-changed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-1 ${compact ? "flex-shrink-0" : "px-3 pb-2"}`} onClick={(event) => event.stopPropagation()}>
      {!compact && <span className="text-[10px] mr-1" style={{ color: 'var(--text-muted, #888)' }}>Interesting?</span>}
      <button type="button" disabled={busy} onClick={() => void voteFor(1)} aria-label="This article is interesting" aria-pressed={vote === 1} title="More like this" className="rounded px-1.5 py-0.5 text-xs disabled:opacity-40" style={{ color: vote === 1 ? 'var(--accent)' : 'var(--text-muted, #888)', background: vote === 1 ? 'var(--accent-bg, transparent)' : 'transparent' }}>↑</button>
      <button type="button" disabled={busy} onClick={() => void voteFor(-1)} aria-label="This article is not interesting" aria-pressed={vote === -1} title="Less like this" className="rounded px-1.5 py-0.5 text-xs disabled:opacity-40" style={{ color: vote === -1 ? 'var(--accent)' : 'var(--text-muted, #888)', background: vote === -1 ? 'var(--accent-bg, transparent)' : 'transparent' }}>↓</button>
    </div>
  );
}
