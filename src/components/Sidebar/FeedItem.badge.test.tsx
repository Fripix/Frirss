// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
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

// Le survol était suivi en JavaScript et REMPLAÇAIT le compte par « ⋯ ». Un
// mouseleave perdu le faisait disparaître pour de bon (vu en direct : 111 non
// lus masqués, la souris ailleurs), et au doigt une tape émet mouseenter sans
// jamais de mouseleave : sur tablette, le flux touché perdait son compte.
describe('compteur de non-lus d’une ligne de flux — survol', () => {
  const noop = () => {};
  const row = () => render(
    <FeedItem feed={{ id: 'feed/1', title: 'Developpez.com' } as Subscription} isSelected={false} unreadCount={111}
      showFavicons={false} organizeMode={false} onSelect={noop} onContextMenu={noop} onOpenMenu={noop}
      onDragStart={noop} onDragOver={noop} onDrop={noop} />,
  );

  it('garde le compte dans la ligne quand la souris y entre et que la sortie se perd', () => {
    const c = row();
    fireEvent.mouseEnter(c.getByRole('button'));
    expect(c.container.querySelector('.unread-badge')).not.toBeNull();
  });

  it('n’échange compte et « ⋯ » qu’au vrai survol d’un pointeur qui survole', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');
    expect(css).toMatch(/@media \(hover: hover\)\s*\{[^}]*\.sidebar-feed-item:hover \.sidebar-feed-edit-btn/);
  });
});
