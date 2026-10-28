// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import AppearanceTab from './AppearanceTab';
import { SHIPPED_THEMES, useThemeStore } from '../../stores/themeStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { n?: number }) => (o?.n !== undefined ? `${k}:${o.n}` : k) }),
}));

afterEach(cleanup);

describe('Préférences › Apparence › Thème — aide des préréglages', () => {
  // L'aide écrivait « 36 couleurs » en dur dans les dix langues, restée
  // fausse quand le panneau IA en a ajouté deux. Le nombre vient du thème.
  it('annonce le nombre réel de couleurs d’un thème', () => {
    render(<AppearanceTab onHighlight={() => {}} />);
    const n = Object.keys(SHIPPED_THEMES[0].colors).length;
    expect(n).toBe(38);
    expect(screen.getByText(`preferences.themes.presetsHint:${n}`)).toBeTruthy();
  });
});

// Supprimer un thème enregistré se faisait d'un seul clic sur « Suppr. ».
describe('Préférences › Apparence › Thème — supprimer un thème enregistré', () => {
  it('demande confirmation, et un double-clic ne valide pas', async () => {
    const deleteSavedTheme = vi.fn();
    const mine = { ...SHIPPED_THEMES[0], name: 'Mon thème' };
    useThemeStore.setState({ savedThemes: [...SHIPPED_THEMES, mine], deleteSavedTheme });
    render(<AppearanceTab onHighlight={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.themes.deleteShort' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'preferences.themes.delete' }));
    expect(deleteSavedTheme).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    fireEvent.click(within(dialog).getByRole('button', { name: 'preferences.themes.delete' }));
    expect(deleteSavedTheme).toHaveBeenCalledWith('Mon thème');
  });
});
