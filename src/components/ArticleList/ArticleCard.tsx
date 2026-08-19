import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Article } from '../../types';
import { READ_LATER_LABEL } from '../../stores/feedStore';
import { extractImageFromContent, sourceInitial } from '../../lib/articleThumbnail';
import { timeAgo } from '../../lib/timeAgo';
import { extractYouTubeId } from '../../lib/youtube';
import { StarButton, ReadLaterButton, MarkReadButton } from './ArticleActions';

interface ArticleCardProps {
  article: Article;
  showSource: boolean;
  active: boolean;
  onSelect: () => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
}

export default function ArticleCard({
  article, showSource, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater,
}: ArticleCardProps) {
  const { t } = useTranslation();
  const isReadLater = article.labels?.includes(READ_LATER_LABEL);
  const thumbnail = extractImageFromContent(article.content);
  const isVideo = !!extractYouTubeId(article.url || '');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={article.title}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={`article-card ${active ? 'article-card--active' : ''} ${article.read ? 'article-card--read' : ''}`}
    >
      <div className="article-card__thumb">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            onError={(e) => {
              const wrap = e.currentTarget.parentElement;
              if (wrap) wrap.classList.add('article-card__thumb--failed');
            }}
          />
        ) : (
          <div className="article-card__fallback">
            <span>{sourceInitial(article.source)}</span>
          </div>
        )}
        {!article.read && <span className="article-card__unread" aria-hidden="true" />}
        {isVideo && (
          <span className="article-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        )}
      </div>

      <div className="article-card__body">
        <div className="article-card__meta">
          {showSource && <span className="article-card__source">{article.source}</span>}
          <span className="article-card__time">{timeAgo(article.published, t)}</span>
        </div>
        <h3 className="article-card__title">{article.title}</h3>
        <p className="article-card__summary">{article.summary}</p>
      </div>

      <div className="article-card__actions" onClick={(e) => e.stopPropagation()}>
        <StarButton starred={article.starred} onClick={onToggleStar} />
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
      </div>
    </div>
  );
}
