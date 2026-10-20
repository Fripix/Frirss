// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }) }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(), listAiModels: vi.fn(),
}));
import { getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, updateAiSettings, testAiProvider, reorderAiProviders, listAiModels } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import AiTab from './AiTab';

const admin = { id: 1, username: 'root', role: 'admin' as const };
const user = { id: 2, username: 'alice', role: 'user' as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAiProviders).mockResolvedValue({ providers: [], settings: { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
});
afterEach(cleanup);

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
