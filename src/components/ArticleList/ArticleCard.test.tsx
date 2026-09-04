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
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    expect(getByText('Hello World')).toBeTruthy();
    expect(getByText('The Verge')).toBeTruthy();
  });

  it('shows the source-initial fallback when there is no image', () => {
    const { container } = render(
      <ArticleCard article={{ ...base, content: '<p>no image</p>' }} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    expect(container.querySelector('.article-card__fallback')).toBeTruthy();
  });

  it('renders a thumbnail when the content has an image', () => {
    const { container } = render(
      <ArticleCard article={{ ...base, content: '<img src="https://x/a.jpg">' }} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.querySelector('.article-card__fallback')).toBeNull();
  });

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <ArticleCard article={base} showSource active={false}
        onSelect={onSelect} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    fireEvent.click(getByRole('button', { name: /Hello World/i }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('affiche les quatre actions, dans l’ordre étoile → à lire plus tard → ouvrir à la source → ✓', () => {
    const { container } = render(
      <ArticleCard article={base} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    const actions = container.querySelector('.article-card__actions');
    // Chaque emplacement est un enfant direct du conteneur : soit le bouton
    // lui-même (ouvrir à la source, ✓), soit un `<span>` qui l'enveloppe
    // (étoile, à lire plus tard, à cause du geste d'appui long). On lit le
    // `title` du bouton qu'il porte pour retrouver l'ordre affiché.
    const kinds = Array.from(actions?.children ?? []).map((el) => {
      const button = el.matches('button') ? el : el.querySelector('button');
      return button?.getAttribute('title')?.split(' — ')[0] ?? null;
    });
    expect(kinds).toEqual([
      'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.openSource', 'articleRow.markRead',
    ]);
  });

  it('réserve un emplacement vide pour « ouvrir à la source » quand l’article n’a pas d’URL', () => {
    const { container } = render(
      <ArticleCard article={{ ...base, url: '' }} showSource active={false}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    const actions = container.querySelector('.article-card__actions');
    // Toujours 4 emplacements : un article sans URL ne fait pas disparaître
    // le troisième, il le rend vide — sinon le ✓ se décalerait sur cette ligne.
    expect(actions?.children.length).toBe(4);
    const thirdSlot = actions?.children[2];
    expect(thirdSlot?.querySelector('button')).toBeNull();
    expect(thirdSlot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('le clic sur « ouvrir à la source » appelle onOpenSource, jamais onSelect', () => {
    const onOpenSource = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <ArticleCard article={base} showSource active={false}
        onSelect={onSelect} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={onOpenSource} />
    );
    const actions = container.querySelector('.article-card__actions');
    const slot = actions?.children[2];
    const button = slot?.matches('button') ? slot : slot?.querySelector('button');
    expect(button).toBeTruthy();
    fireEvent.click(button as Element);
    expect(onOpenSource).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
