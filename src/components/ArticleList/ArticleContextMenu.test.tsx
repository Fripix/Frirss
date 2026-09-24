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

function setup(over: {
  article?: Partial<Article>;
  isReadLater?: boolean;
  sheet?: boolean;
  canMarkRange?: boolean;
  confirmMarkAllRead?: boolean;
  handlers?: { onMarkRange?: (direction: 'above' | 'below') => void };
} = {}) {
  const handlers = {
    onClose: vi.fn(), onOpenSource: vi.fn(), onToggleRead: vi.fn(),
    onToggleStar: vi.fn(), onToggleReadLater: vi.fn(), onCopyLink: vi.fn(),
    onMarkRange: vi.fn(),
    ...over.handlers,
  };
  render(
    <ArticleContextMenu
      article={{ ...article, ...over.article }}
      isReadLater={over.isReadLater ?? false}
      canMarkRange={over.canMarkRange ?? true}
      confirmMarkAllRead={over.confirmMarkAllRead ?? false}
      x={30}
      y={40}
      sheet={over.sheet ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ArticleContextMenu', () => {
  it('shows the seven entries in order', () => {
    setup();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'articleRow.openSource', 'articleRow.markRead', 'articleRow.markBelowRead', 'articleRow.markAboveRead',
      'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.copyLink',
    ]);
  });

  it('appelle onMarkRange avec « below » depuis l’entrée « en dessous »', () => {
    const onMarkRange = vi.fn();
    setup({ handlers: { onMarkRange } });

    fireEvent.click(screen.getByText('articleRow.markBelowRead'));
    expect(onMarkRange).toHaveBeenCalledTimes(1);
    expect(onMarkRange).toHaveBeenCalledWith('below');
  });

  it('appelle onMarkRange avec « above » depuis l’entrée « au-dessus »', () => {
    const onMarkRange = vi.fn();
    setup({ handlers: { onMarkRange } });

    fireEvent.click(screen.getByText('articleRow.markAboveRead'));
    expect(onMarkRange).toHaveBeenCalledTimes(1);
    expect(onMarkRange).toHaveBeenCalledWith('above');
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

  // Décision du propriétaire : en Favoris et À lire plus tard, l'action du
  // store se refuse déjà — mais une entrée qui ne fait rien est plus
  // déroutante qu'une entrée absente.
  it('n’a ni « en dessous » ni « au-dessus » quand canMarkRange est faux — Favoris / À lire plus tard', () => {
    setup({ canMarkRange: false });
    expect(screen.queryByRole('button', { name: 'articleRow.markBelowRead' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'articleRow.markAboveRead' })).toBeNull();
  });

  describe('confirmation des marquages de plage', () => {
    it('sans le réglage de confirmation, un seul clic agit et ferme, comme avant', () => {
      const onMarkRange = vi.fn();
      const h = setup({ confirmMarkAllRead: false, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      expect(onMarkRange).toHaveBeenCalledTimes(1);
      expect(onMarkRange).toHaveBeenCalledWith('below');
      expect(h.onClose).toHaveBeenCalledTimes(1);
    });

    it('avec le réglage actif, le premier clic demande confirmation sans agir ni fermer', () => {
      const onMarkRange = vi.fn();
      const h = setup({ confirmMarkAllRead: true, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      expect(onMarkRange).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'articleList.confirm' })).toBeTruthy();
    });

    it('avec le réglage actif, le second clic sur la même entrée agit et ferme', () => {
      const onMarkRange = vi.fn();
      const h = setup({ confirmMarkAllRead: true, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      fireEvent.click(screen.getByRole('button', { name: 'articleList.confirm' }));
      expect(onMarkRange).toHaveBeenCalledTimes(1);
      expect(onMarkRange).toHaveBeenCalledWith('below');
      expect(h.onClose).toHaveBeenCalledTimes(1);
    });

    it('la demande de confirmation ne porte que sur l’entrée cliquée — l’autre garde son libellé', () => {
      setup({ confirmMarkAllRead: true });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      expect(screen.getByRole('button', { name: 'articleRow.markAboveRead' })).toBeTruthy();
    });

    it('cliquer « au-dessus » pendant la confirmation de « en dessous » redemande, pour « au-dessus »', () => {
      const onMarkRange = vi.fn();
      const h = setup({ confirmMarkAllRead: true, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      fireEvent.click(screen.getByText('articleRow.markAboveRead'));
      expect(onMarkRange).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
    });

    it('fermer le menu annule la demande — un nouvel appui long repart de zéro', () => {
      const onMarkRange = vi.fn();
      setup({ confirmMarkAllRead: true, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markBelowRead'));
      cleanup();
      const onMarkRange2 = vi.fn();
      setup({ confirmMarkAllRead: true, handlers: { onMarkRange: onMarkRange2 } });
      expect(screen.queryByRole('button', { name: 'articleList.confirm' })).toBeNull();
    });

    it('marche aussi en feuille du bas', () => {
      const onMarkRange = vi.fn();
      const h = setup({ sheet: true, confirmMarkAllRead: true, handlers: { onMarkRange } });
      fireEvent.click(screen.getByText('articleRow.markAboveRead'));
      expect(onMarkRange).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'articleList.confirm' }));
      expect(onMarkRange).toHaveBeenCalledWith('above');
      expect(h.onClose).toHaveBeenCalledTimes(1);
    });
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
                canMarkRange
                confirmMarkAllRead={false}
                x={30}
                y={40}
                sheet={false}
                onClose={() => {}}
                onOpenSource={() => {}}
                onToggleRead={() => {}}
                onMarkRange={() => {}}
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
