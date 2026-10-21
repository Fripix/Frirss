// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }) }));
vi.mock('../../api/backend', () => ({ requestAiTranslation: vi.fn() }));
// Le vrai découpage, espionné : il ne doit tourner qu'à la demande.
vi.mock('../../lib/articleSegments', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../lib/articleSegments')>();
  return { ...m, segmentArticle: vi.fn(m.segmentArticle) };
});

import { useArticleTranslation, hasReadableText, type ArticleTranslationInput } from './useArticleTranslation';
import { requestAiTranslation, type AiTranslationResult } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { __resetPendingSummariesForTests } from './aiPending';
import { segmentArticle } from '../../lib/articleSegments';

const words = (w: string, n: number) => Array.from({ length: n }, () => w).join(' ');
// Deux paragraphes de 1 000 mots : le titre et le premier tiennent dans un lot
// d'environ 1 200 mots, le second part dans un autre.
const TWO_BATCHES = `<p>${words('one', 1000)}</p><img src="https://example.com/a.png" alt=""><p>${words('two', 1000)}</p>`;

const result = (segments: string[], over: Partial<AiTranslationResult> = {}): AiTranslationResult =>
  ({ segments, lang: 'en', same: false, providerId: 1, providerName: 'Ollama', model: 'm', fromCache: false, ...over });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const base: ArticleTranslationInput = {
  articleId: 'a1', title: 'Hello world', bodyHtml: TWO_BATCHES, targetLang: 'fr',
  routing: () => ({ fallback: true }), enabled: true,
};

beforeEach(() => {
  vi.mocked(requestAiTranslation).mockReset();
  vi.mocked(segmentArticle).mockClear();
  useAuthStore.setState({ backendUser: { id: 2, username: 'u', role: 'user' } as never });
  __resetPendingSummariesForTests();
});

