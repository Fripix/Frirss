// @vitest-environment jsdom
//
// Repères et titres de la page (relevés par axe sur le banc, 1.9.0) :
// tablette et téléphone sans `main` ni `h1` (le seul `h1` était le nom de
// l'app dans la barre latérale, inerte dans le tiroir fermé), `main` absent
// en 2 colonnes et en grille sans article ouvert, titre `h3` de la feuille
// du bas sans titre de niveau 2 au-dessus, barre des serveurs et tiroir
// hors de tout repère.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../api/backend', () => ({ getServers: () => new Promise(() => {}) }));
vi.mock('../lib/switchServer', () => ({ switchToServer: vi.fn() }));
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'tablet' }));

import AppMain from './AppMain';
import BottomSheet from './BottomSheet';
import MobileDrawer from './MobileDrawer';
import ServerSwitcher from './ServerSwitcher/ServerSwitcher';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';

afterEach(cleanup);

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('repères et titres', () => {
  it('le contenu principal est un `main` qui porte le titre de la page (`h1`)', () => {
    useUiStore.setState({ appTitle: 'Mon lecteur' } as never);
    render(<AppMain className="x"><p>liste</p></AppMain>);
    const main = screen.getByRole('main');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Mon lecteur');
    expect(main.contains(h1)).toBe(true);
    expect(main.textContent).toContain('liste');
  });

  it('les trois formats passent par `AppMain`, sans autre `main` ni `h1`', () => {
    const app = read('App.tsx');
    expect(app.match(/<AppMain\b/g)?.length).toBe(3);
    expect(app).not.toMatch(/<main\b/);
    // Un seul `h1` d'application : le nom visible de la barre latérale n'en
    // est plus un (il manquait en tablette et au téléphone, tiroir fermé).
    expect(read('components/Sidebar/Sidebar.tsx')).not.toMatch(/<h1\b/);
  });

  it('le titre de la feuille du bas est un `h2`, comme celui d’une confirmation', () => {
    render(<BottomSheet open title="Plus" onClose={() => {}}><button>Action</button></BottomSheet>);
    expect(screen.getByRole('heading', { level: 2, name: 'Plus' })).toBeTruthy();
  });

  it('le tiroir ouvert est un repère complémentaire, comme la barre latérale du bureau', () => {
    render(<MobileDrawer open onClose={() => {}}><button>Flux</button></MobileDrawer>);
    expect(screen.getByRole('complementary').contains(screen.getByText('Flux'))).toBe(true);
  });

  it('la barre des serveurs est une navigation nommée', () => {
    useAuthStore.setState({
      servers: [{ id: 1, name: 'Home', url: 'https://example.com', freshrss_user: 'u' }],
      activeServerId: 1, serverUrl: 'https://example.com',
    } as never);
    render(<ServerSwitcher />);
    const nav = screen.getByRole('navigation', { name: 'servers.label' });
    expect(nav.contains(screen.getByText('Home'))).toBe(true);
  });
});
