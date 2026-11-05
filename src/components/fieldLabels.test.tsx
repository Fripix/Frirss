// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../api/backend', () => ({ addServer: vi.fn(), updateServer: vi.fn(), createBackup: vi.fn(), previewRestore: vi.fn(), applyRestore: vi.fn() }));
vi.mock('../api/auth', () => ({ login: vi.fn() }));

import AddFeedDialog from './Sidebar/AddFeedDialog';
import AddServerDialog from './Preferences/servers/AddServerDialog';
import BackupExport from './backup/BackupExport';
import RestoreFlow from './backup/RestoreFlow';

afterEach(cleanup);

// Ces libellés étaient posés à côté de leur champ sans lui être reliés : un
// lecteur d'écran annonçait « champ de saisie » sans dire lequel, et un clic
// sur le libellé ne plaçait pas le curseur dans le champ.
describe('libellés reliés à leur champ', () => {
  it('Ajouter un flux', () => {
    render(<AddFeedDialog onClose={() => {}} />);
    expect(screen.getByLabelText(/addFeed\.urlLabel/).tagName).toBe('INPUT');
    expect(screen.getByLabelText('addFeed.nameLabel').tagName).toBe('INPUT');
    const select = screen.getByLabelText('addFeed.categoryLabel') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: '__new__' } });
    expect(screen.getByLabelText('addFeed.newCategory').tagName).toBe('INPUT');
  });

  it('Ajouter un serveur', () => {
    render(<AddServerDialog onClose={() => {}} onAdded={() => {}} />);
    for (const k of ['login.serverUrl', 'login.freshrssUser', 'login.freshrssPassword', 'login.serverName', 'preferences.refresh.tokenLabel']) {
      expect(screen.getByLabelText(k).tagName, k).toBe('INPUT');
    }
  });

  // Le libellé « Passphrase » de la restauration (Préférences et premier
  // démarrage) était seul à rester détaché de son champ.
  it('Restauration d’une sauvegarde', () => {
    for (const setup of [false, true]) {
      render(<RestoreFlow setup={setup} onRestored={() => {}} />);
      expect(screen.getByLabelText('backup.passphrase').tagName).toBe('INPUT');
      cleanup();
    }
  });

  it('Sauvegarde chiffrée', () => {
    render(<BackupExport />);
    expect(screen.getByLabelText('backup.passphrase').tagName).toBe('INPUT');
    expect(screen.getByLabelText('backup.passphraseConfirm').tagName).toBe('INPUT');
  });
});