describe('useArticleTranslation', () => {
  it('sends the batches one after the other, follows the progress, and replaces the body only after the last', async () => {
    const first = deferred<AiTranslationResult>();
    const second = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result: hook } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });

    act(() => { hook.current.translate(); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({
      articleId: 'a1', scope: 'article', targetLang: 'fr', fallback: true,
      segments: ['Hello world', words('one', 1000)],
    });
    // Le numéro de lot ne part pas au serveur.
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).not.toHaveProperty('batch');
    expect(hook.current.state).toBe('loading');
    expect(hook.current.progress).toEqual({ done: 0, total: 2 });

    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0].segments).toEqual([words('two', 1000)]);
    expect(hook.current.progress).toEqual({ done: 1, total: 2 });
    expect(hook.current.html).toBeNull();
    expect(hook.current.showing).toBe('source');

    await act(async () => { second.resolve(result([words('deux', 1000)])); });
    expect(hook.current.state).toBe('done');
    expect(hook.current.progress).toBeNull();
    expect(hook.current.title).toBe('Bonjour le monde');
    expect(hook.current.html).toContain(words('un', 1000));
    expect(hook.current.html).toContain(words('deux', 1000));
    expect(hook.current.html).toContain('<img src="https://example.com/a.png"');
    expect(hook.current.showing).toBe('translation');
    expect(hook.current.lang).toBe('fr');
    expect(hook.current.providerName).toBe('Ollama');
    expect(hook.current.partial).toBe(false);
  });

  it('a failure at the second batch is an error, and nothing is replaced', async () => {
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(result(['Bonjour le monde', words('un', 1000)]))
      .mockRejectedValueOnce(Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data: { error: 'ai_failed', kind: 'technical' } } }));
    const { result: hook } = renderHook(() => useArticleTranslation(base));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('error'));
    expect(hook.current.error).toBe('ai.errors.translateFailed');
    expect(hook.current.html).toBeNull();
    expect(hook.current.title).toBeNull();
    expect(hook.current.showing).toBe('source');
  });

  it('same at the first batch: state same, no second request', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result([], { same: true, lang: 'fr' }));
    const { result: hook } = renderHook(() => useArticleTranslation(base));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('same'));
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(hook.current.html).toBeNull();
    expect(hook.current.lang).toBe('fr');
  });

  it('a new body (extraction arrived) goes back to idle and to the source', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Titre', 'Bonjour']));
    const props = { ...base, bodyHtml: '<p>Hello</p>' };
    const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: props });
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    rerender({ ...props, bodyHtml: '<p>Hello, the full article.</p>' });
    expect(hook.current.state).toBe('idle');
    expect(hook.current.showing).toBe('source');
    expect(hook.current.html).toBeNull();
  });

  it('ignores the batches still in flight once the body changed', async () => {
    const first = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise);
    const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
    act(() => { hook.current.translate(); });
    rerender({ ...base, bodyHtml: '<p>Another body entirely.</p>' });
    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe('idle');
  });

  it('stops the batch loop when the reading pane unmounts (tablet back, desktop 2-panel close)', async () => {
    const first = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise).mockResolvedValue(result([words('deux', 1000)]));
    const { result: hook, unmount } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
    act(() => { hook.current.translate(); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
  });

  it('stops the batch loop silently when the account changes mid-flight (logout, another login)', async () => {
    useAuthStore.setState({ backendToken: 'token-a', backendUser: { id: 2, username: 'a', role: 'user' } as never });
    const first = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise).mockResolvedValue(result([words('deux', 1000)]));
    const { result: hook } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
    act(() => { hook.current.translate(); });
    act(() => { useAuthStore.setState({ backendToken: 'token-b', backendUser: { id: 3, username: 'b', role: 'user' } as never }); });
    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    // Rien n'est écrit pour le compte suivant : ni erreur, ni progression avancée.
    expect(hook.current.error).toBeNull();
    expect(hook.current.html).toBeNull();
    expect(hook.current.progress).toEqual({ done: 0, total: 2 });
  });

  it('stops the batch loop when the token alone changes mid-flight', async () => {
    useAuthStore.setState({ backendToken: 'token-a', backendUser: { id: 2, username: 'a', role: 'user' } as never });
    const first = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise).mockResolvedValue(result([words('deux', 1000)]));
    const { result: hook } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
    act(() => { hook.current.translate(); });
    act(() => { useAuthStore.setState({ backendToken: null }); });
    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
  });

  it('nothing to translate: translate is unavailable and sends nothing', () => {
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<img src="https://example.com/a.png" alt=""><p>123</p>' }));
    expect(hook.current.canTranslate).toBe(false);
    act(() => { hook.current.translate(); });
    expect(requestAiTranslation).not.toHaveBeenCalled();
    expect(hook.current.state).toBe('idle');
  });

  it('switches between source and translation without any request', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Titre', 'Bonjour']));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.showing).toBe('translation'));
    act(() => { hook.current.showSource(); });
    expect(hook.current.showing).toBe('source');
    act(() => { hook.current.showTranslation(); });
    expect(hook.current.showing).toBe('translation');
    // Le bouton principal remontre la traduction tenue, sans la redemander.
    act(() => { hook.current.showSource(); });
    act(() => { hook.current.translate(); });
    expect(hook.current.showing).toBe('translation');
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
  });

  it('a forced provider and language go with every batch, and a fallback is reported', async () => {
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(result(['Hallo Welt', words('eins', 1000)], { fellBackFrom: 'Claude' }))
      .mockResolvedValueOnce(result([words('zwei', 1000)]));
    const { result: hook } = renderHook(() => useArticleTranslation(base));
    await act(async () => { hook.current.translate({ lang: 'de', providerId: 3 }); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    for (const [body] of vi.mocked(requestAiTranslation).mock.calls) expect(body).toMatchObject({ targetLang: 'de', provider: 3, fallback: true });
    expect(hook.current.lang).toBe('de');
    expect(hook.current.fellBackFrom).toBe('Claude');
  });

  it('a segment too heavy for any request is left in the source, and the translation says it is partial', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Bonjour le monde', 'Fin']));
    const huge = 'x'.repeat(200_001);
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: `<p>${huge}</p><p>End</p>` }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0].segments).toEqual(['Hello world', 'End']);
    expect(hook.current.partial).toBe(true);
    expect(hook.current.partialOf).toEqual({ translated: 1, total: 2 });
    expect(hook.current.html).toContain(huge);
    expect(hook.current.html).toContain('<p>Fin</p>');
  });

  it('does not send an empty title', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Bonjour']));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, title: '', bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0].segments).toEqual(['Hello']);
    expect(hook.current.title).toBeNull();
    expect(hook.current.html).toBe('<p>Bonjour</p>');
  });

  it('a return to the article mid-flight shares the batch already requested', async () => {
    const first = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValueOnce(first.promise).mockResolvedValueOnce(result([words('deux', 1000)]));
    const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
    act(() => { hook.current.translate(); });
    rerender({ ...base, articleId: 'a2' });
    rerender(base);
    expect(hook.current.state).toBe('idle');
    act(() => { hook.current.translate(); });
    await act(async () => { first.resolve(result(['Bonjour le monde', words('un', 1000)])); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(requestAiTranslation).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled', () => {
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, enabled: false }));
    act(() => { hook.current.translate(); });
    expect(requestAiTranslation).not.toHaveBeenCalled();
  });

  it('does no segmentation work while disabled, whatever the article', () => {
    const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: { ...base, enabled: false } });
    rerender({ ...base, enabled: false, articleId: 'a2', bodyHtml: '<p>Another article.</p>' });
    expect(hook.current.canTranslate).toBe(true);
    act(() => { hook.current.translate(); });
    expect(segmentArticle).not.toHaveBeenCalled();
  });

  it('segments lazily: nothing at render, once for a translate() call', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Titre', 'Bonjour']));
    const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: { ...base, bodyHtml: '<p>Hello</p>' } });
    rerender({ ...base, bodyHtml: '<p>Hello there</p>' });
    expect(segmentArticle).not.toHaveBeenCalled();
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(segmentArticle).toHaveBeenCalledTimes(1);
  });

  it('a script or a style is not text to translate', () => {
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<script>var x = 1;</script><style>p { color: red }</style><p>42</p>' }));
    expect(hook.current.canTranslate).toBe(false);
  });

  it('when the segmentation finds nothing after all, nothing leaves and translate becomes unavailable', () => {
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<pre>const answer = 42;</pre>' }));
    expect(hook.current.canTranslate).toBe(true);
    act(() => { hook.current.translate(); });
    expect(requestAiTranslation).not.toHaveBeenCalled();
    expect(hook.current.canTranslate).toBe(false);
  });

  it('a segmentation that throws ends in the error state, nothing sent', () => {
    vi.mocked(segmentArticle).mockImplementationOnce(() => { throw new Error('parser'); });
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    act(() => { hook.current.translate(); });
    expect(hook.current.state).toBe('error');
    expect(hook.current.error).toBe('ai.errors.translateFailed');
    expect(requestAiTranslation).not.toHaveBeenCalled();
  });
});

