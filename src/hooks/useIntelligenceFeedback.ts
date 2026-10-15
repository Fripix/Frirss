import { useEffect, useState } from 'react';
import { getArticleFeedback, type ArticleFeedback } from '../api/intelligence';

/** Dispatched by the vote buttons after a vote is saved or removed. */
export const INTELLIGENCE_FEEDBACK_CHANGED = 'frirss-intelligence-feedback-changed';

/**
 * The reader's explicit votes, refetched after every vote change.
 *
 * Quick successive changes (vote, then undo) start overlapping requests whose
 * responses can arrive out of order. Only the most recent request may update
 * state; otherwise an older snapshot could overwrite a newer one and the
 * ranking would keep a vote the reader had already removed.
 */
export function useIntelligenceFeedback(): ArticleFeedback[] {
  const [feedback, setFeedback] = useState<ArticleFeedback[]>([]);
  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      getArticleFeedback()
        .then((rows) => { if (active && request === latestRequest) setFeedback(rows); })
        .catch(() => { /* feedback must never block reading */ });
    };
    refresh();
    window.addEventListener(INTELLIGENCE_FEEDBACK_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(INTELLIGENCE_FEEDBACK_CHANGED, refresh);
    };
  }, []);
  return feedback;
}
