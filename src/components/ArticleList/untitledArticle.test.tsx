// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import ArticleCard from './ArticleCard';
import ArticleContextMenu from './ArticleContextMenu';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

/*
 * Un article sans titre garde `title: ''` dans le store : le libellé traduit
 * se pose au rendu, partout où le titre s'affiche (`articleTitle`).
 */
const untitled = {
  id: 'a1', title: '', summary: 'Un résumé', source: 'Src', sourceId: 'feed/1',
  content: '<p>corps</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

const noop = () => {};

describe('article sans titre — libellé posé au rendu', () => {
  it.each(['preview', 'standard', 'compact'] as const)('ligne (%s)', (viewMode) => {
    const { container } = render(
      <ArticleRow article={untitled} viewMode={viewMode} showSource rowActions={DEFAULT_ROW_ACTIONS} active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />,
    );
    expect(container.querySelector('.article-title')?.textContent).toBe('articleList.untitled');
  });

  it('carte : titre et nom accessible', () => {
    const { container } = render(
      <ArticleCard article={untitled} showSource rowActions={DEFAULT_ROW_ACTIONS} active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />,
    );
    expect(container.querySelector('.article-card__title')?.textContent).toBe('articleList.untitled');
    expect(container.querySelector('[aria-label="articleList.untitled"]')).not.toBeNull();
  });

  it('feuille du menu d’article : son titre', () => {
    render(
      <ArticleContextMenu article={untitled} isReadLater={false} canMarkRange x={0} y={0} sheet
        onClose={noop} onOpenSource={noop} onToggleRead={noop} onToggleStar={noop}
        onToggleReadLater={noop} onCopyLink={noop} onMarkRange={noop} />,
    );
    expect(document.querySelector('.bottom-sheet__title')?.textContent).toBe('articleList.untitled');
  });
});
