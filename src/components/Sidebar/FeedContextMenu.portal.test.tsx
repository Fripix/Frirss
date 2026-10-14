// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { FeedContextMenu } from './Sidebar';
import type { Subscription } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ feedErrors: {}, refreshResult: null, selectedFeed: null }),
    { getState: () => ({ selectedFeed: null, loadArticles: () => {} }) },
  ),
  READ_LATER_LABEL: 'user/-/label/Read later',
  getSampleArticleUrl: () => undefined,
}));

const feed = { id: 'feed/1', title: 'The Register' } as Subscription;
const yes = async () => true;

afterEach(cleanup);

describe('FeedContextMenu — un menu flottant hors du tiroir', () => {
  it("est rendu sous <body>, pas dans l'ancêtre qui le rognerait", () => {
    // Sur mobile le tiroir est `fixed`, transformé (glissement) et
    // `overflow: hidden` : un `position: fixed` rendu dedans s'y ancre et s'y
    // rogne. Vu le 14.10 sur iPhone (320 px) : le tiroir fait 272 px, le menu
    // recalé sur la fenêtre allait jusqu'à 312, et les sélecteurs des lignes
    // « Article complet auto » et « Ordre de ce flux » étaient coupés.
    const { container } = render(
      <div data-testid="drawer" style={{ transform: 'translateX(0)', overflow: 'hidden', width: 272 }}>
        <FeedContextMenu feed={feed} x={272} y={40} onRename={yes} onDelete={yes} onClose={() => {}} />
      </div>,
    );
    const menu = screen.getByText('sidebar.feedOrderThisFeed').closest('[style*="position: fixed"]');
    expect(menu).not.toBeNull();
    expect(container.querySelector('[data-testid="drawer"]')!.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });
});
