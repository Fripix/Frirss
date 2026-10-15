// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }) }));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn() }));
vi.mock('../../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)), listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()), subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()), queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useAiStore } from '../../stores/aiStore';
import { requestAiSummary } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';

const article = (id: string) => ({
  id, title: 'Titre ' + id, summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>' + 'mot '.repeat(60) + '</p>', url: 'https://example.com/' + id,
  published: Date.now(), read: false, starred: false, labels: [],
} as unknown as Article);
const ON = { enabled: true, providers: [{ id: 1, name: 'Ollama', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true }], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };

beforeEach(() => {
  useFeedStore.setState({ selectedArticle: article('a1'), articles: [article('a1'), article('a2')] });
  useAiStore.setState({ config: ON });
  useAuthStore.setState({ backendUser: { id: 2, username: 'u', role: 'user' } as never });
  vi.mocked(requestAiSummary).mockReset();
});
const httpError = (status: number, data: unknown) =>
  Object.assign(new Error('http ' + status), { isAxiosError: true, response: { status, data } });
afterEach(cleanup);

describe('ReadingPane — Résumé IA', () => {
  it('shows no chip when the feature is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false, providers: [] } });
    const { queryByRole } = render(<ReadingPane />);
    expect(queryByRole('button', { name: 'ai.summarize' })).toBeNull();
  });
  it('requests a summary with the article id, title and html, then shows it', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1', title: 'Titre a1', html: expect.stringContaining('mot') }));
    expect(await findByText('Le résumé.')).toBeTruthy();
  });
  it('ignores a summary that arrives after the article changed', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(requestAiSummary).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { getByRole, queryByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    await act(async () => { resolve({ text: 'Résumé de a1', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false }); });
    await waitFor(() => expect(queryByText('Résumé de a1')).toBeNull());
  });
  it('shows no chip when no provider is available to this user', () => {
    useAiStore.setState({ config: { ...ON, providers: [{ ...ON.providers[0], available: false }] } });
    const { queryByRole } = render(<ReadingPane />);
    expect(queryByRole('button', { name: 'ai.summarize' })).toBeNull();
  });
  it('strips images and data: URIs from the html it sends', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    const withMedia = { ...article('a1'), content: '<p>' + 'mot '.repeat(60) + '</p><img src="data:image/png;base64,AAAA"><svg><path/></svg>' } as Article;
    useFeedStore.setState({ selectedArticle: withMedia, articles: [withMedia] });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    const sent = vi.mocked(requestAiSummary).mock.calls[0][0].html;
    expect(sent).toContain('mot');
    expect(sent).not.toContain('<img');
    expect(sent).not.toContain('<svg');
    expect(sent).not.toContain('data:');
  });
  it('maps 400 invalid_body to "too long"', async () => {
    vi.mocked(requestAiSummary).mockRejectedValue(httpError(400, { error: 'invalid_body' }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(await findByText('ai.errors.tooLong')).toBeTruthy();
  });
  it('maps a 429 without ai_daily_cap to "rate limited", and the cap to "cap"', async () => {
    vi.mocked(requestAiSummary).mockRejectedValueOnce(httpError(429, { error: 'Too many requests' }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(await findByText('ai.errors.rateLimited')).toBeTruthy();
    vi.mocked(requestAiSummary).mockRejectedValueOnce(httpError(429, { error: 'ai_daily_cap', cap: 5 }));
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(await findByText('ai.errors.cap')).toBeTruthy();
  });
  it('tells a plain user to warn the admin about a rejected key, and the admin to check it', async () => {
    vi.mocked(requestAiSummary).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'auth' }));
    const user = render(<ReadingPane />);
    fireEvent.click(user.getByRole('button', { name: 'ai.summarize' }));
    expect(await user.findByText('ai.errors.authUser')).toBeTruthy();
    user.unmount();
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin' } as never });
    const admin = render(<ReadingPane />);
    fireEvent.click(admin.getByRole('button', { name: 'ai.summarize' }));
    expect(await admin.findByText('ai.errors.auth')).toBeTruthy();
  });
  it('keeps the summary on screen when a later attempt fails', async () => {
    vi.mocked(requestAiSummary)
      .mockResolvedValueOnce({ text: 'Premier résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false })
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical' }));
    const { getByRole, findByText, getByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarize' }));
    expect(await findByText('Premier résumé.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(getByRole('menuitem', { name: 'Ollama' }));
    expect(await findByText('ai.errors.technical')).toBeTruthy();
    expect(getByText('Premier résumé.')).toBeTruthy();
  });
  it('disables the chip when the browser goes offline', async () => {
    const { getByRole } = render(<ReadingPane />);
    const chip = () => getByRole('button', { name: 'ai.summarize' }) as HTMLButtonElement;
    expect(chip().disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(chip().disabled).toBe(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(chip().disabled).toBe(false);
  });
});
