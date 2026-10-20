// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within, screen } from '@testing-library/react';
// Le nom passé à ces clés est ce que l'on vérifie : il est rendu après la clé.
const NAMED = new Set(['ai.user.preferredDefault', 'ai.translation.uiLanguage', 'ai.routing.autoSummaryFor', 'ai.routing.autoTranslateFor']);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (NAMED.has(k) ? `${k}:${String(o?.name)}` : k), i18n: { language: 'fr' } }) }));
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
  it('the admin sees « Résumés » above « Fournisseurs »', async () => {
    useAuthStore.setState({ backendUser: admin });
    const { findByText, getByText, queryByText } = render(<AiTab active />);
    const providers = await findByText('ai.admin.title');
    const summaries = getByText('ai.user.title');
    expect(summaries.compareDocumentPosition(providers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queryByText('ai.userIntro')).toBeNull();
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
  it('a new provider is not shared until the admin ticks it: sharing a paid key is deliberate', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(createAiProvider).mockResolvedValue({ id: 8, name: 'GPT', type: 'openai', baseUrl: 'https://api.example.com', model: 'm', hasAdminKey: true, shared: false, position: 0 });
    const { findByRole, getByLabelText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.add' }));
    expect((getByLabelText('ai.admin.shared') as HTMLInputElement).checked).toBe(false);
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
    const { findByRole, getByLabelText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.advanced/ }));
    const cap = getByLabelText('ai.admin.dailyCap') as HTMLInputElement;
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
  it('the key badge sits outside the truncated line, after the model, so a narrow screen still shows it', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [{ id: 7, name: 'GPT', type: 'openai', baseUrl: 'https://api.example.com', model: 'gpt-6-sol', hasAdminKey: true, shared: true, position: 0 }], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    const { findByText, getByText } = render(<AiTab active />);
    const badge = await findByText('ai.admin.keySet');
    expect(badge.closest('.truncate')).toBeNull();
    const line = getByText((_, el) => el?.classList.contains('truncate') === true && el.textContent === 'gpt-6-sol / ai.admin.typeOpenai');
    expect(line.getAttribute('title')).toBe('gpt-6-sol / ai.admin.typeOpenai');
  });

  it('reordering sends the full id list; the default provider goes out as a number', async () => {
    useAuthStore.setState({ backendUser: admin });
    const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: true, position });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(3, 'A', 0), mk(5, 'B', 1), mk(9, 'C', 2)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
    vi.mocked(reorderAiProviders).mockResolvedValue();
    vi.mocked(updateAiSettings).mockResolvedValue();
    const { findAllByRole, findByLabelText } = render(<AiTab active />);
    fireEvent.click((await findAllByRole('button', { name: 'ai.admin.moveDown' }))[0]);
    await waitFor(() => expect(reorderAiProviders).toHaveBeenCalledWith([5, 3, 9]));
    fireEvent.change(await findByLabelText('ai.admin.defaultProvider'), { target: { value: '9' } });
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
  it('deleting asks first, then removes the provider and falls back to « none »', async () => {
    useAuthStore.setState({ backendUser: admin });
    const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: true, position });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(7, 'Ollama', 0), mk(8, 'Other', 1)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(deleteAiProvider).mockResolvedValue();
    const { findAllByRole, findByRole, getByLabelText, queryByText } = render(<AiTab active />);
    expect((await findByRole('button', { name: 'ai.admin.delete — Ollama' }))).toBeTruthy();
    expect((getByLabelText('ai.admin.defaultProvider') as HTMLSelectElement).value).toBe('7');
    fireEvent.click(await findByRole('button', { name: 'ai.admin.delete — Ollama' }));
    expect(deleteAiProvider).not.toHaveBeenCalled();
    const dialog = await findByRole('dialog');
    // La boîte ignore les validations pendant sa période de grâce : on réessaie.
    await waitFor(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ai.admin.delete' }));
      expect(deleteAiProvider).toHaveBeenCalledWith(7);
    });
    await waitFor(() => expect(queryByText('Ollama')).toBeNull());
    expect((getByLabelText('ai.admin.defaultProvider') as HTMLSelectElement).value).toBe('');
    expect((await findAllByRole('option', { name: 'ai.admin.none' })).length).toBe(1);
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
    useUiStore.setState({ aiPreferredProvider: null, aiFallback: true, aiAutoSummary: false, aiAutoSummaryConfirmed: false });
    setConfig();
  });
  afterEach(() => {
    useAiStore.setState({ config: null });
    useUiStore.setState({ aiPreferredProvider: null, aiFallback: true, aiAutoSummary: false, aiAutoSummaryConfirmed: false });
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
    fireEvent.click(sw);
    expect(useUiStore.getState().aiFallback).toBe(false);
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
  const provider = (id: number, name: string): AiProviderView =>
    ({ id, name, type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available: true });
  const reset = () => {
    useUiStore.setState({
      aiCategoryProviders: {}, feedSettings: {}, aiCategoryAutoTranslate: {}, aiCategoryAutoSummary: {},
      aiAutoSummary: false, aiAutoSummaryConfirmed: false, aiAutoTranslateConfirmed: false,
    });
    useFeedStore.setState({ subscriptions: [] });
  };
  const sw = (kind: 'Summary' | 'Translate', name: string) => screen.getByRole('switch', { name: `ai.routing.auto${kind}For:${name}` });
  const checked = (kind: 'Summary' | 'Translate', name: string) => sw(kind, name).getAttribute('aria-checked');
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

  it('lists categories collapsed, with the number of tuned feeds, and sets a category provider', () => {
    useUiStore.setState({ feedSettings: { 'feed/2': { aiProvider: 1 } } });
    const { getByRole, getByText, getByLabelText, queryAllByLabelText } = render(<AiTab active />);
    expect(getByText('ai.routing.title')).toBeTruthy();
    expect(getByText('ai.routing.hint')).toBeTruthy();
    const toggle = getByRole('button', { name: /Tech/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(getByText('ai.routing.overrides')).toBeTruthy();
    // Replié : seul le sélecteur de la catégorie est là, aucun sélecteur de flux.
    expect(queryAllByLabelText('ai.routing.feedSelect')).toHaveLength(0);
    fireEvent.change(getByLabelText('ai.routing.categorySelect'), { target: { value: '1' } });
    expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 1 });
    fireEvent.change(getByLabelText('ai.routing.categorySelect'), { target: { value: '' } });
    expect(useUiStore.getState().aiCategoryProviders).toEqual({});
  });
  it('a feed provider is set and set back to default from the expanded category', () => {
    const { getByRole, getAllByLabelText } = render(<AiTab active />);
    const toggle = getByRole('button', { name: /Tech/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).toBeTruthy();
    const feedSelects = getAllByLabelText('ai.routing.feedSelect') as HTMLSelectElement[];
    expect(feedSelects).toHaveLength(2);
    expect(feedSelects[0].options[0].textContent).toBe('ai.routing.default');
    fireEvent.change(feedSelects[0], { target: { value: '1' } });
    expect(useUiStore.getState().feedSettings['feed/1'].aiProvider).toBe(1);
    fireEvent.change(feedSelects[0], { target: { value: '' } });
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });
  it('keeps feeds without a category reachable, in their own group without a group selector', () => {
    useFeedStore.setState({ subscriptions: [sub(3)] });
    const { getByRole, getAllByLabelText, queryAllByLabelText } = render(<AiTab active />);
    expect(queryAllByLabelText('ai.routing.categorySelect')).toHaveLength(0);
    const toggle = getByRole('button', { name: /ai\.routing\.uncategorised/ });
    expect(queryAllByLabelText('ai.routing.feedSelect')).toHaveLength(0);
    fireEvent.click(toggle);
    const selects = getAllByLabelText('ai.routing.feedSelect');
    expect(selects).toHaveLength(1);
    fireEvent.change(selects[0], { target: { value: '1' } });
    expect(useUiStore.getState().feedSettings['feed/3'].aiProvider).toBe(1);
  });
  it('shows a deleted provider as such', () => {
    useUiStore.setState({ aiCategoryProviders: { Tech: 42 } });
    const { getByLabelText } = render(<AiTab active />);
    const select = getByLabelText('ai.routing.categorySelect') as HTMLSelectElement;
    expect(select.value).toBe('42');
    expect(select.selectedOptions[0].textContent).toBe('ai.user.removedProvider');
  });
  it('lets a long unbroken feed name wrap anywhere instead of pushing the select out', () => {
    const url = 'https://example.com/a-very-long-feed-address-without-any-space/feed.xml';
    useFeedStore.setState({ subscriptions: [{ ...sub(1, [cat('Tech')]), title: url }] });
    const { getByRole, getByText } = render(<AiTab active />);
    fireEvent.click(getByRole('button', { name: /Tech/ }));
    // jsdom n'a pas de mise en page : on fige la classe qui permet de rétrécir, et l'absence de flex
    // (un conteneur flex rendrait le texte en élément flex anonyme, qui ne rétrécit pas sous son mot le plus long).
    const name = getByText(url);
    expect(name.className).toContain('[overflow-wrap:anywhere]');
    expect(name.className).toContain('min-w-0');
    expect(name.className).not.toMatch(/(^|\s)(flex|inline-flex)(\s|$)/);
  });
  it('reads a category named like an Object property as unset, and ignores a corrupt feed value', () => {
    useFeedStore.setState({ subscriptions: [sub(1, [cat('constructor')]), sub(2, [cat('Tech')])] });
    useUiStore.setState({ feedSettings: { 'feed/2': { aiProvider: '3' as unknown as number } } });
    const { getAllByLabelText, getAllByRole, queryByText } = render(<AiTab active />);
    for (const s of getAllByLabelText('ai.routing.categorySelect') as HTMLSelectElement[]) expect(s.value).toBe('');
    expect(queryByText('ai.routing.overrides')).toBeNull();
    fireEvent.click(getAllByRole('button', { name: /Tech/ })[0]);
    expect((getAllByLabelText('ai.routing.feedSelect')[0] as HTMLSelectElement).value).toBe('');
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
    // Éteindre ne demande rien.
    fireEvent.click(sw('Translate', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({ Science: true });
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
    fireEvent.click(screen.getByRole('button', { name: /Tech/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Tech/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Tech/ }));
    expect(checked('Summary', 'Flux 1')).toBe('true');
    fireEvent.click(sw('Summary', 'Tech'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ Tech: true });
  });
  it('every switch is described by the shared hint; the uncategorised group has none of its own', () => {
    const { getByText, getAllByRole } = render(<AiTab active />);
    const hint = getByText('ai.routing.autoHint');
    fireEvent.click(screen.getByRole('button', { name: /ai\.routing\.uncategorised/ }));
    const switches = getAllByRole('switch').filter((s) => /^ai\.routing\.auto/.test(s.getAttribute('aria-label') ?? ''));
    // Tech (catégorie) + Flux 3 (sans catégorie) : deux lignes, deux interrupteurs chacune.
    expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'ai.routing.autoSummaryFor:Tech', 'ai.routing.autoTranslateFor:Tech',
      'ai.routing.autoSummaryFor:Flux 3', 'ai.routing.autoTranslateFor:Flux 3',
    ]);
    for (const s of switches) expect(s.getAttribute('aria-describedby')).toBe(hint.id);
  });
  it('the visible word toggles its switch too, exactly once', () => {
    useUiStore.setState({ aiAutoSummary: true });
    const { getAllByText } = render(<AiTab active />);
    fireEvent.click(getAllByText('ai.routing.autoSummary')[0]);
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ Tech: true });
    fireEvent.click(sw('Summary', 'Tech'));
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({});
  });
  it('lets the switch pair wrap under the select on a narrow screen', () => {
    render(<AiTab active />);
    // jsdom n'a pas de mise en page : on fige les classes qui produisent le retour à la ligne
    // (ligne en flex-wrap, nom avec une base de 40 %, paire poussée à droite).
    const pair = sw('Translate', 'Tech').closest('[data-auto-switches]') as HTMLElement;
    expect(pair).toBeTruthy();
    expect(pair.className).toContain('ml-auto');
    const row = pair.parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.querySelector('select')).toBeTruthy();
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
