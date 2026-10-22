// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within, screen } from '@testing-library/react';
// Le nom passé à ces clés est ce que l'on vérifie : il est rendu après la clé.
const NAMED = new Set(['ai.user.preferredDefault', 'ai.translation.uiLanguage', 'ai.routing.autoSummaryFor', 'ai.routing.autoTranslateFor', 'ai.routing.panelFor', 'ai.routing.categoryProviderFor', 'ai.routing.feedProviderFor', 'ai.admin.editTitle']);
// « Libellé — valeur » : les deux moitiés sont rendues, c'est leur assemblage qu'on vérifie.
const tMock = (k: string, o?: Record<string, unknown>) =>
  k === 'ai.routing.labelValue' ? `${String(o?.label)} — ${String(o?.value)}` : NAMED.has(k) ? `${k}:${String(o?.name)}` : k;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tMock, i18n: { language: 'fr' } }) }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(), listAiModels: vi.fn(), setAiUserKey: vi.fn(),
}));
import { getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, updateAiSettings, testAiProvider, reorderAiProviders, listAiModels, setAiUserKey, getAiConfig } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { useAiStore } from '../../stores/aiStore';
import { useFeedStore } from '../../stores/feedStore';
import type { AiConfig, AiProviderView } from '../../api/backend';
import { AI_LANGUAGES, languageName } from '../../lib/aiLanguages';
import AiTab from './AiTab';

const admin = { id: 1, username: 'root', role: 'admin' as const };
const user = { id: 2, username: 'alice', role: 'user' as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAiProviders).mockResolvedValue({ providers: [], settings: { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
  // La section recharge la configuration IA à chaque affichage ; en attente par
  // défaut, pour que la configuration posée par chaque test reste celle qu'il voit.
  vi.mocked(getAiConfig).mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);

describe('AiTab — fresh AI config on each visit', () => {
  const cfg = (usageToday: number): AiConfig =>
    ({ enabled: true, providers: [], userKeysAllowed: false, dailyCap: 50, usageToday, defaultProvider: null });
  // Une session ouverte : `load()` ignore une réponse arrivée sans jeton.
  beforeEach(() => { useAuthStore.setState({ backendUser: user, backendToken: 'tok' }); });
  afterEach(() => { useAiStore.setState({ config: null }); useAuthStore.setState({ backendToken: null }); });

  it('reloads the config each time the section becomes active, never while hidden', async () => {
    useAiStore.setState({ config: cfg(1) });
    vi.mocked(getAiConfig).mockResolvedValue(cfg(7));
    const r = render(<AiTab active={false} />);
    expect(getAiConfig).not.toHaveBeenCalled();
    r.rerender(<AiTab active />);
    expect(getAiConfig).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useAiStore.getState().config?.usageToday).toBe(7));
    r.rerender(<AiTab active={false} />);
    expect(getAiConfig).toHaveBeenCalledTimes(1);
    r.rerender(<AiTab active />);
    expect(getAiConfig).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(useAiStore.getState().config?.usageToday).toBe(7));
  });
});

