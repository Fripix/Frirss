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
vi.mock('../../utils/extractContent', () => ({ extractFullContent: vi.fn() }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useAiStore } from '../../stores/aiStore';
import { requestAiSummary } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { extractFullContent } from '../../utils/extractContent';
import { putExtract } from '../../lib/extractCache';

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
  useUiStore.setState({
    aiPanelCollapsed: false, aiPanelAutoExpanded: false, aiSummaryRatio: 20, aiAutoSummary: false,
    autoExtractDefault: false,
    feedSettings: {}, aiCategoryProviders: {}, aiPreferredProvider: null, aiFallback: true,
  });
  useFeedStore.setState({ subscriptions: [] });
  vi.mocked(requestAiSummary).mockReset();
  vi.mocked(extractFullContent).mockReset();
});
const httpError = (status: number, data: unknown) =>
  Object.assign(new Error('http ' + status), { isAxiosError: true, response: { status, data } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ReadingPane — Résumé IA', () => {
  it('shows no panel when the feature is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false, providers: [] } });
    const { queryByRole } = render(<ReadingPane />);
    expect(queryByRole('button', { name: /^ai\.summarize/ })).toBeNull();
  });
  it('requests a summary with the article id, title and html, then shows it', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1', title: 'Titre a1', html: expect.stringContaining('mot') }));
    expect(await findByText('Le résumé.')).toBeTruthy();
  });
  it('sends the length ratio chosen in the preferences', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    useUiStore.setState({ aiSummaryRatio: 35 });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ ratio: 35 }));
  });
  it('sends the routing stages and the fallback choice with the request', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] }] } as never);
    useUiStore.setState({ feedSettings: { 'feed/1': { aiProvider: 3 } }, aiCategoryProviders: { Tech: 1 }, aiPreferredProvider: 1, aiFallback: false });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ feedProvider: 3, categoryProvider: 1, preferredProvider: 1, fallback: false }));
  });
  it('sends no feed provider for a stored value that is not a valid id', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [] }] } as never);
    useUiStore.setState({ feedSettings: { 'feed/1': { aiProvider: '3' } } as never });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(vi.mocked(requestAiSummary).mock.calls[0][0]).not.toHaveProperty('feedProvider');
  });
  it('sends no category provider for a category named after an Object.prototype member', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/constructor', label: 'constructor' }] }] } as never);
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(vi.mocked(requestAiSummary).mock.calls[0][0]).not.toHaveProperty('categoryProvider');
  });
  it('shows the panel above the article, with its status, while nothing was requested', () => {
    const { getByRole, getByText } = render(<ReadingPane />);
    expect(getByRole('button', { name: /^ai\.summarize\s/ }).getAttribute('aria-expanded')).toBe('true');
    expect(getByText('ai.status.none')).toBeTruthy();
    expect(getByText('ai.hint')).toBeTruthy();
  });
  it('keeps the panel folded on the next article when the user folded it', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText, queryByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('Le résumé.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /^ai\.summarize\s/ }));
    expect(queryByText('Le résumé.')).toBeNull();
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    expect(getByRole('button', { name: /^ai\.summarize\s/ }).getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('ai.hint')).toBeNull();
  });
  it('ignores a summary that arrives after the article changed', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(requestAiSummary).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { getByRole, queryByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    await act(async () => { resolve({ text: 'Résumé de a1', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false }); });
    await waitFor(() => expect(queryByText('Résumé de a1')).toBeNull());
  });
  it('shows no panel when no provider is available to this user', () => {
    useAiStore.setState({ config: { ...ON, providers: [{ ...ON.providers[0], available: false }] } });
    const { queryByRole } = render(<ReadingPane />);
    expect(queryByRole('button', { name: /^ai\.summarize/ })).toBeNull();
  });
  it('strips images and data: URIs from the html it sends', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    const withMedia = { ...article('a1'), content: '<p>' + 'mot '.repeat(60) + '</p><img src="data:image/png;base64,AAAA"><svg><path/></svg>' } as Article;
    useFeedStore.setState({ selectedArticle: withMedia, articles: [withMedia] });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    const sent = vi.mocked(requestAiSummary).mock.calls[0][0].html;
    expect(sent).toContain('mot');
    expect(sent).not.toContain('<img');
    expect(sent).not.toContain('<svg');
    expect(sent).not.toContain('data:');
  });
  it('maps 400 invalid_body to "too long"', async () => {
    vi.mocked(requestAiSummary).mockRejectedValue(httpError(400, { error: 'invalid_body' }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('ai.errors.tooLong')).toBeTruthy();
  });
  it('maps a 429 without ai_daily_cap to "rate limited", and the cap to "cap"', async () => {
    vi.mocked(requestAiSummary).mockRejectedValueOnce(httpError(429, { error: 'Too many requests' }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('ai.errors.rateLimited')).toBeTruthy();
    vi.mocked(requestAiSummary).mockRejectedValueOnce(httpError(429, { error: 'ai_daily_cap', cap: 5 }));
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('ai.errors.cap')).toBeTruthy();
  });
  it('tells a plain user to warn the admin about a rejected key, and the admin to check it', async () => {
    vi.mocked(requestAiSummary).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'auth' }));
    const user = render(<ReadingPane />);
    fireEvent.click(user.getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await user.findByText('ai.errors.authUser')).toBeTruthy();
    user.unmount();
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin' } as never });
    const admin = render(<ReadingPane />);
    fireEvent.click(admin.getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await admin.findByText('ai.errors.auth')).toBeTruthy();
  });
  it('keeps the summary on screen when a later attempt fails', async () => {
    vi.mocked(requestAiSummary)
      .mockResolvedValueOnce({ text: 'Premier résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false })
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical' }));
    const { getByRole, findByText, getByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('Premier résumé.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(getByRole('menuitem', { name: 'Ollama' }));
    expect(await findByText('ai.errors.technical')).toBeTruthy();
    expect(getByText('Premier résumé.')).toBeTruthy();
  });
  it('disables the action when the browser goes offline', async () => {
    const { getByRole } = render(<ReadingPane />);
    const action = () => getByRole('button', { name: 'ai.summarizeAction' }) as HTMLButtonElement;
    expect(action().disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(action().disabled).toBe(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(action().disabled).toBe(false);
  });
  describe('automatic summary on open', () => {
    const RESULT = { text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false };
    const extracted = (content: string) => ({ title: 't', content, excerpt: '', byline: '', siteName: '', length: content.length });
    // L'extraction automatique s'applique à ce flux ; chaque test d'extraction a
    // son propre id, car le cache d'extraction est en mémoire pour tout le fichier.
    const withAutoExtract = (id: string) => {
      const a = article(id);
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      useUiStore.setState({ aiAutoSummary: true, feedSettings: { 'feed/1': { autoExtract: true } } as never });
    };
    // Le résumé automatique attend une seconde sur l'article avant de partir.
    // Horloge simulée qui suit aussi le temps réel : `waitFor` et les attentes
    // des tests continuent de fonctionner ; `passDelay` saute la seconde.
    const AUTO_DELAY = 1000;
    const passDelay = () => act(async () => { await vi.advanceTimersByTimeAsync(AUTO_DELAY); });
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
    afterEach(() => { vi.useRealTimers(); });

    it('summarises on open when auto-summary is on', async () => {
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { findByText } = render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1' }));
      expect(await findByText('Le résumé.')).toBeTruthy();
    });
    it('does nothing on open when auto-summary is off', async () => {
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does nothing on open when the browser is offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does nothing on open when no provider is usable', async () => {
      useAiStore.setState({ config: { ...ON, providers: [{ ...ON.providers[0], available: false }] } });
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('waits for the auto-extraction and summarises the full article', async () => {
      withAutoExtract('x1');
      let finish!: (v: unknown) => void;
      vi.mocked(extractFullContent).mockReturnValue(new Promise((r) => { finish = r; }) as never);
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await waitFor(() => expect(extractFullContent).toHaveBeenCalledTimes(1));
      expect(requestAiSummary).not.toHaveBeenCalled();
      await act(async () => { finish(extracted('<p>' + 'complet '.repeat(80) + '</p>')); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('complet') })));
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
    });
    it('summarises the extraction already in the cache, without fetching', async () => {
      withAutoExtract('x2');
      await putExtract('x2', extracted('<p>' + 'complet '.repeat(80) + '</p>'));
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('complet') })));
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      expect(extractFullContent).not.toHaveBeenCalled();
    });
    it('falls back to the feed text when the extraction fails', async () => {
      withAutoExtract('x3');
      vi.mocked(extractFullContent).mockRejectedValue(new Error('boom'));
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await waitFor(() => expect(extractFullContent).toHaveBeenCalledTimes(1));
      await act(async () => { await Promise.resolve(); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('mot') })));
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
    });
    it('does not use the previous article\'s extraction for the next one', async () => {
      withAutoExtract('x4');
      await putExtract('x4', extracted('<p>' + 'complet '.repeat(80) + '</p>'));
      // « Trop court » laisse le statut à idle : c'est le seul cas où le rendu
      // du changement d'article, qui porte encore l'extrait du précédent, peut
      // déclencher un résumé.
      vi.mocked(requestAiSummary)
        .mockRejectedValueOnce(httpError(400, { error: 'article_too_short' }))
        .mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      useUiStore.setState({ feedSettings: {} });
      act(() => { useFeedStore.setState({ selectedArticle: article('x5') }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
      const second = vi.mocked(requestAiSummary).mock.calls[1][0];
      expect(second.articleId).toBe('x5');
      expect(second.html).toContain('mot');
      expect(second.html).not.toContain('complet');
    });
    it('does not pair the next article\'s cached extract with the previous article\'s text', async () => {
      withAutoExtract('p4');
      await putExtract('p4', extracted('<p>' + 'complet '.repeat(80) + '</p>'));
      await putExtract('p5', extracted('<p>' + 'suivant '.repeat(80) + '</p>'));
      // Premier article « trop court » : statut idle au changement d'article, et
      // le suivant est déjà en mémoire (préchargé) — la passe de transition
      // tient alors l'extrait de p4 avec l'id de p5.
      vi.mocked(requestAiSummary)
        .mockRejectedValueOnce(httpError(400, { error: 'article_too_short' }))
        .mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      act(() => { useFeedStore.setState({ selectedArticle: article('p5') }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
      const second = vi.mocked(requestAiSummary).mock.calls[1][0];
      expect(second.articleId).toBe('p5');
      expect(second.html).toContain('suivant');
      expect(second.html).not.toContain('complet');
    });
    it('summarises an article again when the user comes back to it after an unsettled one', async () => {
      const first = { ...article('q1'), sourceId: 'feed/1' } as Article;
      const second = { ...article('q2'), sourceId: 'feed/2' } as Article;
      useFeedStore.setState({ selectedArticle: first, articles: [first, second] });
      useUiStore.setState({ aiAutoSummary: true, feedSettings: { 'feed/2': { autoExtract: true } } as never });
      vi.mocked(extractFullContent).mockReturnValue(new Promise(() => {}) as never);
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { findByText } = render(<ReadingPane />);
      await passDelay();
      expect(await findByText('Le résumé.')).toBeTruthy();
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      // q2 : l'extraction ne se règle jamais, rien ne part.
      act(() => { useFeedStore.setState({ selectedArticle: second }); });
      await waitFor(() => expect(extractFullContent).toHaveBeenCalledTimes(1));
      await passDelay();
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      act(() => { useFeedStore.setState({ selectedArticle: first }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
      expect(vi.mocked(requestAiSummary).mock.calls[1][0].articleId).toBe('q1');
    });
    it('stays quiet when the article is too short', async () => {
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockRejectedValue(httpError(400, { error: 'article_too_short' }));
      const { queryByRole, getByText } = render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(queryByRole('alert')).toBeNull();
      expect(getByText('ai.status.none')).toBeTruthy();
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
    });
    it('still reports any other failure of an automatic summary', async () => {
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical' }));
      const { findByText } = render(<ReadingPane />);
      await passDelay();
      expect(await findByText('ai.errors.technical')).toBeTruthy();
    });
    it('runs once per article, not again on re-render, and again for the next article', async () => {
      useUiStore.setState({ aiAutoSummary: true });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { rerender, findByText } = render(<ReadingPane />);
      await passDelay();
      expect(await findByText('Le résumé.')).toBeTruthy();
      rerender(<ReadingPane />);
      act(() => { useUiStore.setState({ aiSummaryRatio: 30 }); });
      await passDelay();
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
      expect(vi.mocked(requestAiSummary).mock.calls[1][0].articleId).toBe('a2');
    });
    it('shows the extraction and summarises again when coming back from an article without one', async () => {
      const a = article('m1');
      const b = { ...article('m2'), sourceId: 'feed/2' } as Article;
      useFeedStore.setState({ selectedArticle: a, articles: [a, b] });
      useUiStore.setState({ aiAutoSummary: true, feedSettings: { 'feed/1': { autoExtract: true } } as never });
      await putExtract('m1', extracted('<p>' + 'complet '.repeat(80) + '</p>'));
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { container } = render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(container.textContent).toContain('complet');
      // m2 : flux sans extraction automatique, rien en mémoire pour lui.
      act(() => { useFeedStore.setState({ selectedArticle: b }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
      act(() => { useFeedStore.setState({ selectedArticle: a }); });
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(3));
      const third = vi.mocked(requestAiSummary).mock.calls[2][0];
      expect(third.articleId).toBe('m1');
      expect(third.html).toContain('complet');
      expect(container.textContent).toContain('complet');
    });

    describe('one second on the article before anything leaves', () => {
      // Horloge entièrement simulée ici : les bornes se mesurent à la
      // milliseconde, le temps réel ne doit pas s'en mêler.
      beforeEach(() => {
        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        useUiStore.setState({ aiAutoSummary: true });
        vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      });
      const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
      const select = (id: string) => act(() => { useFeedStore.setState({ selectedArticle: article(id) }); });

      it('sends nothing before one second, and the request at one second', async () => {
        render(<ReadingPane />);
        await advance(999);
        expect(requestAiSummary).not.toHaveBeenCalled();
        await advance(1);
        expect(requestAiSummary).toHaveBeenCalledTimes(1);
        expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1' }));
      });
      it('sends nothing for an article left within the second, then waits its own second for the next', async () => {
        render(<ReadingPane />);
        await advance(500);
        select('a2');
        await advance(999);
        expect(requestAiSummary).not.toHaveBeenCalled();
        await advance(1);
        expect(requestAiSummary).toHaveBeenCalledTimes(1);
        expect(vi.mocked(requestAiSummary).mock.calls[0][0].articleId).toBe('a2');
      });
      it('sends one request for A after A → B → A in quick succession', async () => {
        render(<ReadingPane />);
        await advance(300);
        select('a2');
        await advance(300);
        select('a1');
        await advance(1000);
        await advance(3000);
        expect(requestAiSummary).toHaveBeenCalledTimes(1);
        expect(vi.mocked(requestAiSummary).mock.calls[0][0].articleId).toBe('a1');
      });
      it('sends nothing when the pane goes away within the second', async () => {
        const { unmount } = render(<ReadingPane />);
        await advance(500);
        unmount();
        await advance(2000);
        expect(requestAiSummary).not.toHaveBeenCalled();
      });
    });
    it('leaves a folded panel folded when the summary arrives', async () => {
      useUiStore.setState({ aiAutoSummary: true, aiPanelCollapsed: true });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { getByRole, queryByText } = render(<ReadingPane />);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(getByRole('button', { name: /^ai\.summarize\s/ }).getAttribute('aria-expanded')).toBe('false');
      expect(queryByText('Le résumé.')).toBeNull();
    });
  });

  describe('summarize event (keyboard shortcut, palette)', () => {
    const fire = () => act(() => { window.dispatchEvent(new CustomEvent('frirss:ai-summarize')); });
    it('triggers a summary of the open article', async () => {
      vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
      render(<ReadingPane />);
      fire();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1' }));
    });
    it('does nothing when AI is unusable', () => {
      useAiStore.setState({ config: { ...ON, providers: [{ ...ON.providers[0], available: false }] } });
      render(<ReadingPane />);
      fire();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does nothing when AI is off', () => {
      useAiStore.setState({ config: { ...ON, enabled: false } });
      render(<ReadingPane />);
      fire();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does nothing while offline', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      render(<ReadingPane />);
      fire();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does not start a second request while one is running', async () => {
      vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      fire();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      fire();
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
    });
    it('unfolds a folded panel once per device, like the button', async () => {
      vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
      useUiStore.setState({ aiPanelCollapsed: true, aiPanelAutoExpanded: false });
      render(<ReadingPane />);
      fire();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
      expect(useUiStore.getState().aiPanelAutoExpanded).toBe(true);
    });
    it('stops listening once the pane is gone', () => {
      const { unmount } = render(<ReadingPane />);
      unmount();
      fire();
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
  });
});
