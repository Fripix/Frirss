// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(),
}));
import { getAiProviders, createAiProvider, updateAiSettings, testAiProvider, reorderAiProviders } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import AiTab from './AiTab';

const admin = { id: 1, username: 'root', role: 'admin' as const };
const user = { id: 2, username: 'alice', role: 'user' as const };
beforeEach(() => {
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
    fireEvent.click(await findByRole('button', { name: 'ai.admin.save' }));
    await waitFor(() => expect(createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ollama', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3' })));
    expect(await findByText('Ollama')).toBeTruthy();
    expect((getByLabelText('ai.admin.key') as HTMLInputElement).value).toBe('');
  });
  it('the test button reports the outcome', async () => {
    useAuthStore.setState({ backendUser: admin });
    vi.mocked(getAiProviders).mockResolvedValue({ providers: [{ id: 7, name: 'Ollama', type: 'openai', baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: false, position: 0 }], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
    vi.mocked(testAiProvider).mockResolvedValue({ ok: false, kind: 'auth', message: 'HTTP 401' });
    const { findByRole, findByText } = render(<AiTab active />);
    fireEvent.click(await findByRole('button', { name: 'ai.admin.test' }));
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
});
