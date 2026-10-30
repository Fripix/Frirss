// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../api/auth', () => ({ login: vi.fn() }));
vi.mock('../../../api/backend', () => ({ updateServer: vi.fn() }));
vi.mock('../../../api/feeds', () => ({ clearWriteToken: vi.fn() }));

import ServerCredentialsForm from './ServerCredentialsForm';
import { login } from '../../../api/auth';
import { updateServer } from '../../../api/backend';
import { clearWriteToken } from '../../../api/feeds';
import { useFeedStore } from '../../../stores/feedStore';

const server = { id: 4, name: 'S', url: 'https://rss.example.com', freshrss_user: 'alice' };

beforeEach(() => {
  vi.mocked(login).mockResolvedValue('tok-new');
  vi.mocked(updateServer).mockResolvedValue({} as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function submit(user: string | null, password: string) {
  if (user !== null) fireEvent.change(screen.getByLabelText('login.freshrssUser'), { target: { value: user } });
  fireEvent.change(screen.getByLabelText('login.freshrssPassword'), { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'servers.credentialsSave' })); });
}

/*
 * Un serveur dont le mot de passe d'API a changé côté FreshRSS ne se
 * corrigeait qu'en le supprimant puis en le rajoutant : nouvel identifiant,
 * donc nouvelle portée, et les actions hors ligne en attente ne repartaient
 * plus. Les identifiants se ressaisissent sur le serveur lui-même.
 */
describe('ServerCredentialsForm', () => {
  it('éprouve les identifiants auprès de FreshRSS puis les enregistre sur le même serveur', async () => {
    const onSaved = vi.fn();
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={onSaved} onClose={() => {}} />);
    expect((screen.getByLabelText('login.freshrssUser') as HTMLInputElement).value).toBe('alice');
    await submit(null, 'secret');
    expect(login).toHaveBeenCalledWith('https://rss.example.com', 'alice', 'secret');
    expect(updateServer).toHaveBeenCalledWith(4, { freshrssUser: 'alice', freshrssToken: 'tok-new' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('servers.credentialsSaved');
  });

  it('serveur actif : oublie le jeton d’écriture, lève le refus et relance la file', async () => {
    const replayQueue = vi.fn(async () => {});
    useFeedStore.setState({ replayRefusedByServer: true, replayQueue } as never);
    render(<ServerCredentialsForm server={server} isActive onSaved={() => {}} onClose={() => {}} />);
    await submit(null, 'secret');
    expect(clearWriteToken).toHaveBeenCalled();
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
    expect(replayQueue).toHaveBeenCalledTimes(1);
  });

  it('un refus de FreshRSS est dit, et rien n’est enregistré', async () => {
    vi.mocked(login).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: 'Unauthorized!' } }));
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    await submit('bob', 'faux');
    expect(updateServer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('login.errorServerCredentials');
  });

  it('Échap ferme le formulaire', () => {
    const onClose = vi.fn();
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('login.freshrssPassword'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
