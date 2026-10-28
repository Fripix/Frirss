// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';
import LabelsTab from './LabelsTab';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

const inDialog = (name: string) => within(screen.getByRole('dialog')).getByRole('button', { name });
const grace = () => act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });

describe('Préférences › Étiquettes — supprimer et renommer', () => {
  let deleteLabel: ReturnType<typeof vi.fn>;
  let renameLabel: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    deleteLabel = vi.fn();
    renameLabel = vi.fn();
    useUiStore.setState({ toasts: [] });
    useFeedStore.setState({ labels: [{ id: 'user/-/label/Veille', type: 'tag' }] as Tag[], deleteLabel, renameLabel } as never);
  });

  // La confirmation se faisait en place, sur la ligne : un double-clic sur la
  // corbeille tombait sur « Supprimer », posé au même endroit.
  it('supprimer passe par la boîte de confirmation, qu’un double-clic ne valide pas', async () => {
    deleteLabel.mockResolvedValue(true);
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByTitle('preferences.labels.delete'));
    fireEvent.click(inDialog('preferences.labels.delete'));
    expect(deleteLabel).not.toHaveBeenCalled();
    await grace();
    await act(async () => { fireEvent.click(inDialog('preferences.labels.delete')); });
    expect(deleteLabel).toHaveBeenCalledWith('user/-/label/Veille');
  });

  it('une suppression refusée le dit', async () => {
    deleteLabel.mockResolvedValue(false);
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByTitle('preferences.labels.delete'));
    await grace();
    await act(async () => { fireEvent.click(inDialog('preferences.labels.delete')); });
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('preferences.labels.deleteFailed');
  });

  it('un renommage refusé le dit', async () => {
    renameLabel.mockResolvedValue(false);
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByTitle('preferences.labels.rename'));
    const field = screen.getByDisplayValue('Veille');
    fireEvent.change(field, { target: { value: 'Veille pro' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('preferences.labels.renameFailed');
  });
});
