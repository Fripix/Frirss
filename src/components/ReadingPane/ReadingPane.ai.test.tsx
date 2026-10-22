// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (k === 'ai.translation.by' ? `${k}:${o?.name}` : k), i18n: { language: 'fr' } }) }));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn(), requestAiTranslation: vi.fn() }));
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
import { requestAiSummary, requestAiTranslation } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { extractFullContent } from '../../utils/extractContent';
import { putExtract } from '../../lib/extractCache';
import { __resetPendingSummariesForTests } from './aiPending';
import { languageName } from '../../lib/aiLanguages';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import { translateWouldAct } from '../../lib/aiTranslateProbe';

const article = (id: string) => ({
  id, title: 'Titre ' + id, summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>' + 'mot '.repeat(60) + '</p>', url: 'https://example.com/' + id,
  published: Date.now(), read: false, starred: false, labels: [],
} as unknown as Article);
const ON = { enabled: true, providers: [{ id: 1, name: 'Ollama', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true }], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };

beforeEach(() => {
  // La mémoire par appareil des traductions affichées ne passe pas d'un test à l'autre.
  localStorage.clear();
  useFeedStore.setState({ selectedArticle: article('a1'), articles: [article('a1'), article('a2')] });
  useAiStore.setState({ config: ON });
  useAuthStore.setState({ backendUser: { id: 2, username: 'u', role: 'user' } as never });
  useUiStore.setState({
    aiPanelCollapsed: false, aiPanelAutoExpanded: false, aiSummaryRatio: 20, aiAutoSummary: false,
    aiPanelAlways: true, aiCategoryPanel: {},
    autoExtractDefault: false,
    feedSettings: {}, aiCategoryProviders: {}, aiPreferredProvider: null, aiFallback: true,
    aiTranslationLanguage: 'ui', aiTranslationProvider: null, toasts: [],
  });
  useFeedStore.setState({ subscriptions: [] });
  vi.mocked(requestAiSummary).mockReset();
  vi.mocked(requestAiTranslation).mockReset();
  vi.mocked(extractFullContent).mockReset();
  __resetPendingSummariesForTests();
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
  it('a forced « Résumer avec X » keeps the user\'s fallback setting, so a failing X falls back too', async () => {
    useUiStore.setState({ aiFallback: true });
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByRole('button', { name: 'ai.withProvider' });
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(getByRole('menuitem', { name: 'Ollama' }));
    await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiSummary).mock.calls[1][0]).toMatchObject({ provider: 1, fallback: true });
  });
  it('« Régénérer » asks again with regenerate and the provider that wrote the summary', async () => {
    vi.mocked(requestAiSummary)
      .mockResolvedValueOnce({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: true })
      .mockResolvedValueOnce({ text: 'Le nouveau résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(vi.mocked(requestAiSummary).mock.calls[0][0]).not.toHaveProperty('regenerate', true);
    fireEvent.click(await findByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.regenerate' }));
    await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiSummary).mock.calls[1][0]).toMatchObject({ provider: 1, regenerate: true });
    expect(await findByText('Le nouveau résumé.')).toBeTruthy();
  });
  it('offers no « Régénérer » when the provider that wrote the summary is no longer available', async () => {
    vi.mocked(requestAiSummary).mockResolvedValueOnce({ text: 'Le résumé.', lang: 'fr', providerId: 9, providerName: 'Parti', model: 'm', fromCache: true });
    const { getByRole, findByRole, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    fireEvent.click(await findByRole('button', { name: 'ai.withProvider' }));
    expect(getByRole('menuitem', { name: 'Ollama' })).toBeTruthy();
    expect(queryByRole('menuitem', { name: 'ai.regenerate' })).toBeNull();
  });
  it('offers no « Régénérer » before there is a summary', () => {
    const { queryByRole, queryByText } = render(<ReadingPane />);
    expect(queryByRole('button', { name: 'ai.withProvider' })).toBeNull();
    expect(queryByText('ai.regenerate')).toBeNull();
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
  it('shows the panel above the article, as a single header line, while nothing was requested', () => {
    const { container, getByRole, getByText, queryByRole } = render(<ReadingPane />);
    // Rien à montrer : une simple ligne d'en-tête, sans bouton de repli ni corps.
    expect(queryByRole('button', { name: /^ai\.summarize\s/ })).toBeNull();
    expect(getByText('ai.summarize')).toBeTruthy();
    expect(container.querySelector('[id$="-body"]')).toBeNull();
    expect(getByRole('button', { name: 'ai.summarizeAction' })).toBeTruthy();
  });
  it('keeps the panel folded on the next article when the user folded it', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText, queryByText, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('Le résumé.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /^ai\.summarize\s/ }));
    expect(queryByText('Le résumé.')).toBeNull();
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    // Rien à montrer sur le nouvel article : l'en-tête seul, sans bouton de repli.
    // La mémoire, elle, tient : le résumé de a2 arrive replié.
    expect(queryByRole('button', { name: /^ai\.summarize\s/ })).toBeNull();
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    // L'exception du tout premier « Résumer » replié est consommée une fois par appareil.
    act(() => { useUiStore.setState({ aiPanelAutoExpanded: true }); });
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await waitFor(() => expect(getByRole('button', { name: /^ai\.summarize\s/ }).getAttribute('aria-expanded')).toBe('false'));
    expect(queryByText('Le résumé.')).toBeNull();
  });
  describe('panel visibility setting', () => {
    const fire = () => act(() => { window.dispatchEvent(new CustomEvent('frirss:ai-summarize')); });
    it('hides the panel while the setting is off and nothing was asked', () => {
      useUiStore.setState({ aiPanelAlways: false });
      const { container, queryByText } = render(<ReadingPane />);
      expect(queryByText('ai.summarize')).toBeNull();
      expect(container.querySelector('.ai-summary')).toBeNull();
    });
    it('« s » makes it appear with the request, and the summary stays', async () => {
      useUiStore.setState({ aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
      const { findByText, queryByText } = render(<ReadingPane />);
      expect(queryByText('ai.summarize')).toBeNull();
      fire();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(await findByText('Le résumé.')).toBeTruthy();
    });
    it('goes away again on the next article', async () => {
      useUiStore.setState({ aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
      const { findByText, queryByText } = render(<ReadingPane />);
      fire();
      expect(await findByText('Le résumé.')).toBeTruthy();
      act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
      expect(queryByText('Le résumé.')).toBeNull();
      expect(queryByText('ai.summarize')).toBeNull();
    });
    it('panel hidden: « Résumer » sits in the toolbars and asks for the summary', async () => {
      useUiStore.setState({ aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
      const { getAllByRole, findByText } = render(<ReadingPane />);
      // Barre d'outils du bureau : le panneau n'est pas là, ce bouton en tient lieu.
      const buttons = getAllByRole('button', { name: 'ai.summarizeAction' });
      expect(buttons.length).toBe(1);
      expect(buttons[0].closest('.ai-summary')).toBeNull();
      fireEvent.click(buttons[0]);
      expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1' }));
      expect(await findByText('Le résumé.')).toBeTruthy();
    });
    it('les libellés secondaires de la barre (Étiquettes, Partager, Original) portent toolbar-label-secondary', () => {
      const { container } = render(<ReadingPane />);
      const toolbar = container.querySelector('.reading-toolbar') as HTMLElement;
      const secondary = Array.from(toolbar.querySelectorAll('.toolbar-label-secondary')).map((e) => e.textContent);
      expect(secondary).toEqual(expect.arrayContaining(['readingPane.openOriginal', 'readingPane.labels']));
      expect(secondary.some((x) => x === 'readingPane.share' || x === 'readingPane.copyLink')).toBe(true);
      expect(secondary.length).toBe(3);
      // Les autres libellés restent des libellés ordinaires, repliés en second.
      expect(toolbar.querySelectorAll('.toolbar-label').length).toBeGreaterThan(3);
      // `data-fold` est posé par le hook, jamais par le JSX ; l'ancienne classe a disparu.
      expect(toolbar.dataset.fold).toBe('0');
      expect(container.querySelector('.has-translate, .has-summarize')).toBeNull();
    });
    it('on a phone, « Résumer » is the first row of the « … » sheet: it closes the sheet and asks for the summary', async () => {
      const width = window.innerWidth;
      window.innerWidth = 375;
      try {
        useUiStore.setState({ aiPanelAlways: false });
        vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
        const { getByRole, queryAllByRole, getAllByRole } = render(<ReadingPane />);
        // Rien dans la barre du bas : elle est déjà pleine.
        expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0);
        fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
        const row = getByRole('button', { name: 'ai.summarizeAction' });
        expect(row.classList.contains('sheet-row')).toBe(true);
        // Première rangée : avant « Ouvrir l'original ».
        const original = getByRole('link', { name: 'readingPane.openOriginal' });
        expect(row.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(row.previousElementSibling?.tagName).toBe('H3');
        fireEvent.click(row);
        expect(requestAiSummary).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0));
        expect(getAllByRole('button', { name: 'readingPane.more' }).length).toBeGreaterThan(0);
      } finally {
        window.innerWidth = width;
      }
    });
    it('on a phone, the sheet row is disabled offline', () => {
      const width = window.innerWidth;
      window.innerWidth = 375;
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      try {
        useUiStore.setState({ aiPanelAlways: false });
        const { getByRole } = render(<ReadingPane />);
        fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
        expect((getByRole('button', { name: 'ai.summarizeAction' }) as HTMLButtonElement).disabled).toBe(true);
      } finally {
        window.innerWidth = width;
      }
    });
    it('on a phone with the panel visible, the sheet has no « Résumer » row', () => {
      const width = window.innerWidth;
      window.innerWidth = 375;
      try {
        const { getByRole, getAllByRole } = render(<ReadingPane />);
        fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
        // Seul le bouton du panneau.
        expect(getAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(1);
      } finally {
        window.innerWidth = width;
      }
    });
    it('panel hidden: the toolbar button is disabled offline', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      useUiStore.setState({ aiPanelAlways: false });
      const { getAllByRole } = render(<ReadingPane />);
      for (const b of getAllByRole('button', { name: 'ai.summarizeAction' })) expect((b as HTMLButtonElement).disabled).toBe(true);
    });
    it('panel visible: no « Résumer » in the toolbars, only the panel one', () => {
      const { getAllByRole } = render(<ReadingPane />);
      const buttons = getAllByRole('button', { name: 'ai.summarizeAction' });
      expect(buttons.length).toBe(1);
      expect(buttons[0].closest('.ai-summary')).not.toBeNull();
    });
    it('once the summary is asked for, the toolbar button is gone', async () => {
      useUiStore.setState({ aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
      const { getAllByRole, queryAllByRole } = render(<ReadingPane />);
      fireEvent.click(getAllByRole('button', { name: 'ai.summarizeAction' })[0]);
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0);
    });
    it('no toolbar button when AI is unusable', () => {
      useUiStore.setState({ aiPanelAlways: false });
      useAiStore.setState({ config: { ...ON, enabled: false, providers: [] } });
      const { queryAllByRole } = render(<ReadingPane />);
      expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0);
    });
    it('a feed set to always shows it under a global off; a feed set to off hides it under a global on', () => {
      useUiStore.setState({ aiPanelAlways: false, feedSettings: { 'feed/1': { aiPanel: true } } });
      const first = render(<ReadingPane />);
      expect(first.getByText('ai.summarize')).toBeTruthy();
      first.unmount();
      useUiStore.setState({ aiPanelAlways: true, feedSettings: { 'feed/1': { aiPanel: false } } });
      const second = render(<ReadingPane />);
      expect(second.queryByText('ai.summarize')).toBeNull();
    });
    it('a category switched off hides it for its feeds', () => {
      useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] }] } as never);
      useUiStore.setState({ aiCategoryPanel: { Tech: false } });
      const { queryByText } = render(<ReadingPane />);
      expect(queryByText('ai.summarize')).toBeNull();
    });
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
  it('sends a very long article cut under the server limit instead of having it refused', () => {
    vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
    const long = { ...article('a1'), content: ('<p>' + 'mot '.repeat(100) + '</p>').repeat(700) } as Article;
    useFeedStore.setState({ selectedArticle: long, articles: [long] });
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    const sent = vi.mocked(requestAiSummary).mock.calls[0][0].html;
    expect(new TextEncoder().encode(sent).length).toBeLessThanOrEqual(200_000);
    expect(sent.length).toBeGreaterThan(190_000);
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
  it('says how many summaries and when the day starts again when the cap answer carries them', async () => {
    vi.mocked(requestAiSummary).mockRejectedValueOnce(httpError(429, { error: 'ai_daily_cap', cap: 50, resetAt: new Date(2026, 9, 21).toISOString() }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    expect(await findByText('ai.errors.capDetail')).toBeTruthy();
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
  it('« Réessayer avec… » relance /ai/summary chez le fournisseur suivant de l\'admin', async () => {
    useAiStore.setState({ config: { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] } });
    vi.mocked(requestAiSummary)
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockResolvedValueOnce({ text: 'Le résumé.', lang: 'fr', providerId: 2, providerName: 'Claude', model: 'm', fromCache: false });
    const { getByRole, findByRole, findByText, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    fireEvent.click(await findByRole('button', { name: 'ai.retryWith' }));
    expect(await findByText('Le résumé.')).toBeTruthy();
    expect(vi.mocked(requestAiSummary).mock.calls[1][0]).toMatchObject({ provider: 2 });
    expect(queryByRole('button', { name: 'ai.retryWith' })).toBeNull();
  });
  it('une erreur sans fournisseur nommé (plafond, trop long) ne propose pas de relance', async () => {
    useAiStore.setState({ config: { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] } });
    vi.mocked(requestAiSummary).mockRejectedValue(httpError(400, { error: 'invalid_body' }));
    const { getByRole, findByText, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByText('ai.errors.tooLong');
    expect(queryByRole('button', { name: 'ai.retryWith' })).toBeNull();
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
    it('brings a panel hidden by the setting up with the automatic summary', async () => {
      useUiStore.setState({ aiAutoSummary: true, aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      const { findByText, queryByText } = render(<ReadingPane />);
      expect(queryByText('ai.summarize')).toBeNull();
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(await findByText('Le résumé.')).toBeTruthy();
    });
    it('automatic summary on and panel hidden: no « Résumer » button, not even during the delay', async () => {
      useUiStore.setState({ aiAutoSummary: true, aiPanelAlways: false });
      vi.mocked(requestAiSummary).mockReturnValue(new Promise(() => {}) as never);
      const { queryAllByRole } = render(<ReadingPane />);
      expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0);
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(0);
    });
    it('automatic summary on, panel hidden, but offline: the button is there for the manual request', () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      useUiStore.setState({ aiAutoSummary: true, aiPanelAlways: false });
      const { queryAllByRole } = render(<ReadingPane />);
      expect(queryAllByRole('button', { name: 'ai.summarizeAction' })).toHaveLength(1);
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
      expect(getByText('ai.summarize')).toBeTruthy();
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
    it('extracts and summarises the next article when the user leaves one still extracting', async () => {
      const a = article('s1');
      const b = article('s2');
      useFeedStore.setState({ selectedArticle: a, articles: [a, b] });
      useUiStore.setState({ aiAutoSummary: true, feedSettings: { 'feed/1': { autoExtract: true } } as never });
      let finishA!: (v: unknown) => void;
      vi.mocked(extractFullContent).mockImplementation((url: string) => (url.endsWith('/s1')
        ? new Promise((r) => { finishA = r; })
        : Promise.resolve(extracted('<p>' + 'second '.repeat(80) + '</p>'))) as never);
      vi.mocked(requestAiSummary).mockResolvedValue(RESULT);
      render(<ReadingPane />);
      await waitFor(() => expect(extractFullContent).toHaveBeenCalledTimes(1));
      act(() => { useFeedStore.setState({ selectedArticle: b }); });
      await act(async () => { finishA(extracted('<p>' + 'premier '.repeat(80) + '</p>')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await waitFor(() => expect(extractFullContent).toHaveBeenCalledWith('https://example.com/s2'));
      await passDelay();
      await waitFor(() => expect(requestAiSummary).toHaveBeenCalledTimes(1));
      const sent = vi.mocked(requestAiSummary).mock.calls[0][0];
      expect(sent.articleId).toBe('s2');
      expect(sent.html).toContain('second');
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
      it('reuses the request still in flight when the user comes back to its article', async () => {
        let finish!: (v: unknown) => void;
        vi.mocked(requestAiSummary).mockReset();
        vi.mocked(requestAiSummary).mockImplementation(((req: { articleId: string }) => (req.articleId === 'a1'
          ? new Promise((r) => { finish = r; })
          : new Promise(() => {}))) as never);
        const { getByText } = render(<ReadingPane />);
        await advance(1000);
        expect(requestAiSummary).toHaveBeenCalledTimes(1);
        select('a2');
        await advance(300);
        select('a1');
        await advance(1000);
        expect(vi.mocked(requestAiSummary).mock.calls.filter(([r]) => r.articleId === 'a1')).toHaveLength(1);
        await act(async () => { finish(RESULT); });
        await advance(0);
        expect(getByText('Le résumé.')).toBeTruthy();
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
    it('leaves a summary already on screen alone', async () => {
      vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
      const { findByText } = render(<ReadingPane />);
      fire();
      expect(await findByText('Le résumé.')).toBeTruthy();
      fire();
      await act(async () => { await Promise.resolve(); });
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      expect(await findByText('Le résumé.')).toBeTruthy();
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

describe('ReadingPane — traduction du résumé', () => {
  const TWO = { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] };
  const translation = (segments: string[], over: Record<string, unknown> = {}) =>
    ({ segments, lang: 'fr', same: false, providerId: 2, providerName: 'Claude', model: 'm', fromCache: false, ...over });

  async function summarized() {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'The summary.', lang: 'en', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const utils = render(<ReadingPane />);
    fireEvent.click(utils.getByRole('button', { name: 'ai.summarizeAction' }));
    await utils.findByText('The summary.');
    return utils;
  }

  it('« Traduire » sends the summary, scope summary, to the interface language, then shows it', async () => {
    useUiStore.setState({ aiTranslationProvider: 2 });
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['Le résumé traduit.']));
    const { getByRole, findByText, queryByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    expect(requestAiTranslation).toHaveBeenCalledWith(expect.objectContaining({
      articleId: 'a1', scope: 'summary', targetLang: 'fr', segments: ['The summary.'], translationProvider: 2, fallback: true,
    }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).not.toHaveProperty('provider', expect.anything());
    expect(await findByText('Le résumé traduit.')).toBeTruthy();
    expect(queryByText('The summary.')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'ai.showSource' }));
    expect(await findByText('The summary.')).toBeTruthy();
    expect(getByRole('button', { name: 'ai.translate' })).toBeTruthy();
  });
  it('shows the translated summary as text: entities decoded, tags dropped, never literal', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['Caf&eacute; &amp; <em>th&eacute;</em> <script>alert(1)</script>.\n\nSecond &quot;point&quot;.']));
    const { getByRole, findByText, container } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    expect(await findByText('Café & thé .')).toBeTruthy();
    expect(await findByText('Second "point".')).toBeTruthy();
    const text = container.textContent ?? '';
    for (const literal of ['&amp;', '&quot;', '<em>', 'alert(1)']) expect(text).not.toContain(literal);
  });
  it('uses the target language of the preferences when one is set', async () => {
    useUiStore.setState({ aiTranslationLanguage: 'ja' });
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ targetLang: 'ja' });
  });
  it('same: a short notice, the summary unchanged', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['The summary.'], { same: true, lang: 'fr' }));
    const { getByRole, getByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await waitFor(() => expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('ai.translation.alreadyTarget'));
    expect(getByText('The summary.')).toBeTruthy();
    expect(getByRole('button', { name: 'ai.translate' })).toBeTruthy();
  });
  it('un résumé déjà en français : « Traduire » dit « Déjà en français » sans appeler /ai/translate', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText, getByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByText('Le résumé.');
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await waitFor(() => expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('ai.translation.alreadyTarget'));
    expect(requestAiTranslation).not.toHaveBeenCalled();
    expect(getByText('Le résumé.')).toBeTruthy();
    expect(getByRole('button', { name: 'ai.translate' })).toBeTruthy();
  });
  it('« Traduire avec X » sans langue choisie : un résumé déjà dans la langue cible dit « Déjà en » sans appel', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByText('Le résumé.');
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateWith' })).getByRole('menuitemradio', { name: 'Claude' }));
    await waitFor(() => expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('ai.translation.alreadyTarget'));
    expect(requestAiTranslation).not.toHaveBeenCalled();
  });
  it('« Traduire en… » une autre langue part toujours, même quand le résumé est déjà dans la langue cible', async () => {
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false });
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByText('Le résumé.');
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ scope: 'summary', targetLang: 'de' });
  });
  it('« Traduire en… » sends the language picked', async () => {
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    const langs = within(getByRole('group', { name: 'ai.translateTo' }));
    fireEvent.click(langs.getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ scope: 'summary', targetLang: 'de' });
  });
  it('« Traduire avec… » forces the provider and keeps the fallback setting', async () => {
    useAiStore.setState({ config: TWO });
    useUiStore.setState({ aiFallback: false });
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateWith' })).getByRole('menuitemradio', { name: 'Claude' }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ provider: 2, targetLang: 'fr', fallback: false });
  });
  it('« Retraduire » asks the summary translation again, same language and provider, with regenerate', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['Le résumé traduit.']));
    const { getByRole, findByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await findByText('Le résumé traduit.');
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.retranslate' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'summary', targetLang: 'fr', provider: 2, regenerate: true });
  });
  it('a failed « Retraduire » keeps the translation on screen, during the request and after it, with the alert', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiTranslation).mockResolvedValueOnce(translation(['Le résumé traduit.']));
    const { getByRole, findByText, findByRole, getByText, queryByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await findByText('Le résumé traduit.');
    let fail!: (e: unknown) => void;
    vi.mocked(requestAiTranslation).mockReturnValueOnce(new Promise((_r, j) => { fail = j; }) as never);
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.retranslate' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(getByText('Le résumé traduit.')).toBeTruthy();
    expect(queryByText('The summary.')).toBeNull();
    await act(async () => { fail(httpError(502, { error: 'ai_failed', kind: 'technical' })); });
    expect((await findByRole('alert')).textContent).toBe('ai.errors.translateFailed');
    expect(getByText('Le résumé traduit.')).toBeTruthy();
    expect(getByRole('button', { name: 'ai.showSource' })).toBeTruthy();
  });
  it('offers no « Retraduire » of the summary when the provider of the translation is no longer available', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['Le résumé traduit.'], { providerId: 9, providerName: 'Parti' }));
    const { getByRole, findByText, queryByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await findByText('Le résumé traduit.');
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    expect(getByRole('menu')).toBeTruthy();
    expect(queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
  });
  it('« Réessayer avec… » relance la traduction du résumé chez le fournisseur suivant', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiTranslation)
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockResolvedValueOnce(translation(['Le résumé traduit.']));
    const { getByRole, findByRole, findByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    fireEvent.click(await findByRole('button', { name: 'ai.retryWith' }));
    expect(await findByText('Le résumé traduit.')).toBeTruthy();
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'summary', provider: 2 });
  });
  it('« Réessayer avec… » rejoue la langue qui a échoué, pas la langue cible', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiTranslation)
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockResolvedValueOnce(translation(['Die Zusammenfassung.'], { lang: 'de' }));
    const { getByRole, findByRole, findByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translateMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ scope: 'summary', targetLang: 'de' });
    fireEvent.click(await findByRole('button', { name: 'ai.retryWith' }));
    expect(await findByText('Die Zusammenfassung.')).toBeTruthy();
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'summary', targetLang: 'de', provider: 2 });
  });
  it('a failure with no known cause says the translation failed, and keeps the summary', async () => {
    vi.mocked(requestAiTranslation).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical' }));
    const { getByRole, findByRole, getByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    expect((await findByRole('alert')).textContent).toBe('ai.errors.translateFailed');
    expect(getByText('The summary.')).toBeTruthy();
  });
  it('a malformed answer says so in one request: the summary is one segment, never split', async () => {
    vi.mocked(requestAiTranslation).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical', detail: 'segments' }));
    const { getByRole, findByRole, getByText } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    expect((await findByRole('alert')).textContent).toBe('ai.errors.segments');
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(getByText('The summary.')).toBeTruthy();
  });
  it('forgets the translation on the next article, and ignores one that arrives late', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { getByRole, queryByText, queryByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    await act(async () => { resolve(translation(['Trop tard.'])); });
    expect(queryByText('Trop tard.')).toBeNull();
    expect(queryByRole('button', { name: 'ai.showSource' })).toBeNull();
  });
  it('reuses the translation still in flight when the user comes back to its article', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { getByRole, findByText, findByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    act(() => { useFeedStore.setState({ selectedArticle: article('a2') }); });
    act(() => { useFeedStore.setState({ selectedArticle: article('a1') }); });
    fireEvent.click(getByRole('button', { name: 'ai.summarizeAction' }));
    await findByText('The summary.');
    fireEvent.click(await findByRole('button', { name: 'ai.translate' }));
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(translation(['Le résumé traduit.'])); });
    expect(await findByText('Le résumé traduit.')).toBeTruthy();
  });
  it('a new summary drops the translation of the previous one', async () => {
    useAiStore.setState({ config: TWO });
    vi.mocked(requestAiTranslation).mockResolvedValue(translation(['Le résumé traduit.']));
    const { getByRole, findByText, findByRole } = await summarized();
    fireEvent.click(getByRole('button', { name: 'ai.translate' }));
    await findByText('Le résumé traduit.');
    vi.mocked(requestAiSummary).mockResolvedValue({ text: 'Another summary.', lang: 'en', providerId: 2, providerName: 'Claude', model: 'm', fromCache: false });
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(getByRole('menuitem', { name: 'Claude' }));
    expect(await findByText('Another summary.')).toBeTruthy();
    expect(await findByRole('button', { name: 'ai.translate' })).toBeTruthy();
  });
});

