// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../api/backend', () => ({ addServer: vi.fn(), updateServer: vi.fn() }));
vi.mock('../../../api/auth', () => ({ login: vi.fn() }));

import AddServerDialog from './AddServerDialog';

afterEach(cleanup);

// Un clic sur le fond fermait la fenêtre et perdait l'adresse, l'identifiant
// et le mot de passe saisis — « Ajouter un flux » ne le faisait pas. On ferme
// par Annuler ou Échap, jamais par un clic à côté.
describe('AddServerDialog', () => {
  it('ne se ferme pas sur un clic à côté de la fenêtre', () => {
    const onClose = vi.fn();
    render(<AddServerDialog onClose={onClose} onAdded={() => {}} />);
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
