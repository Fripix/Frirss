// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import ArticleContextMenu from './ArticleContextMenu';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

const article = {
  id: 'a1', title: 'Hello World', url: 'https://example.com/1', read: false, starred: false, labels: [],
} as unknown as Article;

function setup(over: { article?: Partial<Article>; isReadLater?: boolean; sheet?: boolean } = {}) {
  const handlers = {
    onClose: vi.fn(), onOpenSource: vi.fn(), onToggleRead: vi.fn(),
    onToggleStar: vi.fn(), onToggleReadLater: vi.fn(), onCopyLink: vi.fn(),
  };
  render(
    <ArticleContextMenu
      article={{ ...article, ...over.article }}
      isReadLater={over.isReadLater ?? false}
      x={30}
      y={40}
      sheet={over.sheet ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ArticleContextMenu', () => {
  it('shows the five entries in order', () => {
    setup();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'articleRow.openSource', 'articleRow.markRead', 'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.copyLink',
    ]);
  });

  it('gives every floating entry a 44pt touch target on coarse pointers', () => {
    // Sur pointeur grossier, `.context-menu-item` porte `min-height: 44px`
    // (src/styles/index.css) — les boutons du menu flottant en ont besoin,
    // contrairement aux rangées de la feuille du bas (`.sheet-row`, déjà 48px).
    setup();
    for (const button of screen.getAllByRole('button')) {
      expect(button.className.split(' ')).toContain('context-menu-item');
    }
  });

  it('runs each entry through its own handler, then closes', () => {
    const cases: [string, 'onOpenSource' | 'onToggleRead' | 'onToggleStar' | 'onToggleReadLater' | 'onCopyLink'][] = [
      ['articleRow.openSource', 'onOpenSource'],
      ['articleRow.markRead', 'onToggleRead'],
      ['articleRow.addStar', 'onToggleStar'],
      ['articleRow.addReadLater', 'onToggleReadLater'],
      ['articleRow.copyLink', 'onCopyLink'],
    ];
    for (const [label, handler] of cases) {
      const h = setup();
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(h[handler]).toHaveBeenCalledTimes(1);
      expect(h.onClose).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('labels follow the article state', () => {
    setup({ article: { read: true, starred: true }, isReadLater: true });
    expect(screen.getByRole('button', { name: 'articleRow.markUnread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'articleRow.removeStar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'articleRow.removeReadLater' })).toBeTruthy();
  });

  it('has no open-at-source nor copy-link without a URL', () => {
    setup({ article: { url: '' } });
    expect(screen.queryByRole('button', { name: 'articleRow.openSource' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'articleRow.copyLink' })).toBeNull();
  });

  it('closes on Escape', () => {
    const h = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a pointerdown outside, not inside', () => {
    const h = setup();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'articleRow.markRead' }));
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('on a phone, renders a bottom sheet titled with the article', () => {
    const h = setup({ sheet: true });
    expect(screen.getByRole('dialog', { name: 'Hello World' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'articleRow.addStar' }));
    expect(h.onToggleStar).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  describe('clavier', () => {
    it('donne le focus à la première entrée du menu flottant, à l’ouverture', () => {
      setup();
      const buttons = screen.getAllByRole('button');
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('rend le focus à l’élément qui l’avait avant l’ouverture, à la fermeture', () => {
      function Wrapper({ show }: { show: boolean }) {
        return (
          <div>
            <button type="button">outside</button>
            {show && (
              <ArticleContextMenu
                article={article}
                isReadLater={false}
                x={30}
                y={40}
                sheet={false}
                onClose={() => {}}
                onOpenSource={() => {}}
                onToggleRead={() => {}}
                onToggleStar={() => {}}
                onToggleReadLater={() => {}}
                onCopyLink={() => {}}
              />
            )}
          </div>
        );
      }
      const { rerender } = render(<Wrapper show={false} />);
      const outside = screen.getByRole('button', { name: 'outside' });
      outside.focus();
      expect(document.activeElement).toBe(outside);

      rerender(<Wrapper show />);
      expect(document.activeElement).not.toBe(outside);

      rerender(<Wrapper show={false} />);
      expect(document.activeElement).toBe(outside);
    });

    it('ne déplace pas le focus en feuille du bas', () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      setup({ sheet: true });
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });
});