describe('hasReadableText', () => {
  const timed = (html: string) => {
    const start = performance.now();
    const value = hasReadableText(html);
    return { value, ms: performance.now() - start };
  };
  it('stays linear on malformed input: 100 KB of « < »', () => {
    const r = timed('<'.repeat(100_000));
    expect(r.value).toBe(false);
    expect(r.ms).toBeLessThan(200);
  });
  it('stays linear on malformed input: 160 KB of unclosed « <script »', () => {
    const r = timed('<script '.repeat(20_000));
    expect(r.value).toBe(false);
    expect(r.ms).toBeLessThan(200);
  });
  it('finds the one paragraph of text in a 1 MB body', () => {
    const r = timed(`<div>${' '.repeat(1_000_000)}<p>Hello</p></div>`);
    expect(r.value).toBe(true);
    expect(r.ms).toBeLessThan(200);
  });
  it('keeps the semantics: tags, scripts, styles and entities are not text; a letter in a text node is', () => {
    expect(hasReadableText('<p>42 &nbsp; &#233; &amp;</p><img alt="photo" src="a.png">')).toBe(false);
    expect(hasReadableText('<SCRIPT>var x;</SCRIPT><style>p{color:red}</style><noscript>No</noscript><template>T</template>')).toBe(false);
    expect(hasReadableText('<!-- note --><p>1</p>')).toBe(false);
    expect(hasReadableText('<p>1 < 2</p><p>é</p>')).toBe(true);
    expect(hasReadableText('<p>3 &lt; 4 and</p>')).toBe(true);
    expect(hasReadableText('Bare text')).toBe(true);
    expect(hasReadableText('<p>日本</p>')).toBe(true);
  });
});