describe('ReadingPane — traduction de l\'article', () => {
  const translated = (segments: string[], over: Record<string, unknown> = {}) =>
    ({ segments, lang: 'en', same: false, providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false, ...over });
  const bodyText = (container: HTMLElement) => container.querySelector('.article-content[data-theme="reading-text"]')?.textContent ?? '';

  it('« Traduire l\'article » sends the title and body, then shows the translation, its notice and « Texte source »', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
    const { getByRole, findByRole, getByText, container } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    expect(requestAiTranslation).toHaveBeenCalledWith(expect.objectContaining({
      articleId: 'a1', scope: 'article', targetLang: 'fr', fallback: true,
      segments: ['Titre a1', expect.stringContaining('mot mot')],
    }));
    expect(await findByRole('button', { name: 'ai.showSource' })).toBeTruthy();
    expect(bodyText(container)).toBe('word word');
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Title a1');
    expect(getByText('ai.translation.by:Ollama')).toBeTruthy();
  });
  it('a translation on screen puts « Traduit par … » in the metadata and no banner', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
    const { getByRole, findByRole, getByText, queryByText, getAllByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    // Aucun bandeau visible : la fin de la traduction ne s'annonce que dans la
    // région vivante, par une ligne invisible (sinon elle passerait de
    // « Traduction… » à vide, en silence).
    const announced = getByText('ai.translation.done');
    expect(announced.className).toContain('sr-only');
    expect(announced.closest('[role="status"]')).not.toBeNull();
    // Dans la ligne des métadonnées, à côté du temps de lecture — pas dans la région vivante.
    const chip = getByText('ai.translation.by:Ollama');
    expect(chip.closest('[role="status"]')).toBeNull();
    expect(chip.parentElement?.querySelector('svg')).toBeTruthy();
    // Le texte entier de la puce, en infobulle (variante bureau : jamais tronquée).
    expect(chip.parentElement?.getAttribute('title')).toBe('ai.translation.by:Ollama');
    expect(chip.className).not.toContain('truncate');
    expect(getAllByRole('status').some((r) => r.textContent === 'ai.translation.done')).toBe(true);
    expect(queryByText('ai.translation.partial')).toBeNull();
  });
  it('the compact metadata line carries « Traduit par … » too', async () => {
    useUiStore.setState({ layoutMode: 'mobile' } as never);
    try {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { getByRole, findByRole, getByText } = render(<ReadingPane />);
      fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
      await findByRole('button', { name: 'ai.showSource' });
      const chip = getByText('ai.translation.by:Ollama');
      // Sa propre ligne, sous source et date (elle ne se serre pas contre la date), et en infobulle en entier.
      expect(chip.parentElement?.getAttribute('title')).toBe('ai.translation.by:Ollama');
      expect(chip.parentElement?.className).toContain('max-w-full');
      expect(chip.className).toContain('truncate');
      const line = chip.parentElement?.parentElement;
      expect(line?.className).not.toContain('flex');
      expect(line?.previousElementSibling?.textContent).toContain('Src');
      expect(chip.closest('[role="status"]')).toBeNull();
    } finally {
      useUiStore.setState({ layoutMode: 'auto' } as never);
    }
  });
  it('a partial translation keeps its banner, with the language and the provider in it', async () => {
    const a = { ...article('tp'), content: `<p>${'x'.repeat(200_001)}</p><p>End of the text here</p>` } as Article;
    useFeedStore.setState({ selectedArticle: a, articles: [a] });
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title tp', 'Fin']));
    const { getByRole, findByRole, getByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    expect(getByText('ai.translation.done')).toBeTruthy();
    expect(getByText('ai.translation.partial')).toBeTruthy();
  });
  it('a fallback keeps its banner', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word'], { fellBackFrom: 'Claude' }));
    const { getByRole, findByRole, getByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    expect(getByText(/ai\.translation\.done, ai\.fellBack/)).toBeTruthy();
  });
  it('« Texte source » switches back without any request', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
    const { getByRole, findByRole, container, queryByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    fireEvent.click(await findByRole('button', { name: 'ai.showSource' }));
    expect(bodyText(container)).toContain('mot mot');
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Titre a1');
    expect(queryByText('ai.translation.done')).toBeNull();
    expect(queryByText('ai.translation.by:Ollama')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    expect(bodyText(container)).toBe('word word');
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
  });
  it('an extraction arriving after a manual translation brings the source back', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
    const a = article('t3');
    useFeedStore.setState({ selectedArticle: a, articles: [a] });
    const { getByRole, findByRole, container } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    // Le cache mémoire répond sans réseau : « Article complet » l'applique tout de suite.
    await putExtract('t3', { title: 't', content: '<p>The full article.</p>', excerpt: '', byline: '', siteName: '', length: 20 });
    const extract = container.querySelector('[title="readingPane.fullContent"]') as HTMLElement;
    await act(async () => { fireEvent.click(extract); await Promise.resolve(); });
    expect(bodyText(container)).toContain('The full article.');
    expect(getByRole('button', { name: 'ai.translateArticle' })).toBeTruthy();
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
  });
  it('is disabled offline, and a translation already shown stays', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
    const { getByRole, findByRole, container } = render(<ReadingPane />);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((getByRole('button', { name: 'ai.translateArticle' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(bodyText(container)).toBe('word word');
    expect((getByRole('button', { name: 'ai.showSource' }) as HTMLButtonElement).disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
  });
  it('the desktop chevron opens « Traduire en… » and sends the language picked', async () => {
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ scope: 'article', targetLang: 'de' });
  });
  it('« Retraduire » in the article menu, only over a translation on screen, asks again with regenerate', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word'], { providerId: 1 }));
    const { getByRole, findByRole, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    expect(queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    fireEvent.click(getByRole('menuitem', { name: 'ai.retranslate' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'article', targetLang: 'fr', provider: 1, regenerate: true });
  });
  it('offers no « Retraduire » of the article when the provider of the translation is no longer available', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word'], { providerId: 9, providerName: 'Parti' }));
    const { getByRole, findByRole, queryByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    expect(getByRole('menu')).toBeTruthy();
    expect(queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
  });
  it('a pick in the desktop menu returns focus to the chevron', () => {
    vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
    const { getByRole } = render(<ReadingPane />);
    const chevron = getByRole('button', { name: 'ai.translateArticleMenu' });
    fireEvent.click(chevron);
    const item = within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') });
    item.focus();
    fireEvent.click(item);
    expect(document.activeElement).toBe(chevron);
  });
  it('shows the error in an alert, with the source still on screen', async () => {
    vi.mocked(requestAiTranslation).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical' }));
    const { getByRole, findByRole, container } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    expect((await findByRole('alert')).textContent).toContain('ai.errors.translateFailed');
    expect(bodyText(container)).toContain('mot mot');
  });
  it('« Réessayer avec… » relance la traduction de l\'article chez le fournisseur suivant', async () => {
    useAiStore.setState({ config: { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] } });
    vi.mocked(requestAiTranslation)
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { getByRole, findByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    const alert = await findByRole('alert');
    // Le bouton est sous l'alerte, pas dedans : la région vivante ne lit que le message.
    expect(within(alert).queryByRole('button')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'ai.retryWith' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'article', provider: 2 });
  });
  it('« Réessayer avec… » rejoue la langue qui a échoué, pas la langue cible', async () => {
    useAiStore.setState({ config: { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] } });
    vi.mocked(requestAiTranslation)
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { getByRole } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    await waitFor(() => expect(getByRole('button', { name: 'ai.retryWith' })).toBeTruthy());
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ scope: 'article', targetLang: 'de' });
    fireEvent.click(getByRole('button', { name: 'ai.retryWith' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ scope: 'article', targetLang: 'de', provider: 2 });
  });
  it('« Réessayer avec… » over a displayed translation replays the failed language, and the shown one stays until it succeeds', async () => {
    useAiStore.setState({ config: { ...ON, providers: [...ON.providers, { id: 2, name: 'Claude', type: 'anthropic' as const, hasAdminKey: true, shared: true, hasUserKey: false, available: true }] } });
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(translated(['Title a1', 'Der Text'], { lang: 'de' }))
      .mockRejectedValueOnce(httpError(502, { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { getByRole, findByRole, container } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
    await findByRole('button', { name: 'ai.showSource' });
    fireEvent.click(getByRole('button', { name: 'ai.translateArticleMenu' }));
    fireEvent.click(within(getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('es', 'fr') }));
    fireEvent.click(await findByRole('button', { name: 'ai.retryWith' }));
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(3), { timeout: 4000 });
    expect(vi.mocked(requestAiTranslation).mock.calls[2][0]).toMatchObject({ scope: 'article', targetLang: 'es', provider: 2 });
    // L'allemand reste à l'écran tant que l'espagnol n'est pas arrivé.
    expect(bodyText(container)).toBe('Der Text');
  });
  describe('re-translating into another language over a displayed translation', () => {
    async function shownThenGerman() {
      vi.mocked(requestAiTranslation).mockResolvedValueOnce(translated(['Title a1', 'word word']));
      const utils = render(<ReadingPane />);
      fireEvent.click(utils.getByRole('button', { name: 'ai.translateArticle' }));
      await utils.findByRole('button', { name: 'ai.showSource' });
      let reject!: (e: unknown) => void;
      vi.mocked(requestAiTranslation).mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }) as never);
      fireEvent.click(utils.getByRole('button', { name: 'ai.translateArticleMenu' }));
      fireEvent.click(within(utils.getByRole('group', { name: 'ai.translateTo' })).getByRole('menuitemradio', { name: languageName('de', 'fr') }));
      return { ...utils, reject: (e: unknown) => reject(e) };
    }
    it('the main button says « Traduction… » and is disabled while it loads', async () => {
      const { getByRole, queryByRole, container } = await shownThenGerman();
      expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ targetLang: 'de' });
      const btn = getByRole('button', { name: 'ai.translating' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(queryByRole('button', { name: 'ai.showSource' })).toBeNull();
      expect(bodyText(container)).toBe('word word');
    });
    it('an error keeps the translation on screen and adds the alert', async () => {
      const { getByRole, findByRole, container, getByText, reject } = await shownThenGerman();
      await act(async () => { reject(httpError(502, { error: 'ai_failed', kind: 'technical' })); });
      expect((await findByRole('alert')).textContent).toContain('ai.errors.translateFailed');
      expect(bodyText(container)).toBe('word word');
      expect(getByRole('heading', { level: 1 }).textContent).toBe('Title a1');
      expect(getByText('ai.translation.by:Ollama')).toBeTruthy();
      expect((getByRole('button', { name: 'ai.showSource' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('says « Déjà en … » when the article is already in the language', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated([], { same: true, lang: 'fr' }));
    const { getByRole, findByText } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    expect(await findByText('ai.translation.alreadyTarget')).toBeTruthy();
  });
  it('never injects hostile markup returned by the model', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(translated([
      'Title <script>alert(0)</script>',
      'Bonjour <img src=x onerror=alert(1)> <script>alert(2)</script><a href="javascript:alert(3)">lien</a><svg onload=alert(4)></svg> fin',
    ]));
    const { getByRole, findByRole, container } = render(<ReadingPane />);
    fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
    await findByRole('button', { name: 'ai.showSource' });
    const html = container.querySelector('article')?.innerHTML ?? '';
    expect(bodyText(container)).toContain('Bonjour');
    for (const bad of ['onerror', '<script', 'javascript:', 'onload', 'alert(']) expect(html).not.toContain(bad);
  });
  it('has nothing to translate in an article without text', () => {
    const a = { ...article('t4'), content: '<img src="https://example.com/a.png" alt="">' } as Article;
    useFeedStore.setState({ selectedArticle: a, articles: [a] });
    const { getByRole } = render(<ReadingPane />);
    const btn = getByRole('button', { name: 'ai.translateArticle' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('ai.translation.nothing');
  });
  describe('translate event (keyboard shortcut, palette)', () => {
    const fire = () => act(() => { window.dispatchEvent(new CustomEvent('frirss:ai-translate')); });
    it('translates the open article: one article-scope request, then the translation on screen', async () => {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { findByRole, container } = render(<ReadingPane />);
      fire();
      expect(await findByRole('button', { name: 'ai.showSource' })).toBeTruthy();
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
      expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ articleId: 'a1', scope: 'article', targetLang: 'fr' });
      expect(bodyText(container)).toBe('word word');
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('does nothing more while the translation is on screen: no request, no switch to the source', async () => {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { findByRole, container } = render(<ReadingPane />);
      fire();
      await findByRole('button', { name: 'ai.showSource' });
      fire();
      await act(async () => { await Promise.resolve(); });
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
      expect(bodyText(container)).toBe('word word');
    });
    it('shows again a translation held after « Texte source », without a request', async () => {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { findByRole, container } = render(<ReadingPane />);
      fire();
      fireEvent.click(await findByRole('button', { name: 'ai.showSource' }));
      expect(bodyText(container)).toContain('mot mot');
      fire();
      expect(bodyText(container)).toBe('word word');
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    });
    it('does not start a second request while one is running', async () => {
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      fire();
      await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(1));
      fire();
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    });
    it.each([
      ['AI is off', () => useAiStore.setState({ config: { ...ON, enabled: false } })],
      ['no provider is usable', () => useAiStore.setState({ config: { ...ON, providers: [{ ...ON.providers[0], available: false }] } })],
      ['offline', () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); }],
      ['the article has no text', () => {
        const a = { ...article('t6'), content: '<img src="https://example.com/a.png" alt="">' } as Article;
        useFeedStore.setState({ selectedArticle: a, articles: [a] });
      }],
    ] as const)('does nothing when %s', (_label, setup) => {
      setup();
      render(<ReadingPane />);
      fire();
      expect(requestAiTranslation).not.toHaveBeenCalled();
    });
    it('stops listening once the pane is gone', () => {
      const { unmount } = render(<ReadingPane />);
      unmount();
      fire();
      expect(requestAiTranslation).not.toHaveBeenCalled();
    });
    // La palette ne propose « Traduire l'article » que si l'action ferait
    // quelque chose : elle le demande au volet par une sonde synchrone.
    it('answers the palette probe only while the action would do something', async () => {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { findByRole, unmount } = render(<ReadingPane />);
      expect(translateWouldAct()).toBe(true);
      fire();
      await findByRole('button', { name: 'ai.showSource' });
      expect(translateWouldAct()).toBe(false);
      unmount();
      expect(translateWouldAct()).toBe(false);
    });
    it('does not answer the probe when there is nothing to translate', () => {
      const a = { ...article('t7'), content: '<img src="https://example.com/a.png" alt="">' } as Article;
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      render(<ReadingPane />);
      expect(translateWouldAct()).toBe(false);
    });
  });
  describe('touch', () => {
    beforeEach(() => { useUiStore.setState({ layoutMode: 'mobile' } as never); });
    afterEach(() => { useUiStore.setState({ layoutMode: 'auto' } as never); });
    it('the « … » sheet offers « Traduire en… » and « Traduire avec… », which open the translation menu', () => {
      const { getByRole } = render(<ReadingPane />);
      fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
      const sheet = within(getByRole('dialog', { name: 'readingPane.more' }));
      expect(sheet.getByRole('button', { name: 'ai.translateWith' })).toBeTruthy();
      fireEvent.click(sheet.getByRole('button', { name: 'ai.translateTo' }));
      const menu = within(getByRole('dialog', { name: 'ai.translateArticleMenu' }));
      expect(menu.getByRole('group', { name: 'ai.translateTo' })).toBeTruthy();
    });
    it('closing the menu opened from the « … » sheet returns focus to the bar button, not to an unrendered chevron', () => {
      const { getByRole, queryByRole } = render(<ReadingPane />);
      expect(queryByRole('button', { name: 'ai.translateArticleMenu' })).toBeNull();
      fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
      const row = within(getByRole('dialog', { name: 'readingPane.more' })).getByRole('button', { name: 'ai.translateTo' });
      row.focus();
      fireEvent.click(row);
      getByRole('dialog', { name: 'ai.translateArticleMenu' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(queryByRole('dialog', { name: 'ai.translateArticleMenu' })).toBeNull();
      expect(document.activeElement).toBe(getByRole('button', { name: 'ai.translateArticle' }));
    });
    it('a pick in the touch sheet returns focus to the bar button', () => {
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      const { getByRole } = render(<ReadingPane />);
      fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
      fireEvent.click(within(getByRole('dialog', { name: 'readingPane.more' })).getByRole('button', { name: 'ai.translateTo' }));
      const menu = within(getByRole('dialog', { name: 'ai.translateArticleMenu' }));
      const pick = menu.getByRole('button', { name: languageName('de', 'fr') });
      pick.focus();
      const bar = getByRole('button', { name: 'ai.translateArticle' });
      fireEvent.click(pick);
      expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({ targetLang: 'de' });
      expect(document.activeElement).toBe(bar);
    });
    it('« Rien à traduire » is visible under the two sheet rows when there is no text', () => {
      const a = { ...article('t5'), content: '<img src="https://example.com/a.png" alt="">' } as Article;
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      const { getByRole } = render(<ReadingPane />);
      fireEvent.click(getByRole('button', { name: 'readingPane.more' }));
      const sheet = within(getByRole('dialog', { name: 'readingPane.more' }));
      for (const name of ['ai.translateTo', 'ai.translateWith']) {
        const row = sheet.getByRole('button', { name }) as HTMLButtonElement;
        expect(row.disabled).toBe(true);
        expect(within(row).getByText('ai.translation.nothing')).toBeTruthy();
        expect(row.getAttribute('aria-describedby')).toBeTruthy();
      }
    });
    describe('long press on the bar button', () => {
      beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
      afterEach(() => { vi.useRealTimers(); });
      it('opens the translation menu and sends nothing', () => {
        vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
        const { getByRole } = render(<ReadingPane />);
        const btn = getByRole('button', { name: 'ai.translateArticle' });
        fireEvent.touchStart(btn, { touches: [{ clientX: 10, clientY: 10 }] });
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
        fireEvent.touchEnd(btn);
        fireEvent.click(btn); // le clic de compatibilité qui suit le lever du doigt
        expect(getByRole('dialog', { name: 'ai.translateArticleMenu' })).toBeTruthy();
        expect(requestAiTranslation).not.toHaveBeenCalled();
      });
      it('a short tap translates', () => {
        vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
        const { getByRole, queryByRole } = render(<ReadingPane />);
        const btn = getByRole('button', { name: 'ai.translateArticle' });
        fireEvent.touchStart(btn, { touches: [{ clientX: 10, clientY: 10 }] });
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS / 5); });
        fireEvent.touchEnd(btn);
        fireEvent.click(btn);
        expect(requestAiTranslation).toHaveBeenCalledTimes(1);
        expect(queryByRole('dialog', { name: 'ai.translateArticleMenu' })).toBeNull();
      });
    });
    it('the bar button translates on a tap', async () => {
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word']));
      const { getByRole, findByRole } = render(<ReadingPane />);
      fireEvent.click(getByRole('button', { name: 'ai.translateArticle' }));
      expect(await findByRole('button', { name: 'ai.showSource' })).toBeTruthy();
    });
  });
});

describe('ReadingPane — déclencheurs automatiques par flux et catégorie', () => {
  const SUMMARY = { text: 'Le résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false };
  const translated = (segments: string[], over: Record<string, unknown> = {}) =>
    ({ segments, lang: 'fr', same: false, providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false, ...over });
  const extracted = (content: string) => ({ title: 't', content, excerpt: '', byline: '', siteName: '', length: content.length });
  const inTech = () => useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] }] } as never);
  const articleCalls = () => vi.mocked(requestAiTranslation).mock.calls.filter(([r]) => r.scope === 'article');
  // Horloge entièrement simulée : les bornes se mesurent à la milliseconde.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useUiStore.setState({ aiCategoryAutoSummary: {}, aiCategoryAutoTranslate: {} });
  });
  afterEach(() => { vi.useRealTimers(); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const select = (id: string) => act(() => { useFeedStore.setState({ selectedArticle: article(id) }); });

  describe('automatic translation', () => {
    it('a feed set to translate sends one article request after one second', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      await advance(999);
      expect(requestAiTranslation).not.toHaveBeenCalled();
      await advance(1);
      expect(articleCalls()).toHaveLength(1);
      expect(articleCalls()[0][0]).toMatchObject({ articleId: 'a1', scope: 'article', segments: ['Titre a1', expect.stringContaining('mot')] });
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('waits for the auto-extraction and translates the extracted body', async () => {
      const a = article('tx1');
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true, autoExtract: true } } });
      let finish!: (v: unknown) => void;
      vi.mocked(extractFullContent).mockReturnValue(new Promise((r) => { finish = r; }) as never);
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      await advance(200); // l'extraction automatique part après 100 ms
      expect(extractFullContent).toHaveBeenCalledTimes(1);
      await advance(3000);
      expect(requestAiTranslation).not.toHaveBeenCalled();
      await act(async () => { finish(extracted('<p>' + 'complet '.repeat(80) + '</p>')); });
      await advance(1000);
      expect(articleCalls()).toHaveLength(1);
      expect(articleCalls()[0][0].segments[1]).toContain('complet');
    });
    it('a feed set to off under a lit category sends nothing', async () => {
      inTech();
      useUiStore.setState({ aiCategoryAutoTranslate: { Tech: true }, feedSettings: { 'feed/1': { aiAutoTranslate: false } } });
      render(<ReadingPane />);
      await advance(3000);
      expect(requestAiTranslation).not.toHaveBeenCalled();
    });
    it('a lit category translates a feed without its own setting', async () => {
      inTech();
      useUiStore.setState({ aiCategoryAutoTranslate: { Tech: true } });
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      await advance(1000);
      expect(articleCalls()).toHaveLength(1);
    });
    it('sends nothing for an article left within the second', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      await advance(500);
      select('a2');
      await advance(999);
      expect(requestAiTranslation).not.toHaveBeenCalled();
      await advance(1);
      expect(articleCalls()).toHaveLength(1);
      expect(articleCalls()[0][0].articleId).toBe('a2');
    });
    it('« same » on an automatic run says nothing', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockResolvedValue(translated([], { same: true }));
      const { queryByText, queryByRole } = render(<ReadingPane />);
      await advance(1000);
      await advance(0);
      expect(articleCalls()).toHaveLength(1);
      expect(queryByText('ai.translation.alreadyTarget')).toBeNull();
      expect(queryByRole('alert')).toBeNull();
    });
    it('an error on an automatic run shows in the alert', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical' }));
      const { getByRole } = render(<ReadingPane />);
      await advance(1000);
      await advance(0);
      expect(getByRole('alert').textContent).toContain('ai.errors.translateFailed');
    });
    it('the notice of an automatic translation names the provider', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title a1', 'word word'], { lang: 'en' }));
      const { getByText } = render(<ReadingPane />);
      await advance(1000);
      await advance(0);
      expect(getByText('ai.translation.by:Ollama')).toBeTruthy();
    });
    it('an article with nothing to translate sends nothing and shows nothing', async () => {
      const a = { ...article('tx2'), content: '<img src="https://example.com/a.png" alt="">' } as Article;
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      const { queryByRole, getAllByRole, queryByText } = render(<ReadingPane />);
      await advance(3000);
      expect(requestAiTranslation).not.toHaveBeenCalled();
      expect(queryByRole('alert')).toBeNull();
      for (const region of getAllByRole('status')) expect(region.textContent).toBe('');
      expect(queryByText('ai.translation.nothing')).toBeNull();
    });
    it('does not translate again when the body changes after an automatic translation', async () => {
      // « Article complet » basculé : le corps change, la traduction revient à
      // `idle` — la visite, elle, a déjà eu sa traduction automatique.
      const a = article('tx3');
      useFeedStore.setState({ selectedArticle: a, articles: [a] });
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockResolvedValue(translated(['Title', 'word word'], { lang: 'en' }));
      const { container, getByRole } = render(<ReadingPane />);
      await advance(1000);
      await advance(0);
      expect(getByRole('button', { name: 'ai.showSource' })).toBeTruthy();
      expect(articleCalls()).toHaveLength(1);
      await putExtract('tx3', extracted('<p>The full article, now in the reading pane.</p>'));
      const extract = container.querySelector('[title="readingPane.fullContent"]') as HTMLElement;
      await act(async () => { fireEvent.click(extract); await Promise.resolve(); });
      expect(getByRole('button', { name: 'ai.translateArticle' })).toBeTruthy();
      await advance(2000);
      expect(articleCalls()).toHaveLength(1);
    });
    it('runs once per visit, and again when the user comes back', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoTranslate: true } } });
      vi.mocked(requestAiTranslation).mockRejectedValue(httpError(502, { error: 'ai_failed', kind: 'technical' }));
      render(<ReadingPane />);
      await advance(1000);
      await advance(3000);
      expect(articleCalls()).toHaveLength(1);
      select('a2');
      await advance(1000);
      select('a1');
      await advance(1000);
      expect(articleCalls().map(([r]) => r.articleId)).toEqual(['a1', 'a2', 'a1']);
    });
  });

  describe('automatic summary', () => {
    it('a feed set to summarise does so with the global switch off', async () => {
      useUiStore.setState({ aiAutoSummary: false, feedSettings: { 'feed/1': { aiAutoSummary: true } } });
      vi.mocked(requestAiSummary).mockResolvedValue(SUMMARY);
      render(<ReadingPane />);
      await advance(1000);
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      expect(requestAiSummary).toHaveBeenCalledWith(expect.objectContaining({ articleId: 'a1' }));
    });
    it('a feed set to off sends nothing with the global switch on', async () => {
      useUiStore.setState({ aiAutoSummary: true, feedSettings: { 'feed/1': { aiAutoSummary: false } } });
      vi.mocked(requestAiSummary).mockResolvedValue(SUMMARY);
      render(<ReadingPane />);
      await advance(3000);
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('a lit category summarises a feed without its own setting', async () => {
      inTech();
      useUiStore.setState({ aiAutoSummary: false, aiCategoryAutoSummary: { Tech: true } });
      vi.mocked(requestAiSummary).mockResolvedValue(SUMMARY);
      render(<ReadingPane />);
      await advance(1000);
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
    });
    it('a category set to off sends nothing with the global switch on', async () => {
      inTech();
      useUiStore.setState({ aiAutoSummary: true, aiCategoryAutoSummary: { Tech: false } });
      vi.mocked(requestAiSummary).mockResolvedValue(SUMMARY);
      render(<ReadingPane />);
      await advance(3000);
      expect(requestAiSummary).not.toHaveBeenCalled();
    });
    it('summary and translation both run on the same article', async () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { aiAutoSummary: true, aiAutoTranslate: true } } });
      vi.mocked(requestAiSummary).mockResolvedValue(SUMMARY);
      vi.mocked(requestAiTranslation).mockReturnValue(new Promise(() => {}) as never);
      render(<ReadingPane />);
      await advance(1000);
      expect(requestAiSummary).toHaveBeenCalledTimes(1);
      expect(articleCalls()).toHaveLength(1);
    });
  });
});
