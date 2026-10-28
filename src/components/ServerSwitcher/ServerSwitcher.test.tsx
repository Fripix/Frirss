// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../api/backend', () => ({ getServers: () => new Promise(() => {}) }));
vi.mock('../../lib/switchServer', () => ({ switchToServer: vi.fn() }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

import ServerSwitcher from './ServerSwitcher';
import { useAuthStore } from '../../stores/authStore';

afterEach(cleanup);

// Le menu « Gérer » est `position: fixed` SANS portail : il coupe les
// raccourcis comme les autres surfaces flottantes, et se ferme à Échap.
describe('ServerSwitcher — menu contextuel', () => {
  function open() {
    useAuthStore.setState({
      servers: [{ id: 1, name: 'Home', url: 'https://example.com', freshrss_user: 'u' }],
      activeServerId: 1, serverUrl: 'https://example.com',
    } as never);
    render(<ServerSwitcher />);
    fireEvent.contextMenu(screen.getByText('Home'));
  }

  it('coupe les raccourcis tant qu\'il est ouvert', () => {
    open();
    expect(screen.getByText('servers.manage')).toBeTruthy();
    expect(document.querySelector('[data-floating-surface]')).not.toBeNull();
  });

  it('se ferme à Échap', () => {
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('servers.manage')).toBeNull();
  });
});