describe('AiTab', () => {
  it('a plain user sees the « Résumés » block with the intro, never the providers block', async () => {
    useAuthStore.setState({ backendUser: user });
    const { findByText, queryByText, getByText } = render(<AiTab active />);
    expect(await findByText('ai.userIntro')).toBeTruthy();
    expect(getByText('ai.user.title')).toBeTruthy();
    expect(queryByText('ai.admin.title')).toBeNull();
    expect(getAiProviders).not.toHaveBeenCalled();
  });
  it('the length slider goes from 5 to 50 by 5, shows the value and writes the store', () => {
    useAuthStore.setState({ backendUser: user });
    useUiStore.setState({ aiSummaryRatio: 20 });
    const { getByLabelText, getByText } = render(<AiTab active />);
    const range = getByLabelText('ai.user.ratio') as HTMLInputElement;
    expect(range.type).toBe('range');
    expect([range.min, range.max, range.step, range.value]).toEqual(['5', '50', '5', '20']);
    const hint = getByText('ai.ratioHint');
    expect(range.getAttribute('aria-describedby')).toContain(hint.id);
    fireEvent.change(range, { target: { value: '35' } });
    expect(useUiStore.getState().aiSummaryRatio).toBe(35);
    // Le pourcentage suit la langue (« 35 % » en français, « 35% » en anglais).
    const shown = getByText('35 %');
    expect(range.getAttribute('aria-valuetext')).toBe(shown.textContent);
  });
  it('the admin sees « Fournisseurs » first, then the blocks every user has', async () => {
    useAuthStore.setState({ backendUser: admin });
    useAiStore.setState({ config: { enabled: true, providers: [], userKeysAllowed: true, dailyCap: 0, usageToday: 0, defaultProvider: null } });
    const { findByText, getAllByRole, queryByText } = render(<AiTab active />);
    await findByText('ai.admin.title');
    const titles = getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['ai.admin.title', 'ai.user.title', 'ai.translation.title', 'ai.routing.title', 'ai.keys.title']);
    expect(queryByText('ai.userIntro')).toBeNull();
    useAiStore.setState({ config: null });
  });
  it('a plain user keeps « Résumés » first and never gets « Fournisseurs »', async () => {
    useAuthStore.setState({ backendUser: user });
    useAiStore.setState({ config: { enabled: true, providers: [], userKeysAllowed: true, dailyCap: 0, usageToday: 0, defaultProvider: null } });
    const { getAllByRole } = render(<AiTab active />);
    const titles = getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['ai.user.title', 'ai.translation.title', 'ai.routing.title', 'ai.keys.title']);
    useAiStore.setState({ config: null });
  });
  it('shows the user-keys switch and the daily cap flat, with no « Avancé » fold', async () => {
    useAuthStore.setState({ backendUser: admin });
    const { findByRole, getByLabelText, queryByRole } = render(<AiTab active />);
    expect(await findByRole('switch', { name: 'ai.admin.userKeysAllowed' })).toBeTruthy();
    expect(getByLabelText('ai.admin.dailyCap')).toBeTruthy();
    expect(queryByRole('button', { name: /ai\.admin\.advanced/ })).toBeNull();
  });
  it('the admin toggles the feature on', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(updateAiSettings).mockResolvedValue();
    const { findByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('switch', { name: 'ai.admin.enable' }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ enabled: true }));
  });
  it('the admin adds a provider; the key field is cleared after saving', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(createAiProvider).mockResolvedValue({ id: 7, name: 'Ollama', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3', hasAdminKey: false, shared: false, position: 0 });
    const { findByRole, getByLabelText, findByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    fireEvent.change(getByLabelText('ai.admin.name'), { target: { value: 'Ollama' } });
    fireEvent.change(getByLabelText('ai.admin.baseUrl'), { target: { value: 'http://ollama:11434' } });
    fireEvent.change(getByLabelText('ai.admin.model'), { target: { value: 'llama3' } });
    const keyInput = getByLabelText('ai.admin.key') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    fireEvent.change(keyInput, { target: { value: 'sk-test' } });
    expect(keyInput.value).toBe('sk-test');
    fireEvent.click(await findByRole('button', { name: 'ai.admin.save' }));
    await waitFor(() => expect(createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ollama', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3', adminKey: 'sk-test' })));
    expect(await findByText('Ollama')).toBeTruthy();
    expect((getByLabelText('ai.admin.key') as HTMLInputElement).value).toBe('');
  });
  it('a new provider is not shared until the admin turns the switch on: sharing a paid key is deliberate', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(createAiProvider).mockResolvedValue({ id: 8, name: 'GPT', type: 'openai', baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: false, position: 0 });
    const { findByRole, getByLabelText, getByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    const share = getByRole('switch', { name: 'ai.admin.shared' });
    expect(share.getAttribute('aria-checked')).toBe('false');
    fireEvent.change(getByLabelText('ai.admin.name'), { target: { value: 'GPT' } });
    fireEvent.change(getByLabelText('ai.admin.baseUrl'), { target: { value: 'https://api.example.com' } });
    fireEvent.change(getByLabelText('ai.admin.model'), { target: { value: 'm' } });
    fireEvent.click(await findByRole('button', { name: 'ai.admin.save' }));
    await waitFor(() => expect(createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ shared: false })));
  });
  it('the base URL field explains to leave out the trailing /v1', async () => {
    useAuthStore.setState({ backendUser: admin });
    const { findByRole, getByLabelText, getByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    const hint = getByText('ai.admin.baseUrlHint');
    expect(getByLabelText('ai.admin.baseUrl').getAttribute('aria-describedby')).toBe(hint.id);
  });
  it('an emptied or invalid daily cap reverts on blur and saves nothing; a valid one saves', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [], settings: { enabled: true, userKeysAllowed: false, dailyCap: 20, defaultProvider: null } });
    vi.mocked(updateAiSettings).mockResolvedValue();
    const { findByLabelText } = render(<AiTab active />);
    const cap = await findByLabelText('ai.admin.dailyCap') as HTMLInputElement;
    await waitFor(() => expect(cap.value).toBe('20'));
    for (const bad of ['', '-3', '2.5']) {
      fireEvent.change(cap, { target: { value: bad } });
      fireEvent.blur(cap);
      expect(cap.value).toBe('20');
    }
    expect(updateAiSettings).not.toHaveBeenCalled();
    fireEvent.change(cap, { target: { value: '0' } });
    fireEvent.blur(cap);
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ dailyCap: 0 }));
  });
  it('the test button reports the outcome', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [{ id: 7, name: 'Ollama', type: 'openai', baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: false, position: 0 }], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const { findByRole, findByText, getByText } = render(<AiTab active />);
    const button = await findByRole('button', { name: /ai\.admin\.test/ });
    // Une cause par message : jamais « vérifiez l'URL » pour un manque de crédits.
    for (const [kind, key] of [['auth', 'ai.admin.testAuth'], ['quota', 'ai.admin.testQuota'], ['technical', 'ai.admin.testFailed'], ['refused', 'ai.admin.testFailed']] as const) {
      vi.mocked(testAiProvider).mockResolvedValueOnce({ ok: false, kind, message: `detail ${kind}` });
      fireEvent.click(button);
      expect(await findByText(key)).toBeTruthy();
      expect(getByText(`detail ${kind}`)).toBeTruthy();
    }
    vi.mocked(testAiProvider).mockRejectedValueOnce(new Error('network'));
    fireEvent.click(button);
    await waitFor(() => expect(getByText('ai.admin.testFailed')).toBeTruthy());
    vi.mocked(testAiProvider).mockResolvedValueOnce({ ok: true, model: 'm', durationMs: 5 });
    fireEvent.click(button);
    expect(await findByText('ai.admin.testOk')).toBeTruthy();
  });
  it('the key mention sits outside the truncated model, so a narrow screen still shows it; the type is a short tag', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [
      { id: 7, name: 'GPT', type: 'openai', baseUrl: 'https://api.example.com', model: 'gpt-6-sol', hasAdminKey: true, shared: true, position: 0 },
      { id: 8, name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku', hasAdminKey: false, shared: true, position: 1 },
    ], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const { findByText, getByText, getAllByText } = render(<AiTab active />);
    const badge = await findByText('ai.admin.keySet');
    expect(badge.closest('.truncate')).toBeNull();
    expect(getAllByText('ai.admin.keySet')).toHaveLength(1);
    const model = getByText('gpt-6-sol');
    expect(model.classList.contains('truncate')).toBe(true);
    expect(model.getAttribute('title')).toBe('gpt-6-sol');
    // L'étiquette de type est la forme courte, pas l'intitulé du choix de l'éditeur.
    expect(getByText('ai.admin.typeOpenaiShort')).toBeTruthy();
    expect(getByText('ai.admin.typeAnthropicShort')).toBeTruthy();
  });

  it('reordering sends the full id list; the default provider goes out as a number', async () => {
    useAuthStore.setState({ backendUser: admin });
    const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: true, position });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(3, 'A', 0), mk(5, 'B', 1), mk(9, 'C', 2)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
    vi.mocked(reorderAiProviders).mockResolvedValue();
    vi.mocked(updateAiSettings).mockResolvedValue();
    const { findByRole, getByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.more — A' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.admin.moveDown' }));
    await waitFor(() => expect(reorderAiProviders).toHaveBeenCalledWith([5, 3, 9]));
    fireEvent.click(getByRole('button', { name: 'ai.admin.more — C' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.admin.setDefault' }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ defaultProvider: 9 }));
  });

  it('editing: the key field starts empty and an empty key means keep, never clear', async () => {
    useAuthStore.setState({ backendUser: admin });
    const p = { id: 7, name: 'Ollama', type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: true, shared: false, position: 0 };
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(updateAiProvider).mockResolvedValue({ ...p, model: 'm2' });
    const { findByRole, getByLabelText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.edit/ }));
    expect((getByLabelText('ai.admin.key') as HTMLInputElement).value).toBe('');
    fireEvent.change(getByLabelText('ai.admin.model'), { target: { value: 'm2' } });
    fireEvent.click(await findByRole('button', { name: 'ai.admin.save' }));
    await waitFor(() => expect(updateAiProvider).toHaveBeenCalledWith(7, expect.objectContaining({ model: 'm2' })));
    expect(updateAiProvider).toHaveBeenCalledWith(7, expect.not.objectContaining({ adminKey: expect.anything() }));
  });
  it('clears a saved admin key after confirmation, never without', async () => {
    useAuthStore.setState({ backendUser: admin });
    const p = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: true, position: 0 };
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(updateAiProvider).mockResolvedValue({ ...p, hasAdminKey: false });
    const { findByRole, getByRole, queryByRole, queryByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.edit/ }));
    fireEvent.click(getByRole('button', { name: 'ai.admin.clearKey' }));
    expect(updateAiProvider).not.toHaveBeenCalled();
    const dialog = await findByRole('dialog');
    // La boîte ignore les validations pendant sa période de grâce : on réessaie.
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.admin.clearKey' }));
      expect(updateAiProvider).toHaveBeenCalledWith(7, { adminKey: null });
    });
    await waitFor(() => expect(queryByText('ai.admin.keySet')).toBeNull());
    expect(queryByRole('button', { name: 'ai.admin.clearKey' })).toBeNull();
    expect(queryByRole('dialog')).toBeNull();
  });
  it('cancelling the confirmation leaves the key alone', async () => {
    useAuthStore.setState({ backendUser: admin });
    const p = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: true, position: 0 };
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const { findByRole, getByRole, getByText, queryByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.edit/ }));
    fireEvent.click(getByRole('button', { name: 'ai.admin.clearKey' }));
    fireEvent.click(within(await findByRole('dialog')).getByRole('button', { name: 'dialog.cancel' }));
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(updateAiProvider).not.toHaveBeenCalled();
    expect(getByText('ai.admin.keySet')).toBeTruthy();
  });
  it('a failed clear keeps the key and says so', async () => {
    useAuthStore.setState({ backendUser: admin });
    const p = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: true, position: 0 };
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(updateAiProvider).mockRejectedValue(new Error('network'));
    const { findByRole, getByRole, getByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.edit/ }));
    fireEvent.click(getByRole('button', { name: 'ai.admin.clearKey' }));
    const dialog = await findByRole('dialog');
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.admin.clearKey' }));
      expect(updateAiProvider).toHaveBeenCalled();
    });
    expect((await findByRole('alert')).textContent).toBe('ai.admin.saveError');
    expect(getByText('ai.admin.keySet')).toBeTruthy();
  });
  it('offers no clear button when there is no saved key, nor when adding a provider', async () => {
    useAuthStore.setState({ backendUser: admin });
    const p = { id: 7, name: 'Ollama', type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: false, position: 0 };
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const { findByRole, queryByRole, getByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.edit/ }));
    expect(queryByRole('button', { name: 'ai.admin.clearKey' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'ai.admin.close' }));
    fireEvent.click(getByRole('button', { name: 'ai.admin.add' }));
    expect(queryByRole('button', { name: 'ai.admin.clearKey' })).toBeNull();
  });
  it('deleting asks first, then removes the provider and its default badge', async () => {
    useAuthStore.setState({ backendUser: admin });
    const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: true, position });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(7, 'Ollama', 0), mk(8, 'Other', 1)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(deleteAiProvider).mockResolvedValue();
    const { findByRole, getByRole, getByText, queryByText, queryByRole } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.more — Ollama' }));
    expect(getByText('ai.admin.defaultBadge')).toBeTruthy();
    fireEvent.click(getByRole('menuitem', { name: 'ai.admin.delete — Ollama' }));
    expect(queryByRole('menu')).toBeNull();
    expect(deleteAiProvider).not.toHaveBeenCalled();
    const dialog = await findByRole('dialog');
    // La boîte ignore les validations pendant sa période de grâce : on réessaie.
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.admin.delete' }));
      expect(deleteAiProvider).toHaveBeenCalledWith(7);
    });
    await waitFor(() => expect(queryByText('Ollama')).toBeNull());
    // Le défaut supprimé ne laisse aucun badge derrière lui.
    expect(queryByText('ai.admin.defaultBadge')).toBeNull();
  });

  describe('the providers list', () => {
    const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: `m${id}`, hasAdminKey: false, shared: true, position });
    async function renderList(defaultProvider: number | null = 3) {
      useAuthStore.setState({ backendUser: admin });
      vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(3, 'A', 0), mk(5, 'B', 1), mk(9, 'C', 2)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider } });
      vi.mocked(updateAiSettings).mockResolvedValue();
      vi.mocked(reorderAiProviders).mockResolvedValue();
      const r = render(<AiTab active />);
      await r.findByRole('button', { name: 'ai.admin.more — A' });
      return r;
    }
    afterEach(() => { useUiStore.setState({ layoutMode: 'auto' }); });

    it('one row per provider, with Test, Edit and More actions named after it', async () => {
      const { getAllByRole, getByRole } = await renderList();
      const rows = getAllByRole('listitem').filter((li) => li.querySelector('[aria-haspopup]'));
      expect(rows).toHaveLength(3);
      for (const name of ['A', 'B', 'C']) {
        const row = rows.find((li) => within(li).queryByRole('button', { name: `ai.admin.more — ${name}` }))!;
        expect(within(row).getByRole('button', { name: `ai.admin.test — ${name}` })).toBeTruthy();
        expect(within(row).getByRole('button', { name: `ai.admin.edit — ${name}` })).toBeTruthy();
        // Plus de boutons à la ligne pour monter, descendre ou supprimer : le menu les porte.
        expect(within(row).queryByRole('button', { name: /moveUp|moveDown|delete/ })).toBeNull();
      }
      const more = getByRole('button', { name: 'ai.admin.more — A' });
      expect(more.getAttribute('aria-haspopup')).toBe('menu');
      expect(more.getAttribute('aria-expanded')).toBe('false');
    });

    it('the name is bold, truncated and titled; only the default carries the badge', async () => {
      const { getByText, getAllByText } = await renderList(5);
      const name = getByText('B');
      expect(name.classList.contains('truncate')).toBe(true);
      expect(name.getAttribute('title')).toBe('B');
      expect(getAllByText('ai.admin.defaultBadge')).toHaveLength(1);
      expect(getByText('ai.admin.defaultBadge').parentElement?.textContent).toContain('B');
    });

    it('the menu offers Move up, Move down, Set as default and Delete, with impossible moves disabled', async () => {
      const { getByRole } = await renderList(null);
      const more = getByRole('button', { name: 'ai.admin.more — A' });
      fireEvent.click(more);
      const menu = getByRole('menu');
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
        'ai.admin.moveUp', 'ai.admin.moveDown', 'ai.admin.setDefault', 'ai.admin.delete',
      ]);
      // Désactivés mais focalisables : les flèches du menu passent dessus.
      expect(within(menu).getByRole('menuitem', { name: 'ai.admin.moveUp' }).getAttribute('aria-disabled')).toBe('true');
      expect(within(menu).getByRole('menuitem', { name: 'ai.admin.moveDown' }).getAttribute('aria-disabled')).toBeNull();
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'ai.admin.moveUp' }));
      expect(reorderAiProviders).not.toHaveBeenCalled();
      expect(getByRole('menu')).toBeTruthy();
    });

    it('the last row cannot move down', async () => {
      const { getByRole } = await renderList();
      fireEvent.click(getByRole('button', { name: 'ai.admin.more — C' }));
      expect(getByRole('menuitem', { name: 'ai.admin.moveDown' }).getAttribute('aria-disabled')).toBe('true');
      expect(getByRole('menuitem', { name: 'ai.admin.moveUp' }).getAttribute('aria-disabled')).toBeNull();
    });

    it('Set as default saves defaultProvider and moves the badge; the default row says so instead', async () => {
      const { getByRole, getByText, queryByRole } = await renderList(3);
      fireEvent.click(getByRole('button', { name: 'ai.admin.more — A' }));
      const current = getByRole('menuitem', { name: 'ai.admin.defaultProvider' });
      expect(current.getAttribute('aria-disabled')).toBe('true');
      expect(queryByRole('menuitem', { name: 'ai.admin.setDefault' })).toBeNull();
      fireEvent.click(current);
      expect(updateAiSettings).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(getByRole('button', { name: 'ai.admin.more — B' }));
      fireEvent.click(getByRole('menuitem', { name: 'ai.admin.setDefault' }));
      await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ defaultProvider: 5 }));
      expect(queryByRole('menu')).toBeNull();
      expect(getByText('ai.admin.defaultBadge').parentElement?.textContent).toContain('B');
    });

    it('the « Fournisseur par défaut » select is gone', async () => {
      const { queryByLabelText, getByRole } = await renderList();
      expect(queryByLabelText('ai.admin.defaultProvider')).toBeNull();
      // Les autres blocs ont leurs propres listes : seul « Fournisseurs » compte ici.
      const block = getByRole('heading', { name: 'ai.admin.title' }).closest('section')!;
      expect(within(block).queryAllByRole('combobox')).toHaveLength(0);
    });

    it('closing the menu, by Escape or after an action, gives the focus back to its button', async () => {
      const { getByRole, queryByRole } = await renderList();
      const more = getByRole('button', { name: 'ai.admin.more — B' });
      fireEvent.click(more);
      expect(document.activeElement).toBe(getByRole('menuitem', { name: 'ai.admin.moveUp' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(more);
      fireEvent.click(more);
      fireEvent.click(getByRole('menuitem', { name: 'ai.admin.moveUp' }));
      await waitFor(() => expect(reorderAiProviders).toHaveBeenCalledWith([5, 3, 9]));
      expect(queryByRole('menu')).toBeNull();
      // La ligne a bougé ; son bouton est le même, et il garde le focus.
      expect(document.activeElement).toBe(getByRole('button', { name: 'ai.admin.more — B' }));
      // Redescendre déplace CE nœud-là dans le DOM. jsdom ne retire pas le focus
      // d'un nœud déplacé (Chrome, si) : ceci fixe le résultat, pas la cause.
      fireEvent.click(more);
      fireEvent.click(getByRole('menuitem', { name: 'ai.admin.moveDown' }));
      await waitFor(() => expect(reorderAiProviders).toHaveBeenLastCalledWith([3, 5, 9]));
      expect(document.activeElement).toBe(more);
    });

    it('on touch the same actions open in a bottom sheet named after the provider', async () => {
      useUiStore.setState({ layoutMode: 'mobile' });
      const { getByRole, queryByRole } = await renderList();
      const more = getByRole('button', { name: 'ai.admin.more — B' });
      expect(more.getAttribute('aria-haspopup')).toBe('dialog');
      fireEvent.click(more);
      const sheet = getByRole('dialog', { name: 'B' });
      expect(queryByRole('menu')).toBeNull();
      for (const name of ['ai.admin.moveUp', 'ai.admin.moveDown', 'ai.admin.setDefault', 'ai.admin.delete']) {
        expect(within(sheet).getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
      }
      fireEvent.click(within(sheet).getByRole('button', { name: 'ai.admin.setDefault' }));
      await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ defaultProvider: 5 }));
      expect(queryByRole('dialog')).toBeNull();
    });

    it('a test result sits under its row, behind a coloured dot', async () => {
      vi.mocked(testAiProvider).mockResolvedValue({ ok: true, model: 'm', durationMs: 5 });
      const { getByRole, findByText } = await renderList();
      fireEvent.click(getByRole('button', { name: 'ai.admin.test — B' }));
      const ok = await findByText('ai.admin.testOk');
      const status = ok.closest('[role="status"]')!;
      expect(status.closest('li')?.textContent).toContain('m5');
      const dot = status.querySelector('[aria-hidden="true"]') as HTMLElement;
      expect(dot.style.background).toBe('var(--accent)');
    });
  });

  describe('the editor', () => {
    it('is titled « New provider » when adding and « Edit X » when editing', async () => {
      useAuthStore.setState({ backendUser: admin });
      const p = { id: 7, name: 'Ollama', type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: false, position: 0 };
      vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
      const { findByRole, getByRole, queryByRole } = render(<AiTab active />);
      fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
      expect(getByRole('group', { name: 'ai.admin.newTitle' })).toBeTruthy();
      expect(getByRole('heading', { level: 4, name: 'ai.admin.newTitle' })).toBeTruthy();
      fireEvent.click(getByRole('button', { name: 'ai.admin.close' }));
      expect(queryByRole('group', { name: 'ai.admin.newTitle' })).toBeNull();
      fireEvent.click(getByRole('button', { name: 'ai.admin.edit — Ollama' }));
      expect(getByRole('group', { name: 'ai.admin.editTitle:Ollama' })).toBeTruthy();
    });

    it('lays the fields in a single column (the content column is too narrow for two) and puts the clear-key button beside the key', async () => {
      useAuthStore.setState({ backendUser: admin });
      const p = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: true, position: 0 };
      vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
      const { findByRole, getByLabelText, getByRole } = render(<AiTab active />);
      fireEvent.click(await findByRole('button', { name: 'ai.admin.edit — GPT' }));
      const grid = getByLabelText('ai.admin.name').closest('.grid')!;
      expect(grid.className).not.toMatch(/grid-cols-2/);
      for (const label of ['ai.admin.type', 'ai.admin.baseUrl', 'ai.admin.model']) expect(grid.contains(getByLabelText(label))).toBe(true);
      expect(grid.contains(getByLabelText('ai.admin.key'))).toBe(false);
      const keyRow = getByLabelText('ai.admin.key').parentElement!;
      expect(keyRow.contains(getByRole('button', { name: 'ai.admin.clearKey' }))).toBe(true);
      expect(getByRole('switch', { name: 'ai.admin.shared' }).getAttribute('aria-checked')).toBe('true');
    });

    it('the share switch goes out with the provider', async () => {
      useAuthStore.setState({ backendUser: admin });
      const p = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: false, position: 0 };
      vi.mocked(getAiProviders).mockResolvedValue({ providers: [p], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
      vi.mocked(updateAiProvider).mockResolvedValue({ ...p, shared: true });
      const { findByRole, getByRole } = render(<AiTab active />);
      fireEvent.click(await findByRole('button', { name: 'ai.admin.edit — GPT' }));
      fireEvent.click(getByRole('switch', { name: 'ai.admin.shared' }));
      fireEvent.click(getByRole('button', { name: 'ai.admin.save' }));
      await waitFor(() => expect(updateAiProvider).toHaveBeenCalledWith(7, expect.objectContaining({ shared: true })));
    });
  });
});

