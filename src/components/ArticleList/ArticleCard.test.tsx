// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import ArticleCard from './ArticleCard';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

const base: Article = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://x/1', published: Date.now(), read: false,
  starred: false, labels: [],
} as unknown as Article;

const noop = () => {};

describe('ArticleCard', () => {
  it('renders the title and source', () => {
    const { getByText } = render(
      <ArticleCard article={base} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} />
    );
    expect(getByText('Hello World')).toBeTruthy();
    expect(getByText('The Verge')).toBeTruthy();
  });

  it('shows the source-initial fallback when there is no image', () => {
    const { container } = render(
      <ArticleCard article={{ ...base, content: '<p>no image</p>' }} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} />
    );
    expect(container.querySelector('.article-card__fallback')).toBeTruthy();
  });

  it('renders a thumbnail when the content has an image', () => {
    const { container } = render(
      <ArticleCard article={{ ...base, content: '<img src="https://x/a.jpg">' }} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} />
    );
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.querySelector('.article-card__fallback')).toBeNull();
  });

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <ArticleCard article={base} showSource active={false}
        onSelect={onSelect} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} />
    );
    fireEvent.click(getByRole('button', { name: /Hello World/i }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
