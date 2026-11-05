// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import LabelsTab from './LabelsTab';
import { useFeedStore } from '../../stores/feedStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { label?: string; value?: string; name?: string }) =>
      k === 'app.labelValue' ? `${o?.label} : ${o?.value}` : o?.name ? `${k}:${o.name}` : k,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const L = (n: string) => `user/-/label/${n}`;
const renameLabel = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ toasts: [], labelSortAlpha: true });
  useThemeStore.setState({ labelColors: {} });
  useFeedStore.setState({
    labels: [{ id: L('Tech/Astuces'), type: 'tag' }, { id: L('Tech/Tuto'), type: 'tag' }, { id: L('Guides'), type: 'tag' }] as Tag[],
    subscriptions: [],
    categoryIds: [],
    folderIds: [],
    renameLabel,
  } as never);
});
afterEach(cleanup);

// Le champ d'une étiquette enfant montre sa feuille (« Astuces » pour
// « Tech/Astuces ») : renvoyer la feuille seule la sortait de son groupe.
describe('Préférences › Étiquettes — renommer une étiquette enfant', () => {
  it('le nouveau nom garde le parent : Tech/Astuces → Tech/Guides', async () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.rename : Astuces' }));
    const field = screen.getByDisplayValue('Astuces');
    fireEvent.change(field, { target: { value: 'Guides' } });
    // « Guides » existe à la racine, mais « Tech/Guides » est libre.
    expect(field.getAttribute('aria-invalid')).toBeNull();
    fireEvent.submit(field.closest('form')!);
    await vi.waitFor(() => expect(renameLabel).toHaveBeenCalledWith(L('Tech/Astuces'), 'Tech/Guides'));
  });

  it('une feuille déjà prise dans le même groupe est refusée', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.rename : Astuces' }));
    const field = screen.getByDisplayValue('Astuces');
    fireEvent.change(field, { target: { value: 'Tuto' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.submit(field.closest('form')!);
    expect(renameLabel).not.toHaveBeenCalled();
  });
});
