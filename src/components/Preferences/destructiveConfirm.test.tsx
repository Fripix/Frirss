// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(() => ({}), { getState: () => ({ selectedFeed: null, loadArticles: () => {} }) }),
}));
vi.mock('../../api/backend', () => ({
  setAiUserKey: vi.fn().mockResolvedValue(undefined),
  getOidcConfig: vi.fn().mockResolvedValue({ enabled: false }),
  changePassword: vi.fn(), linkOidcAccount: vi.fn(), unlinkOidcAccount: vi.fn(), getMe: vi.fn(),
}));

import GeneralTab from './GeneralTab';
import KeysBlock from './ai/KeysBlock';
import { useUiStore } from '../../stores/uiStore';
import { useAiStore } from '../../stores/aiStore';
import { setAiUserKey } from '../../api/backend';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';

afterEach(cleanup);
const pastGrace = () => act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });

/*
 * « Toute action qui supprime se confirme » : deux restaient en un clic, la
 * réinitialisation des raccourcis (les touches personnalisées perdues) et
 * l'effacement de sa clé IA personnelle (à recoller ensuite).
 */
describe('actions qui suppriment : une confirmation', () => {
  it('réinitialiser les raccourcis', async () => {
    const reset = vi.fn();
    useUiStore.setState({ resetShortcuts: reset } as never);
    render(<GeneralTab />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.shortcuts.resetShortcuts' }));
    expect(reset).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'preferences.shortcuts.reset' });
    await pastGrace();
    await act(async () => { fireEvent.click(confirm); });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('effacer sa clé IA personnelle', async () => {
    useAiStore.setState({ config: { userKeysAllowed: true, providers: [{ id: 'p1', name: 'Mistral', hasUserKey: true }] }, load: vi.fn(async () => {}) } as never);
    render(<KeysBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'ai.keys.clear' }));
    expect(setAiUserKey).not.toHaveBeenCalled();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'ai.keys.clear' });
    await pastGrace();
    await act(async () => { fireEvent.click(confirm); });
    expect(setAiUserKey).toHaveBeenCalledWith('p1', null);
  });
});
