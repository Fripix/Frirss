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

async function submit(password: string) {
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
    await submit('secret');
    expect(login).toHaveBeenCalledWith('https://rss.example.com', 'alice', 'secret');
    expect(updateServer).toHaveBeenCalledWith(4, { freshrssToken: 'tok-new' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('servers.credentialsSaved');
  });

  it('serveur actif : oublie le jeton d’écriture, lève le refus et relance la file', async () => {
    const replayQueue = vi.fn(async () => {});
    useFeedStore.setState({ replayRefusedByServer: true, replayQueue } as never);
    render(<ServerCredentialsForm server={server} isActive onSaved={() => {}} onClose={() => {}} />);
    await submit('secret');
    expect(clearWriteToken).toHaveBeenCalled();
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
    expect(replayQueue).toHaveBeenCalled();
  });

  it('un refus de FreshRSS est dit, et rien n’est enregistré', async () => {
    vi.mocked(login).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: 'Unauthorized!' } }));
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    await submit('faux');
    expect(updateServer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('login.errorServerCredentials');
  });

  // Un autre utilisateur sur le même serveur garderait la même portée hors
  // ligne : la file, les listes et le cache d'alice seraient servis à bob.
  // Un autre utilisateur, c'est un autre serveur à ajouter.
  it('ne laisse pas changer d’utilisateur FreshRSS', () => {
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('login.freshrssUser') as HTMLInputElement).readOnly).toBe(true);
  });

  // Un rejeu encore en vol sous l'ancien jeton reposait le bandeau de refus
  // après l'enregistrement : il est attendu, puis la file repart.
  it('attend le rejeu en vol avant de lever le refus et de relancer', async () => {
    let finishOld: () => void = () => {};
    const replayQueue = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { finishOld = () => { useFeedStore.setState({ replayRefusedByServer: true } as never); r(); }; }))
      .mockImplementation(async () => {});
    useFeedStore.setState({ replayRefusedByServer: true, replayQueue } as never);
    render(<ServerCredentialsForm server={server} isActive onSaved={() => {}} onClose={() => {}} />);
    await submit('secret');
    await act(async () => { finishOld(); await Promise.resolve(); await Promise.resolve(); });
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
    expect(replayQueue).toHaveBeenCalledTimes(2);
  });

  // FreshRSS a accepté ; c'est l'enregistrement chez FriRSS qui a échoué. Le
  // message de connexion (« Échec de la connexion au serveur FreshRSS »)
  // envoyait chercher la panne au mauvais endroit.
  it('un échec d’enregistrement n’est pas attribué à FreshRSS', async () => {
    vi.mocked(updateServer).mockRejectedValue(Object.assign(new Error('500'), { response: { status: 500 } }));
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    await submit('secret');
    expect(screen.getByRole('alert').textContent).toBe('servers.errorGeneric');
  });

  // Pendant l'envoi, Annuler est désactivé : Échap fermait pourtant le
  // formulaire, et la requête aboutissait sans rien afficher.
  it('Échap ne ferme pas le formulaire pendant l’envoi', async () => {
    let resolve: (v: string) => void = () => {};
    vi.mocked(login).mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const onClose = vi.fn();
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={onClose} />);
    await submit('secret');
    fireEvent.keyDown(screen.getByLabelText('login.freshrssPassword'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { resolve('tok'); });
  });

  // Le bouton se désactive sous le focus, qui tombait sur <body> : l'Échap du
  // formulaire ne le voyait plus, et les Préférences se fermaient sur l'envoi.
  it('le focus reste dans le formulaire quand on envoie par le bouton', async () => {
    let finish!: (v: string) => void;
    vi.mocked(login).mockReturnValue(new Promise((r) => { finish = r; }));
    const { container } = render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('login.freshrssPassword'), { target: { value: 'secret' } });
    const save = screen.getByRole('button', { name: 'servers.credentialsSave' });
    save.focus();
    await act(async () => { fireEvent.click(save); });
    expect(document.activeElement).toBe(container.querySelector('form'));
    await act(async () => { finish('tok'); });
  });

  it('par Entrée dans le champ, le focus ne bouge pas', async () => {
    let finish!: (v: string) => void;
    vi.mocked(login).mockReturnValue(new Promise((r) => { finish = r; }));
    const { container } = render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={() => {}} />);
    const field = screen.getByLabelText('login.freshrssPassword');
    fireEvent.change(field, { target: { value: 'secret' } });
    field.focus();
    await act(async () => { fireEvent.submit(container.querySelector('form')!); });
    expect(document.activeElement).toBe(field);
    await act(async () => { finish('tok'); });
  });

  it('Échap ferme le formulaire', () => {
    const onClose = vi.fn();
    render(<ServerCredentialsForm server={server} isActive={false} onSaved={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('login.freshrssPassword'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
