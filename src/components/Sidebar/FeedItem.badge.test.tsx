// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FeedItem } from './Sidebar';
import type { Subscription } from '../../types';

// `t` rend la clé et le nombre : on vérifie que le badge passe par le pluriel
// i18next (`sidebar.unreadCount`) et non par le chiffre brut.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ feedErrors: {}, refreshResult: null }),
    { getState: () => ({ prefetchView: () => {} }) },
  ),
}));

afterEach(cleanup);

describe('compteur de non-lus d\'une ligne de flux', () => {
  it('se lit « nom, N non lus » : le badge porte son propre libellé', () => {
    // Sans libellé, le lecteur d'écran collait le chiffre au nom du flux
    // (« Developpez.com70 ») : le texte du badge suit le titre sans séparateur.
    const noop = () => {};
    const c = render(
      <FeedItem
        feed={{ id: 'feed/1', title: 'Developpez.com' } as Subscription}
        isSelected={false}
        unreadCount={70}
        showFavicons={false}
        organizeMode={false}
        onSelect={noop}
        onContextMenu={noop}
        onOpenMenu={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
      />,
    );
    const badge = c.container.querySelector('.unread-badge');
    expect(badge?.getAttribute('aria-label')).toBe('sidebar.unreadCount:70');
    expect(c.getByRole('button', { name: /Developpez\.com.*sidebar\.unreadCount:70/ })).toBeTruthy();
  });
});