describe('AiTab — model list', () => {
  const saved = { id: 7, name: 'GPT', type: 'openai' as const, baseUrl: 'https://api.example.com', model: 'gpt-5-mini', hasAdminKey: true, shared: true, position: 0 };
  async function openEditor() {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [saved], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const r = render(<AiTab active />);
    fireEvent.click(await r.findByRole('button', { name: 'ai.admin.edit — GPT' }));
    return r;
  }

  it('lists with the saved provider, marks the current model, and a pick fills the field then closes', async () => {
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, models: ['gpt-5', 'gpt-5-mini'] });
    const { getByRole, findByRole, getByLabelText, queryByRole } = await openEditor();
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    await findByRole('button', { name: 'gpt-5' });
    // Clé laissée vide : le serveur reprend la clé enregistrée.
    expect(listAiModels).toHaveBeenCalledWith({ type: 'openai', baseUrl: 'https://api.example.com', providerId: 7 });
    expect(getByRole('button', { name: 'gpt-5-mini' }).getAttribute('aria-current')).toBe('true');
    expect(getByRole('button', { name: 'gpt-5' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'gpt-5' }));
    expect((getByLabelText('ai.admin.model') as HTMLInputElement).value).toBe('gpt-5');
    expect(queryByRole('button', { name: 'gpt-5-mini' })).toBeNull();
  });
  it('sends the typed key, and a filter appears for a long list', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `model-${i}`).concat('special-one');
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, models: many });
    const { getByRole, getByLabelText, findByLabelText, queryByRole, getByText } = await openEditor();
    fireEvent.change(getByLabelText('ai.admin.key'), { target: { value: 'typed' } });
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    const filter = await findByLabelText('ai.admin.models.filter');
    expect(listAiModels).toHaveBeenCalledWith(expect.objectContaining({ adminKey: 'typed' }));
    fireEvent.change(filter, { target: { value: 'SPECIAL' } });
    expect(getByRole('button', { name: 'special-one' })).toBeTruthy();
    expect(queryByRole('button', { name: 'model-3' })).toBeNull();
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(getByText('ai.admin.models.noMatch')).toBeTruthy();
  });
  it('no filter for a short list', async () => {
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, models: ['a', 'b'] });
    const { getByRole, findByRole, queryByLabelText } = await openEditor();
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    await findByRole('button', { name: 'a' });
    expect(queryByLabelText('ai.admin.models.filter')).toBeNull();
  });
  it('says why it failed: refused key, anything else, or nothing found', async () => {
    const { getByRole, findByText } = await openEditor();
    vi.mocked(listAiModels).mockResolvedValueOnce({ ok: false, kind: 'auth', message: 'HTTP 401' });
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    expect((await findByText('ai.admin.models.authFailed')).closest('[role="alert"]')).toBeTruthy();
    vi.mocked(listAiModels).mockResolvedValueOnce({ ok: false, kind: 'technical', message: 'HTTP 404' });
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    expect(await findByText('ai.admin.models.failed')).toBeTruthy();
    vi.mocked(listAiModels).mockRejectedValueOnce(new Error('network'));
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    expect(await findByText('ai.admin.models.failed')).toBeTruthy();
    vi.mocked(listAiModels).mockResolvedValueOnce({ ok: true, models: [] });
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    expect(await findByText('ai.admin.models.empty')).toBeTruthy();
  });
  it('a changed URL, type or key drops a list that no longer applies', async () => {
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, models: ['gpt-5'] });
    const { getByRole, findByRole, getByLabelText, queryByRole } = await openEditor();
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    await findByRole('button', { name: 'gpt-5' });
    fireEvent.change(getByLabelText('ai.admin.baseUrl'), { target: { value: 'https://other.example.com' } });
    expect(queryByRole('button', { name: 'gpt-5' })).toBeNull();
  });
  it('the close button hides the list without changing the model', async () => {
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, models: ['gpt-5'] });
    const { getByRole, findByRole, getByLabelText, queryByRole } = await openEditor();
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.list' }));
    await findByRole('button', { name: 'gpt-5' });
    fireEvent.click(getByRole('button', { name: 'ai.admin.models.close' }));
    expect(queryByRole('button', { name: 'gpt-5' })).toBeNull();
    expect((getByLabelText('ai.admin.model') as HTMLInputElement).value).toBe('gpt-5-mini');
  });
  it('the button waits for a base URL', async () => {
    useAuthStore.setState({ backendUser: admin });
    const { findByRole, getByRole, getByLabelText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    expect((getByRole('button', { name: 'ai.admin.models.list' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(getByLabelText('ai.admin.baseUrl'), { target: { value: 'https://api.example.com' } });
    expect((getByRole('button', { name: 'ai.admin.models.list' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('AiTab — routing and usage in the « Résumés » block', () => {
  const view = (o: Partial<AiProviderView> & { id: number; name: string }): AiProviderView =>
    ({ type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available: true, ...o });
  const setConfig = (o: Partial<AiConfig> = {}) =>
    useAiStore.setState({ config: { enabled: true, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null, ...o } });
  beforeEach(() => {
    useAuthStore.setState({ backendUser: user });
    useUiStore.setState({ aiPreferredProvider: null, aiFallback: true, aiAutoSummary: false, aiAutoSummaryConfirmed: false, aiPanelAlways: true });
    setConfig();
  });
  afterEach(() => {
    useAiStore.setState({ config: null });
    useUiStore.setState({ aiPreferredProvider: null, aiFallback: true, aiAutoSummary: false, aiAutoSummaryConfirmed: false, aiPanelAlways: true });
  });

  it('lists available providers, greys the ones without a key, and stores the choice', () => {
    setConfig({ providers: [view({ id: 1, name: 'Ollama' }), view({ id: 2, name: 'Claude', available: false })], defaultProvider: 1 });
    const { getByLabelText } = render(<AiTab active />);
    const select = getByLabelText('ai.user.preferred') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ['', 'ai.user.preferredDefault:Ollama', false], ['1', 'Ollama', false], ['2', 'ai.user.keyRequired', true],
    ]);
    fireEvent.change(select, { target: { value: '1' } });
    expect(useUiStore.getState().aiPreferredProvider).toBe(1);
    fireEvent.change(select, { target: { value: '' } });
    expect(useUiStore.getState().aiPreferredProvider).toBeNull();
  });
  const firstOption = () => (screen.getByLabelText('ai.user.preferred') as HTMLSelectElement).options[0].textContent;
  it('names the first available provider when the admin set no default', () => {
    setConfig({ providers: [view({ id: 1, name: 'Claude', available: false }), view({ id: 2, name: 'Ollama' })], defaultProvider: null });
    render(<AiTab active />);
    expect(firstOption()).toBe('ai.user.preferredDefault:Ollama');
  });
  it('names the provider resolution will use, not an admin default this user cannot reach', () => {
    setConfig({ providers: [view({ id: 1, name: 'Claude', available: false }), view({ id: 2, name: 'Ollama' })], defaultProvider: 1 });
    render(<AiTab active />);
    expect(firstOption()).toBe('ai.user.preferredDefault:Ollama');
  });
  it('says « automatic » when no provider is available to this user', () => {
    setConfig({ providers: [view({ id: 1, name: 'Claude', available: false })], defaultProvider: 1 });
    render(<AiTab active />);
    expect(firstOption()).toBe('ai.user.preferredAuto');
  });
  it('shows a deleted preferred provider as such instead of falling back silently', () => {
    setConfig({ providers: [view({ id: 1, name: 'Ollama' })], defaultProvider: 1 });
    useUiStore.setState({ aiPreferredProvider: 42 });
    const { getByLabelText } = render(<AiTab active />);
    const select = getByLabelText('ai.user.preferred') as HTMLSelectElement;
    expect(select.value).toBe('42');
    expect(select.selectedOptions[0].textContent).toBe('ai.user.removedProvider');
  });
  it('fallback is a switch, on by default, described by its hint', () => {
    const { getByRole, getByText } = render(<AiTab active />);
    const sw = getByRole('switch', { name: 'ai.user.fallback' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-describedby')).toContain(getByText('ai.user.fallbackHint').id);
    // La seconde aide (ce que le repli ne fait pas : « Réessayer avec… ») est toujours là.
    expect(sw.getAttribute('aria-describedby')).toContain(getByText('ai.user.fallbackManualHint').id);
    fireEvent.click(sw);
    expect(useUiStore.getState().aiFallback).toBe(false);
    expect(getByText('ai.user.fallbackManualHint')).toBeTruthy();
  });
  it('auto-summary asks for confirmation before turning on, and turns off without asking', async () => {
    const { getByRole, queryByRole } = render(<AiTab active />);
    fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
    const dialog = getByRole('dialog');
    expect(within(dialog).getByText('ai.user.autoConfirmMessage')).toBeTruthy();
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.user.autoConfirm' }));
      expect(useUiStore.getState().aiAutoSummary).toBe(true);
    });
    // Confirmée ici, la boîte ne revient pas pour un interrupteur « Résumer » de flux ou de catégorie.
    expect(useUiStore.getState().aiAutoSummaryConfirmed).toBe(true);
    expect(queryByRole('dialog')).toBeNull();
    expect(getByRole('switch', { name: 'ai.user.auto' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
    expect(queryByRole('dialog')).toBeNull();
  });
  it('the global auto-summary switch does not ask again once confirmed', () => {
    useUiStore.setState({ aiAutoSummaryConfirmed: true });
    const { getByRole, queryByRole } = render(<AiTab active />);
    fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
    expect(queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiAutoSummary).toBe(true);
    fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
    expect(queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
  });
  it('panel visibility is a switch right after auto-summary, on by default, described by its hint', () => {
    const { getByRole, getByText } = render(<AiTab active />);
    const sw = getByRole('switch', { name: 'ai.user.panel' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-describedby')).toContain(getByText('ai.user.panelHint').id);
    const auto = getByRole('switch', { name: 'ai.user.auto' });
    expect(auto.compareDocumentPosition(sw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(sw);
    expect(useUiStore.getState().aiPanelAlways).toBe(false);
    expect(getByRole('switch', { name: 'ai.user.panel' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(getByRole('switch', { name: 'ai.user.panel' }));
    expect(useUiStore.getState().aiPanelAlways).toBe(true);
  });
  it('cancelling the confirmation leaves auto-summary off', async () => {
    const { getByRole, queryByRole } = render(<AiTab active />);
    fireEvent.click(getByRole('switch', { name: 'ai.user.auto' }));
    fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'dialog.cancel' }));
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
  });
  it('shows today\'s usage only when a cap applies to an instance-paid provider', () => {
    const paid = view({ id: 1, name: 'Ollama' });
    setConfig({ providers: [paid], dailyCap: 50, usageToday: 3 });
    const first = render(<AiTab active />);
    expect(first.getByText('ai.user.usage')).toBeTruthy();
    first.unmount();
    // Un administrateur ne voit pas de plafond qui ne le concerne pas.
    useAuthStore.setState({ backendUser: admin });
    const second = render(<AiTab active />);
    expect(second.queryByText('ai.user.usage')).toBeNull();
    second.unmount();
    useAuthStore.setState({ backendUser: user });
    for (const cfg of [
      { providers: [paid], dailyCap: 0 },
      { providers: [view({ id: 1, name: 'Ollama', hasUserKey: true })], dailyCap: 50 },
      { providers: [view({ id: 1, name: 'Ollama', shared: false })], dailyCap: 50 },
      { providers: [view({ id: 1, name: 'Ollama', available: false })], dailyCap: 50 },
      { providers: [], dailyCap: 50 },
    ]) {
      setConfig(cfg);
      const r = render(<AiTab active />);
      expect(r.queryByText('ai.user.usage')).toBeNull();
      r.unmount();
    }
  });
});

describe('AiTab — « Traduction »', () => {
  const provider = (id: number, name: string): AiProviderView =>
    ({ id, name, type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available: true });
  beforeEach(() => {
    useAuthStore.setState({ backendUser: user });
    useUiStore.setState({ aiTranslationLanguage: 'ui', aiTranslationProvider: null });
    useAiStore.setState({ config: { enabled: true, providers: [provider(1, 'Ollama')], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null } });
  });
  afterEach(() => {
    useAiStore.setState({ config: null });
    useUiStore.setState({ aiTranslationLanguage: 'ui', aiTranslationProvider: null });
  });

  it('sits between « Résumés » and « Par flux et catégorie »', () => {
    const { getByText } = render(<AiTab active />);
    const title = getByText('ai.translation.title');
    expect(getByText('ai.user.title').compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(getByText('ai.routing.title')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('the translation block offers the UI language first, then the 28 languages named in the UI language', () => {
    const { getByLabelText } = render(<AiTab active />);
    const select = getByLabelText('ai.translation.language') as HTMLSelectElement;
    const options = [...select.options];
    expect(options).toHaveLength(29);
    expect([options[0].value, options[0].textContent]).toEqual(['ui', `ai.translation.uiLanguage:${languageName('fr', 'fr')}`]);
    const rest = options.slice(1);
    expect(rest.map((o) => o.value).sort()).toEqual([...AI_LANGUAGES].sort());
    for (const o of rest) expect(o.textContent).toBe(languageName(o.value as typeof AI_LANGUAGES[number], 'fr'));
    const names = rest.map((o) => o.textContent as string);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fr')));
    expect(select.value).toBe('ui');
    fireEvent.change(select, { target: { value: 'ja' } });
    expect(useUiStore.getState().aiTranslationLanguage).toBe('ja');
    fireEvent.change(select, { target: { value: 'ui' } });
    expect(useUiStore.getState().aiTranslationLanguage).toBe('ui');
  });
  it('the translation provider defaults to « same as the summary » and stores a choice', () => {
    const { getByLabelText } = render(<AiTab active />);
    const select = getByLabelText('ai.translation.provider') as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['', 'ai.translation.sameAsSummary'], ['1', 'Ollama']]);
    fireEvent.change(select, { target: { value: '1' } });
    expect(useUiStore.getState().aiTranslationProvider).toBe(1);
    fireEvent.change(select, { target: { value: '' } });
    expect(useUiStore.getState().aiTranslationProvider).toBeNull();
  });
});

describe('AiTab — « Par flux et catégorie »', () => {
  const cat = (label: string) => ({ id: `user/-/label/${label}`, label });
  const sub = (n: number, categories: { id: string; label: string }[] = []) => ({ id: `feed/${n}`, title: `Flux ${n}`, categories });
  const provider = (id: number, name: string, available = true): AiProviderView =>
    ({ id, name, type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available });
  const reset = () => {
    useUiStore.setState({
      aiCategoryProviders: {}, feedSettings: {}, aiCategoryAutoTranslate: {}, aiCategoryAutoSummary: {}, aiCategoryPanel: {},
      aiPanelAlways: true, aiAutoSummary: false, aiAutoSummaryConfirmed: false, aiAutoTranslateConfirmed: false, layoutMode: 'auto',
    });
    useFeedStore.setState({ subscriptions: [] });
  };
  const sw = (kind: 'Summary' | 'Translate' | 'Panel', name: string) => screen.getByRole('switch', {
    name: kind === 'Panel' ? `ai.routing.panelFor:${name}` : `ai.routing.auto${kind}For:${name}`,
  });
  const checked = (kind: 'Summary' | 'Translate' | 'Panel', name: string) => sw(kind, name).getAttribute('aria-checked');
  const state = (kind: 'Summary' | 'Translate' | 'Panel', name: string) => sw(kind, name).getAttribute('data-state');
  /** Le bouton de fournisseur d'une ligne : son nom dit la ligne ET la valeur, l'étiquette visible pouvant n'être qu'une icône. */
  const providerBtn = (name: string, category = false) => screen.getByRole('button', {
    name: new RegExp(`^ai\\.routing\\.${category ? 'category' : 'feed'}ProviderFor:${name} — `),
  });
  const pick = (button: HTMLElement, option: string) => {
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
  };
  const band = (name: RegExp) => screen.getByRole('button', { name }).closest('[data-routing-row]') as HTMLElement;
  beforeEach(() => {
    reset();
    useAuthStore.setState({ backendUser: user });
    useFeedStore.setState({ subscriptions: [sub(1, [cat('Tech')]), sub(2, [cat('Tech')]), sub(3)] });
    useAiStore.setState({ config: { enabled: true, providers: [provider(1, 'Ollama')], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null } });
  });
  afterEach(() => {
    reset();
    useAiStore.setState({ config: null });
  });

  it('is one grid with a single column header, categories collapsed with their feed count', () => {
    useUiStore.setState({ feedSettings: { 'feed/2': { aiProvider: 1 } } });
    render(<AiTab active />);
    expect(screen.getByText('ai.routing.title')).toBeTruthy();
    const grids = document.querySelectorAll('[data-routing-grid]');
    expect(grids).toHaveLength(1);
    expect(grids[0].classList.contains('ai-routing__grid')).toBe(true);
    // Les mots des colonnes, une seule fois, dans l'ordre des cellules ; décoratifs (chaque contrôle porte son nom complet).
    const headers = document.querySelectorAll('[data-routing-header]');
    expect(headers).toHaveLength(1);
    expect(headers[0].getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(headers[0].children).map((c) => c.textContent)).toEqual([
      '', 'ai.routing.autoSummary', 'ai.routing.autoTranslate', 'ai.routing.panel', 'ai.routing.providerColumn',
    ]);
    const tech = band(/^Tech/);
    expect(screen.getByRole('button', { name: /^Tech/ }).getAttribute('aria-expanded')).toBe('false');
    expect(within(tech).getByText('ai.routing.feedCount')).toBeTruthy();
    // « 2 flux, 1 réglé » : un fournisseur propre compte comme un réglage.
    expect(within(tech).getByText('ai.routing.overrides')).toBeTruthy();
    expect(document.querySelectorAll('[data-routing-row="feed"]')).toHaveLength(0);
  });
  it('sets the category provider from its band, through a menu, and gives the focus back', () => {
    render(<AiTab active />);
    // Sur la bande, catégorie repliée : rien à déplier pour régler la catégorie.
    const button = providerBtn('Tech', true);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-label')).toBe('ai.routing.categoryProviderFor:Tech — ai.routing.default');
    expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'ai.routing.categoryProviderFor:Tech' });
    expect(within(menu).getByRole('menuitemradio', { name: 'ai.routing.default' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Ollama' }));
    expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 1 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('ai.routing.categoryProviderFor:Tech — Ollama');
    pick(providerBtn('Tech', true), 'ai.routing.default');
    expect(useUiStore.getState().aiCategoryProviders).toEqual({});
  });
  it('closes the provider menu on Escape without changing anything, focus back on the button', () => {
    render(<AiTab active />);
    const button = providerBtn('Tech', true);
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(useUiStore.getState().aiCategoryProviders).toEqual({});
  });
  it('gives every category band three named switches beside its provider; the uncategorised band has none', () => {
    useFeedStore.setState({ subscriptions: [sub(1, [cat('Actualités')]), sub(2)] });
    render(<AiTab active />);
    const row = band(/^Actualités/);
    for (const el of [sw('Summary', 'Actualités'), sw('Translate', 'Actualités'), sw('Panel', 'Actualités'), providerBtn('Actualités', true)]) {
      expect(el.parentElement).toBe(row);
    }
    // « Sans catégorie » n'a rien à régler au niveau du groupe : ni interrupteur, ni fournisseur.
    const routing = screen.getAllByRole('switch').filter((x) => /^ai\.routing\./.test(x.getAttribute('aria-label') ?? ''));
    expect(routing).toHaveLength(3);
    expect(screen.queryAllByRole('button', { name: /^ai\.routing\.categoryProviderFor/ })).toHaveLength(1);
    expect(within(band(/^ai\.routing\.uncategorised/)).queryAllByRole('switch')).toHaveLength(0);
  });
  it('truncates the names on one line and keeps the full name in a title', () => {
    const url = 'https://example.com/a-very-long-feed-address-without-any-space/feed.xml';
    useFeedStore.setState({ subscriptions: [{ ...sub(1, [cat('Une catégorie au nom vraiment très long, bien plus que la ligne')]), title: url }] });
    render(<AiTab active />);
    // jsdom n'a pas de mise en page : on fige les classes qui coupent le nom sur une ligne.
    const label = screen.getByText('Une catégorie au nom vraiment très long, bien plus que la ligne');
    expect(label.className).toContain('truncate');
    expect(label.getAttribute('title')).toBe('Une catégorie au nom vraiment très long, bien plus que la ligne');
    const toggle = screen.getByRole('button', { name: /^Une catégorie/ });
    expect(toggle.className).toContain('min-w-0');
    fireEvent.click(toggle);
    const feed = screen.getByText(url);
    expect(feed.className).toContain('truncate');
    expect(feed.getAttribute('title')).toBe(url);
  });
  it('shows one row per feed: name, three switches and the provider are siblings in that single row', () => {
    render(<AiTab active />);
    const toggle = screen.getByRole('button', { name: /^Tech/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const rows = document.querySelectorAll('[data-routing-row="feed"]');
    expect(rows).toHaveLength(2);
    const row = rows[0] as HTMLElement;
    expect(row.classList.contains('grid-cols-subgrid')).toBe(true);
    expect(row.classList.contains('flex-wrap')).toBe(false);
    const name = within(row).getByText('Flux 1');
    expect((name.closest('[data-routing-name]') as HTMLElement).parentElement).toBe(row);
    for (const el of [sw('Summary', 'Flux 1'), sw('Translate', 'Flux 1'), sw('Panel', 'Flux 1'), providerBtn('Flux 1')]) {
      expect(el.parentElement).toBe(row);
    }
    expect(row.children).toHaveLength(5);
    // Le corps déplié est désigné par le bouton tant qu'il existe.
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)?.contains(row)).toBe(true);
    fireEvent.click(toggle);
    expect(document.querySelectorAll('[data-routing-row="feed"]')).toHaveLength(0);
    expect(toggle.getAttribute('aria-controls')).toBeNull();
  });
  it('a feed under a category shows the inherited value as such, and a tap writes an explicit value', () => {
    useUiStore.setState({ aiCategoryAutoSummary: { Tech: true }, aiAutoSummaryConfirmed: true });
    render(<AiTab active />);
    expect(state('Summary', 'Tech')).toBe('on');
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(checked('Summary', 'Flux 1')).toBe('true');
    expect(state('Summary', 'Flux 1')).toBe('inherited');
    expect(sw('Summary', 'Flux 1').getAttribute('title')).toBe('ai.routing.autoSummary — ai.routing.stateInherited');
    fireEvent.click(sw('Summary', 'Flux 1'));
    expect(useUiStore.getState().feedSettings['feed/1'].aiAutoSummary).toBe(false);
    expect(state('Summary', 'Flux 1')).toBe('off');
    expect(checked('Summary', 'Flux 1')).toBe('false');
    fireEvent.click(sw('Summary', 'Flux 1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().feedSettings['feed/1'].aiAutoSummary).toBe(true);
    expect(state('Summary', 'Flux 1')).toBe('on');
    expect(sw('Summary', 'Flux 1').getAttribute('title')).toBe('ai.routing.autoSummary — ai.routing.stateOn');
    expect(state('Summary', 'Flux 2')).toBe('inherited');
  });
  it('fills a switch set here, outlines an inherited one, leaves an off one neutral', () => {
    useUiStore.setState({ aiCategoryAutoTranslate: { Tech: true }, feedSettings: { 'feed/1': { aiAutoSummary: true } }, aiAutoSummaryConfirmed: true });
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    const on = sw('Summary', 'Flux 1');
    const inherited = sw('Translate', 'Flux 1');
    const off = sw('Summary', 'Flux 2');
    expect([on.style.background, on.style.color]).toEqual(['var(--accent)', 'var(--on-accent)']);
    expect([inherited.style.background, inherited.style.color]).toEqual(['transparent', 'var(--accent)']);
    expect([off.style.background, off.style.color]).toEqual(['transparent', 'var(--list-summary)']);
  });
  it('says where an inherited value comes from: the category, or the global setting', () => {
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^ai\.routing\.uncategorised/ }));
    // Le panneau est allumé d'origine (aiPanelAlways) : Flux 3, sans catégorie, l'hérite du global.
    expect(state('Panel', 'Flux 3')).toBe('inherited');
    expect(sw('Panel', 'Flux 3').getAttribute('title')).toBe('ai.routing.panel — ai.routing.stateGlobal');
    expect(sw('Translate', 'Flux 3').getAttribute('title')).toBe('ai.routing.autoTranslate — ai.routing.stateOff');
  });
  it('a category Panel switch shows the global value until it has its own, and writes an explicit value', () => {
    useUiStore.setState({ aiPanelAlways: false });
    render(<AiTab active />);
    expect(checked('Panel', 'Tech')).toBe('false');
    fireEvent.click(sw('Panel', 'Tech'));
    // Pas de confirmation de coût pour le panneau.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryPanel).toEqual({ Tech: true });
    expect(checked('Panel', 'Tech')).toBe('true');
    // Sa valeur propre est pleine ; avant, elle n'était qu'héritée (éteinte, donc grise).
    expect(state('Panel', 'Tech')).toBe('on');
    fireEvent.click(sw('Panel', 'Tech'));
    expect(useUiStore.getState().aiCategoryPanel).toEqual({ Tech: false });
  });
  it('a feed Panel switch writes feedSettings[id].aiPanel and shows the effective value', () => {
    useUiStore.setState({ aiCategoryPanel: { Tech: false } });
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    // Le flux hérite de sa catégorie éteinte (le global, lui, est allumé).
    expect(checked('Panel', 'Flux 1')).toBe('false');
    fireEvent.click(sw('Panel', 'Flux 1'));
    expect(useUiStore.getState().feedSettings['feed/1'].aiPanel).toBe(true);
    expect(checked('Panel', 'Flux 1')).toBe('true');
    expect(checked('Panel', 'Flux 2')).toBe('false');
    // Une valeur propre de panneau compte comme un flux réglé.
    expect(screen.getByText('ai.routing.overrides')).toBeTruthy();
    fireEvent.click(sw('Panel', 'Flux 1'));
    expect(useUiStore.getState().feedSettings['feed/1'].aiPanel).toBe(false);
  });
  it('a feed provider is set and set back to default from its row', () => {
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(screen.getAllByRole('button', { name: /^ai\.routing\.feedProviderFor/ })).toHaveLength(2);
    pick(providerBtn('Flux 1'), 'Ollama');
    expect(useUiStore.getState().feedSettings['feed/1'].aiProvider).toBe(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(providerBtn('Flux 1').getAttribute('aria-label')).toBe('ai.routing.feedProviderFor:Flux 1 — Ollama');
    pick(providerBtn('Flux 1'), 'ai.routing.default');
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });
  it('keeps the provider name for the wide layout and an icon, with a dot when overridden, for the narrow one', () => {
    useUiStore.setState({ aiCategoryProviders: { Tech: 1 } });
    render(<AiTab active />);
    const set = providerBtn('Tech', true);
    // jsdom n'évalue pas la requête de conteneur : les deux formes sont là, le CSS en montre une.
    expect(set.querySelector('.ai-routing__wide')?.textContent).toBe('Ollama');
    expect(set.querySelector('.ai-routing__narrow svg')).toBeTruthy();
    expect(set.querySelector('[data-override-dot]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    const unset = providerBtn('Flux 1');
    expect(unset.querySelector('.ai-routing__wide')?.textContent).toBe('ai.routing.default');
    expect(unset.querySelector('[data-override-dot]')).toBeNull();
  });
  it('keeps feeds without a category reachable, in their own group without group settings', () => {
    useFeedStore.setState({ subscriptions: [sub(3)] });
    render(<AiTab active />);
    expect(screen.queryAllByRole('button', { name: /^ai\.routing\.categoryProviderFor/ })).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: /^ai\.routing\.uncategorised/ });
    expect(screen.queryAllByRole('button', { name: /^ai\.routing\.feedProviderFor/ })).toHaveLength(0);
    fireEvent.click(toggle);
    pick(providerBtn('Flux 3'), 'Ollama');
    expect(useUiStore.getState().feedSettings['feed/3'].aiProvider).toBe(1);
  });
  it('shows a deleted provider as such, on the button and checked in the menu', () => {
    useUiStore.setState({ aiCategoryProviders: { Tech: 42 } });
    render(<AiTab active />);
    const button = providerBtn('Tech', true);
    expect(button.getAttribute('aria-label')).toBe('ai.routing.categoryProviderFor:Tech — ai.user.removedProvider');
    fireEvent.click(button);
    expect(screen.getByRole('menuitemradio', { name: 'ai.user.removedProvider' }).getAttribute('aria-checked')).toBe('true');
  });
  it('lists a provider without a usable key as unavailable, and ignores a tap on it', () => {
    useAiStore.setState({ config: { enabled: true, providers: [provider(1, 'Ollama'), provider(2, 'Claude', false)], userKeysAllowed: true, dailyCap: 0, usageToday: 0, defaultProvider: null } });
    render(<AiTab active />);
    fireEvent.click(providerBtn('Tech', true));
    const locked = screen.getByRole('menuitemradio', { name: 'ai.user.keyRequired' });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked);
    expect(useUiStore.getState().aiCategoryProviders).toEqual({});
    expect(screen.getByRole('menu')).toBeTruthy();
  });
  it('reads a category named like an Object property as unset, and ignores a corrupt feed value', () => {
    useFeedStore.setState({ subscriptions: [sub(1, [cat('constructor')]), sub(2, [cat('Tech')])] });
    useUiStore.setState({ feedSettings: { 'feed/2': { aiProvider: '3' as unknown as number } } });
    render(<AiTab active />);
    for (const b of screen.getAllByRole('button', { name: /^(constructor|Tech)/ })) fireEvent.click(b);
    for (const b of screen.getAllByRole('button', { name: /^ai\.routing\.(category|feed)ProviderFor/ })) {
      expect(b.getAttribute('aria-label')).toMatch(/ — ai\.routing\.default$/);
    }
    expect(screen.queryByText('ai.routing.overrides')).toBeNull();
  });
  it('a category translate switch asks for confirmation once, then not again', async () => {
    useFeedStore.setState({ subscriptions: [sub(1, [cat('Tech')]), sub(2, [cat('Science')])] });
    render(<AiTab active />);
    fireEvent.click(sw('Translate', 'Tech'));
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({});
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('ai.routing.translateConfirmTitle')).toBeTruthy();
    expect(within(dialog).getByText('ai.routing.translateConfirmMessage')).toBeTruthy();
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.user.autoConfirm' }));
      expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({ Tech: true });
    });
    expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(checked('Translate', 'Tech')).toBe('true');
    fireEvent.click(sw('Translate', 'Science'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({ Tech: true, Science: true });
    // Éteindre ne demande rien, et écrit un `false` explicite, comme le panneau.
    fireEvent.click(sw('Translate', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({ Tech: false, Science: true });
    expect(state('Translate', 'Tech')).toBe('off');
  });
  it('a feed translate switch asks for the cost confirmation the first time too', () => {
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    fireEvent.click(sw('Translate', 'Flux 1'));
    expect(within(screen.getByRole('dialog')).getByText('ai.routing.translateConfirmTitle')).toBeTruthy();
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });
  it('cancelling leaves the switch off', async () => {
    render(<AiTab active />);
    fireEvent.click(sw('Translate', 'Tech'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'dialog.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({});
    expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(false);
    expect(checked('Translate', 'Tech')).toBe('false');
  });
  it('a feed switch shows the inherited value and writes an explicit false when turned off', () => {
    useUiStore.setState({ aiCategoryAutoTranslate: { Tech: true } });
    render(<AiTab active />);
    expect(screen.queryByText('ai.routing.overrides')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(checked('Translate', 'Flux 1')).toBe('true');
    expect(checked('Translate', 'Flux 2')).toBe('true');
    fireEvent.click(sw('Translate', 'Flux 1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().feedSettings['feed/1'].aiAutoTranslate).toBe(false);
    expect(checked('Translate', 'Flux 1')).toBe('false');
    expect(checked('Translate', 'Flux 2')).toBe('true');
    // Une valeur propre compte comme un réglage, au même titre qu'un fournisseur.
    expect(screen.getByText('ai.routing.overrides')).toBeTruthy();
  });
  it('a feed summary switch opens the global confirmation when never confirmed', async () => {
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(checked('Summary', 'Flux 1')).toBe('false');
    fireEvent.click(sw('Summary', 'Flux 1'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('ai.user.autoConfirmMessage')).toBeTruthy();
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.user.autoConfirm' }));
      expect(useUiStore.getState().feedSettings['feed/1'].aiAutoSummary).toBe(true);
    });
    expect(useUiStore.getState().aiAutoSummaryConfirmed).toBe(true);
    // Le réglage global n'est pas touché : seul ce flux est résumé.
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(sw('Summary', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ Tech: true });
  });
  it('no summary confirmation while the global auto-summary is on; feeds show it as inherited', () => {
    useUiStore.setState({ aiAutoSummary: true });
    render(<AiTab active />);
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(checked('Summary', 'Flux 1')).toBe('true');
    expect(state('Summary', 'Flux 1')).toBe('inherited');
    expect(sw('Summary', 'Flux 1').getAttribute('title')).toBe('ai.routing.autoSummary — ai.routing.stateGlobal');
    // Éteinte puis rallumée : aucune confirmation, le global l'a déjà acceptée.
    fireEvent.click(sw('Summary', 'Tech'));
    fireEvent.click(sw('Summary', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ Tech: true });
  });
  it('a category inherits the global summary and panel settings the same way, and can be turned off under them', () => {
    // Retour du propriétaire : « Panneau » suivait le global, « Résumer » non, et « Hérité » ne se voyait jamais sur une catégorie.
    useUiStore.setState({ aiAutoSummary: true, aiPanelAlways: true });
    render(<AiTab active />);
    for (const kind of ['Summary', 'Panel'] as const) {
      expect(checked(kind, 'Tech')).toBe('true');
      expect(state(kind, 'Tech')).toBe('inherited');
    }
    expect(sw('Summary', 'Tech').getAttribute('title')).toBe('ai.routing.autoSummary — ai.routing.stateGlobal');
    expect(sw('Panel', 'Tech').getAttribute('title')).toBe('ai.routing.panel — ai.routing.stateGlobal');
    const inherited = sw('Summary', 'Tech');
    expect([inherited.style.background, inherited.style.color]).toEqual(['transparent', 'var(--accent)']);
    // Le toucher écrit un `false` explicite : la catégorie s'éteint sous le global allumé, et ses flux avec elle.
    fireEvent.click(sw('Summary', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ Tech: false });
    expect(state('Summary', 'Tech')).toBe('off');
    expect(sw('Summary', 'Tech').style.color).toBe('var(--list-summary)');
    fireEvent.click(screen.getByRole('button', { name: /^Tech/ }));
    expect(state('Summary', 'Flux 1')).toBe('off');
    // Traduire n'a pas de réglage global : sans valeur propre, la catégorie est éteinte, grise.
    expect(state('Translate', 'Tech')).toBe('off');
  });
  it('narrow layout: the stylesheet pins 32 px cells and 44 px rows, and no inline icon key remains', () => {
    render(<AiTab active />);
    expect(document.querySelector('.ai-routing [data-routing-key]')).toBeNull();
    // La feuille de style : jsdom ne la lit pas, on épingle donc le texte de la requête de conteneur.
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@container ai-routing (max-width: 419px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toContain('--cell: 32px;');
    expect(block).toContain('grid-template-columns: minmax(0, 1fr) repeat(3, var(--cell)) var(--cell);');
    expect(block).toContain('[data-routing-header] { display: none; }');
    expect(block).not.toContain('ai-routing__key');
    expect(block).toContain('[data-routing-row] { min-height: 44px; }');
    expect(block).toContain('.ai-routing__hit::before { inset: -6px -2px; }');
  });
  it('titles each switch with its column and state, each column word with what it does', () => {
    render(<AiTab active />);
    expect([sw('Summary', 'Tech'), sw('Translate', 'Tech'), sw('Panel', 'Tech')].map((s) => s.getAttribute('title'))).toEqual([
      'ai.routing.autoSummary — ai.routing.stateOff', 'ai.routing.autoTranslate — ai.routing.stateOff', 'ai.routing.panel — ai.routing.stateGlobal',
    ]);
    const header = document.querySelector('[data-routing-header]') as HTMLElement;
    expect(Array.from(header.children).slice(1, 4).map((c) => c.getAttribute('title'))).toEqual([
      'ai.routing.summaryTitle', 'ai.routing.translateTitle', 'ai.routing.panelTitle',
    ]);
  });
  it('key, part 1: a table of the four columns, with neutral icons (colour belongs to part 2)', () => {
    render(<AiTab active />);
    const box = document.querySelector('[data-routing-key]') as HTMLElement;
    const table = box.querySelector('table') as HTMLTableElement;
    expect(table.querySelector('thead')).toBeNull();
    const rows = Array.from(table.querySelectorAll('tr'));
    expect(rows.map((r) => r.querySelector('th')?.getAttribute('scope'))).toEqual(Array(4).fill('row'));
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual([
      'ai.routing.autoSummary', 'ai.routing.autoTranslate', 'ai.routing.keyPanelName', 'ai.routing.providerColumn',
    ]);
    expect(rows.map((r) => r.querySelectorAll('td')[1].textContent)).toEqual([
      'ai.routing.keySummary', 'ai.routing.keyTranslate', 'ai.routing.keyPanel', 'ai.routing.keyProvider',
    ]);
    // Icônes neutres : ni fond ni contour d'accent, la couleur d'état ne se lit que dans la deuxième partie.
    for (const r of rows) {
      const icon = r.querySelector('td > [aria-hidden="true"]') as HTMLElement;
      expect(icon.querySelector('svg')).toBeTruthy();
      expect(icon.getAttribute('style') ?? '').not.toContain('--accent');
      expect(icon.style.color).toBe('var(--list-title)');
    }
    // Un filet entre les lignes, aucun au-dessus de la première.
    const rule = (r: HTMLElement) => ((r.firstElementChild as HTMLElement).className.match(/\bborder-t\b/) ?? [''])[0];
    expect(rows.map(rule)).toEqual(['', 'border-t', 'border-t', 'border-t']);
    expect(table.className).toContain('text-[13px]');
    expect(screen.queryByText('ai.routing.hint')).toBeNull();
    expect(screen.queryByText('ai.routing.legend')).toBeNull();
  });
  it('key, part 2: a separate tinted band with the three button states side by side, then the precedence line', () => {
    render(<AiTab active />);
    const box = document.querySelector('[data-routing-key]') as HTMLElement;
    const band = box.querySelector('[data-routing-states]') as HTMLElement;
    expect(band).toBeTruthy();
    // Hors du tableau, sur un fond à part, sous un filet : une mise en page différente de la première partie.
    expect(band.closest('table')).toBeNull();
    expect(band.style.background).toBe('var(--panel-header-bg)');
    expect(band.style.borderTop).toContain('var(--panel-border)');
    expect(band.querySelector('[data-routing-states-title]')?.textContent).toBe('ai.routing.keyStatesTitle');
    const items = Array.from(band.querySelectorAll('[data-routing-state]')) as HTMLElement[];
    expect(items.map((i) => i.dataset.routingState)).toEqual(['on', 'inherited', 'off']);
    expect(items.map((i) => i.querySelector('strong')?.textContent)).toEqual([
      'ai.routing.keySet', 'ai.routing.keyInherited', 'ai.routing.keyOff',
    ]);
    expect(items.map((i) => i.querySelector('p')?.textContent)).toEqual([
      'ai.routing.keySetText', 'ai.routing.keyInheritedText', 'ai.routing.keyOffText',
    ]);
    // Les échantillons sont dessinés par le code des interrupteurs.
    const samples = items.map((i) => i.querySelector('[aria-hidden="true"]') as HTMLElement);
    expect(samples[0].style.background).toBe('var(--accent)');
    expect(samples[1].style.boxShadow).toContain('1.5px var(--accent)');
    expect(samples[2].style.boxShadow).toContain('var(--panel-border)');
    expect(band.className).toContain('ai-routing__states');
    // La phrase de priorité ferme la bande.
    const last = band.lastElementChild as HTMLElement;
    expect(last.textContent).toBe('ai.routing.keyPrecedence');
  });
  it('every switch is described by the key box', () => {
    render(<AiTab active />);
    const box = document.querySelector('[data-routing-key]') as HTMLElement;
    expect(box.id).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^ai\.routing\.uncategorised/ }));
    const switches = screen.getAllByRole('switch').filter((s) => /^ai\.routing\.(auto|panel)/.test(s.getAttribute('aria-label') ?? ''));
    // Tech (catégorie) + Flux 3 (sans catégorie) : deux lignes, trois interrupteurs chacune.
    expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'ai.routing.autoSummaryFor:Tech', 'ai.routing.autoTranslateFor:Tech', 'ai.routing.panelFor:Tech',
      'ai.routing.autoSummaryFor:Flux 3', 'ai.routing.autoTranslateFor:Flux 3', 'ai.routing.panelFor:Flux 3',
    ]);
    for (const s of switches) expect(s.getAttribute('aria-describedby')).toBe(box.id);
  });
  it('with a mouse: 32 px cells, no enlarged hit area', () => {
    render(<AiTab active />);
    const grid = document.querySelector('[data-routing-grid]') as HTMLElement;
    // `--cell` vit dans la feuille de style (32 px, 40 px sous `data-touch`).
    expect(grid.hasAttribute('data-touch')).toBe(false);
    expect(sw('Summary', 'Tech').className).not.toContain('before:');
  });
  it('on touch: 40 px cells with a 44 px hit area, and the provider list in a bottom sheet', () => {
    useUiStore.setState({ layoutMode: 'mobile' });
    render(<AiTab active />);
    const grid = document.querySelector('[data-routing-grid]') as HTMLElement;
    expect(grid.hasAttribute('data-touch')).toBe(true);
    // 40 px visibles, 2 px de pseudo-élément de part et d'autre : 44 px au doigt.
    // `ai-routing__hit` : à l'étroit, la feuille de style la passe à 44 px de haut sur 36 de large.
    for (const el of [sw('Summary', 'Tech'), providerBtn('Tech', true)]) {
      expect(el.className).toContain('before:absolute');
      expect(el.className).toContain('before:-inset-0.5');
      expect(el.classList.contains('ai-routing__hit')).toBe(true);
    }
    // Les mêmes bandes gardent 44 px de haut (`prefs-tap-row`) pour le bouton de dépli.
    expect(screen.getByRole('button', { name: /^Tech/ }).classList.contains('prefs-tap-row')).toBe(true);
    const button = providerBtn('Tech', true);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'ai.routing.categoryProviderFor:Tech' });
    expect(within(sheet).getByRole('button', { name: 'ai.routing.default' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ollama' }));
    expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('AiTab — « Mes clés »', () => {
  const provider = (id: number, name: string, hasUserKey = false): AiProviderView =>
    ({ id, name, type: 'openai', hasAdminKey: false, shared: false, hasUserKey, available: hasUserKey });
  const config = (providers: AiProviderView[], userKeysAllowed = true): AiConfig =>
    ({ enabled: true, providers, userKeysAllowed, dailyCap: 0, usageToday: 0, defaultProvider: null });
  beforeEach(() => {
    useAuthStore.setState({ backendUser: user });
    // Le rechargement à l'affichage reste en attente ; celui qui suit un
    // enregistrement répond.
    vi.mocked(getAiConfig)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(config([provider(1, 'Claude', true), provider(2, 'Ollama')]));
    useAiStore.setState({ config: config([provider(1, 'Claude'), provider(2, 'Ollama')]) });
  });
  afterEach(() => useAiStore.setState({ config: null }));
  // Le rechargement à l'affichage est oublié : les assertions sur `getAiConfig`
  // ne portent que sur celui qui suit l'enregistrement ou l'effacement.
  const renderTab = () => { const r = render(<AiTab active />); vi.mocked(getAiConfig).mockClear(); return r; };

  it('is absent while personal keys are not allowed', () => {
    useAiStore.setState({ config: config([provider(1, 'Claude')], false) });
    const { queryByText } = renderTab();
    expect(queryByText('ai.keys.title')).toBeNull();
  });
  it('shows one row per provider, with its state and a password field', () => {
    useAiStore.setState({ config: config([provider(1, 'Claude', true), provider(2, 'Ollama')]) });
    const { getByText, getAllByLabelText, getAllByText, queryAllByRole } = renderTab();
    expect(getByText('ai.keys.title')).toBeTruthy();
    expect(getByText('ai.keys.hint')).toBeTruthy();
    expect(getAllByText('ai.keys.set')).toHaveLength(1);
    expect(getAllByText('ai.keys.none')).toHaveLength(1);
    const fields = getAllByLabelText('ai.keys.field') as HTMLInputElement[];
    expect(fields).toHaveLength(2);
    for (const f of fields) {
      expect([f.type, f.autocomplete, f.value]).toEqual(['password', 'new-password', '']);
    }
    // « Effacer » n'existe que sur la ligne qui a une clé.
    expect(queryAllByRole('button', { name: 'ai.keys.clear' })).toHaveLength(1);
  });
  it('keeps « Enregistrer » disabled while the field is empty', () => {
    const { getAllByRole } = renderTab();
    for (const b of getAllByRole('button', { name: 'ai.keys.save' }) as HTMLButtonElement[]) expect(b.disabled).toBe(true);
  });
  it('saves a typed key, empties the field and reloads the config', async () => {
    vi.mocked(setAiUserKey).mockResolvedValue({ ok: true, hasUserKey: true });
    const { getAllByLabelText, getAllByRole, findByRole, queryByDisplayValue } = renderTab();
    fireEvent.change(getAllByLabelText('ai.keys.field')[0], { target: { value: 'sk-mine' } });
    fireEvent.click(getAllByRole('button', { name: 'ai.keys.save' })[0]);
    await waitFor(() => expect(setAiUserKey).toHaveBeenCalledWith(1, 'sk-mine'));
    expect(((await findByRole('status')).textContent)).toBe('ai.keys.saved');
    expect((getAllByLabelText('ai.keys.field')[0] as HTMLInputElement).value).toBe('');
    expect(getAiConfig).toHaveBeenCalled();
    // La clé tapée n'est répétée nulle part.
    expect(queryByDisplayValue('sk-mine')).toBeNull();
    expect(document.body.textContent).not.toContain('sk-mine');
  });
  it('keeps what was typed in another row while one row saves', async () => {
    vi.mocked(setAiUserKey).mockResolvedValue({ ok: true, hasUserKey: true });
    const { getAllByLabelText, getAllByRole } = renderTab();
    fireEvent.change(getAllByLabelText('ai.keys.field')[0], { target: { value: 'sk-one' } });
    fireEvent.change(getAllByLabelText('ai.keys.field')[1], { target: { value: 'sk-two' } });
    fireEvent.click(getAllByRole('button', { name: 'ai.keys.save' })[0]);
    await waitFor(() => expect(setAiUserKey).toHaveBeenCalledWith(1, 'sk-one'));
    await waitFor(() => expect((getAllByLabelText('ai.keys.field')[0] as HTMLInputElement).value).toBe(''));
    expect((getAllByLabelText('ai.keys.field')[1] as HTMLInputElement).value).toBe('sk-two');
  });
  it('disables the row buttons while its request is in flight', async () => {
    useAiStore.setState({ config: config([provider(1, 'Claude', true), provider(2, 'Ollama')]) });
    let done: (v: { ok: true; hasUserKey: boolean }) => void = () => {};
    vi.mocked(setAiUserKey).mockReturnValue(new Promise((r) => { done = r; }));
    const { getAllByLabelText, getAllByRole } = renderTab();
    fireEvent.change(getAllByLabelText('ai.keys.field')[0], { target: { value: 'sk-mine' } });
    fireEvent.click(getAllByRole('button', { name: 'ai.keys.save' })[0]);
    expect((getAllByRole('button', { name: 'ai.keys.save' })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((getAllByRole('button', { name: 'ai.keys.clear' })[0] as HTMLButtonElement).disabled).toBe(true);
    done({ ok: true, hasUserKey: true });
    await waitFor(() => expect(getAiConfig).toHaveBeenCalled());
  });
  it('clears a saved key', async () => {
    useAiStore.setState({ config: config([provider(1, 'Claude', true)]) });
    vi.mocked(setAiUserKey).mockResolvedValue({ ok: true, hasUserKey: false });
    const { getByRole, findByRole } = renderTab();
    fireEvent.click(getByRole('button', { name: 'ai.keys.clear' }));
    await waitFor(() => expect(setAiUserKey).toHaveBeenCalledWith(1, null));
    expect((await findByRole('status')).textContent).toBe('ai.keys.cleared');
    expect(getAiConfig).toHaveBeenCalled();
  });
  it('says so when saving fails, and keeps the typed key for a retry', async () => {
    vi.mocked(setAiUserKey).mockRejectedValue(new Error('boom'));
    const { getAllByLabelText, getAllByRole, findByRole } = renderTab();
    fireEvent.change(getAllByLabelText('ai.keys.field')[0], { target: { value: 'sk-mine' } });
    fireEvent.click(getAllByRole('button', { name: 'ai.keys.save' })[0]);
    const alert = await findByRole('alert');
    expect(alert.textContent).toBe('ai.keys.error');
    expect((getAllByLabelText('ai.keys.field')[0] as HTMLInputElement).value).toBe('sk-mine');
    expect(getAiConfig).not.toHaveBeenCalled();
  });
});
