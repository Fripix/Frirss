// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(),
}));
import { getAiProviders, createAiProvider, updateAiProvider, deleteAiProvider, updateAiSettings, testAiProvider, reorderAiProviders } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import AiTab from './AiTab';

const admin = { id: 1, username: 'root', role: 'admin' as const };
const user = { id: 2, username: 'alice', role: 'user' as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAiProviders).mockResolvedValue({ providers: [], settings: { enabled: false, userKeysAllowed: false, dailyCap: 50, defaultProvider: null } });
});
afterEach(cleanup);

describe('AiTab', () => {
  it('a plain user sees the intro, never the providers block', async () => {
    useAuthStore.setState({ backendUser: user });
    const { findByText, queryByText } = render(<AiTab active />);
    expect(await findByText('ai.userIntro')).toBeTruthy();
    expect(queryByText('ai.admin.title')).toBeNull();
    expect(getAiProviders).not.toHaveBeenCalled();
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
    vi.mocked(testAiProvider).mockResolvedValue({ ok: false, kind: 'auth', message: 'HTTP 401' });
    const { findByRole, findByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: /ai\.admin\.test/ }));
    expect(await findByText('ai.admin.testFailed')).toBeTruthy();
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
