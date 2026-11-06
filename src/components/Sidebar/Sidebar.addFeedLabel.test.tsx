// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const bp = vi.hoisted(() => ({ value: 'mobile' as 'mobile' | 'tablet' | 'desktop' }));

vi.hoisted(() => {
  // Constantes injectées par Vite au build.
  Object.assign(globalThis, { __APP_DEV_VERSION__: '', __APP_VERSION__: '0.0.0' });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) });
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(), markAsUnread: vi.fn(), markAsStarred: vi.fn(),
  removeStarred: vi.fn(), markAllAsRead: vi.fn(), fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(),
  editFeed: vi.fn(), unsubscribeFeed: vi.fn(), getTagList: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), getStreamItemCount: vi.fn(async () => 0),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import Sidebar from './Sidebar';

afterEach(cleanup);

// Dans le tiroir mobile, « Ajouter un flux » était écrit juste après l'icône
// œil (« masquer les flux lus »), et son « + » tout au bout de la ligne : le
// libellé semblait nommer l'œil (idée du troisième round).
describe('Sidebar — « Ajouter un flux » dans le tiroir mobile', () => {
  it('le libellé est dans le bouton « + », contre l’icône, et nulle part ailleurs', () => {
    bp.value = 'mobile';
    render(<Sidebar />);
    const button = screen.getByRole('button', { name: 'sidebar.addFeed' });
    expect(button.textContent).toBe('sidebar.addFeed');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(screen.getAllByText('sidebar.addFeed')).toHaveLength(1);
  });
  it('sur ordinateur, le « + » reste une icône seule', () => {
    bp.value = 'desktop';
    render(<Sidebar />);
    const button = screen.getByRole('button', { name: 'sidebar.addFeed' });
    expect(button.textContent).toBe('');
    expect(screen.queryAllByText('sidebar.addFeed')).toHaveLength(0);
  });
});
