// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../api/backend', () => ({ addServer: vi.fn(), updateServer: vi.fn() }));
vi.mock('../api/auth', () => ({ login: vi.fn(() => Promise.reject(new Error('refusé'))) }));

import AddFeedDialog from './Sidebar/AddFeedDialog';
import AddServerDialog from './Preferences/servers/AddServerDialog';
import { useFeedStore } from '../stores/feedStore';

afterEach(cleanup);

// L'erreur s'affichait dans un simple <p> : un lecteur d'écran n'en disait
// rien, et l'utilisateur au clavier restait devant un bouton qui « ne fait
// rien ».
describe('erreurs des boîtes d’ajout annoncées', () => {
  it('Ajouter un flux : l’échec est une alerte', async () => {
    useFeedStore.setState({ addFeed: vi.fn(async () => false) });
    render(<AddFeedDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/addFeed\.urlLabel/), { target: { value: 'https://example.com/feed' } });
    fireEvent.submit(screen.getByLabelText(/addFeed\.urlLabel/).closest('form') as HTMLFormElement);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('addFeed.error');
  });

  it('Ajouter un serveur : l’échec de connexion est une alerte', async () => {
    render(<AddServerDialog onClose={() => {}} onAdded={() => {}} />);
    fireEvent.change(screen.getByLabelText('login.serverUrl'), { target: { value: 'https://example.com' } });
    fireEvent.submit(screen.getByLabelText('login.serverUrl').closest('form') as HTMLFormElement);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
  });
});
