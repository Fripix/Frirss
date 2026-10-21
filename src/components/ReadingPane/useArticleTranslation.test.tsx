// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  localStorage.clear();
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

  it('never sends a strikethrough <s> to the model: it goes as <del>, and the translation keeps <del>', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValueOnce(result(['Bonjour', 'Prix <del>10</del> 5 francs']));
    const { result: hook } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), {
      initialProps: { ...base, bodyHtml: '<p>Price <s>10</s> 5 francs</p>' },
    });
    await act(async () => { hook.current.translate(); });
    const sent = vi.mocked(requestAiTranslation).mock.calls[0][0].segments;
    expect(sent).toEqual(['Hello world', 'Price <del>10</del> 5 francs']);
    expect(sent.join('')).not.toMatch(/<\/?s[\s>]/i);
    expect(hook.current.html).toContain('<del>10</del>');
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

  it('une erreur garde le fournisseur fautif, une demande suivante l\'efface', async () => {
    vi.mocked(requestAiTranslation)
      .mockRejectedValueOnce(Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data: { error: 'ai_failed', kind: 'technical', provider: { id: 7, name: 'Ollama' } } } }))
      .mockReturnValueOnce(new Promise(() => {}) as never);
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('error'));
    expect(hook.current.errorProvider).toBe(7);
    await act(async () => { hook.current.translate({ providerId: 8 }); });
    expect(hook.current.state).toBe('loading');
    expect(hook.current.errorProvider).toBeUndefined();
  });

  it('une erreur sans fournisseur (réseau, 409) n\'en garde aucun', async () => {
    vi.mocked(requestAiTranslation).mockRejectedValueOnce(Object.assign(new Error('http 409'), { isAxiosError: true, response: { status: 409, data: { error: 'no_provider' } } }));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('error'));
    expect(hook.current.errorProvider).toBeUndefined();
  });

  it('un échec de « Retraduire » sur une traduction tenue garde aussi le fournisseur fautif', async () => {
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(result(['Titre', 'Bonjour']))
      .mockRejectedValueOnce(Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data: { error: 'ai_failed', kind: 'technical', provider: { id: 1, name: 'Ollama' } } } }));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    await act(async () => { hook.current.translate({ lang: 'de' }); });
    await waitFor(() => expect(hook.current.error).toBe('ai.errors.translateFailed'));
    expect(hook.current.state).toBe('done');
    expect(hook.current.errorProvider).toBe(1);
  });

  it('a failure while re-translating into another language keeps the translation already paid for, with the error', async () => {
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(result(['Titre', 'Bonjour']))
      .mockRejectedValueOnce(Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data: { error: 'ai_failed', kind: 'technical' } } }));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    await act(async () => { hook.current.translate({ lang: 'de' }); });
    await waitFor(() => expect(hook.current.error).toBe('ai.errors.translateFailed'));
    expect(hook.current.state).toBe('done');
    expect(hook.current.lang).toBe('fr');
    expect(hook.current.html).toBe('<p>Bonjour</p>');
    expect(hook.current.title).toBe('Titre');
    expect(hook.current.showing).toBe('translation');
    // L'erreur s'efface à la demande suivante.
    vi.mocked(requestAiTranslation).mockReturnValueOnce(new Promise(() => {}) as never);
    act(() => { hook.current.translate({ lang: 'de' }); });
    expect(hook.current.error).toBeNull();
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

  it('regenerate: asks again past the translation held, with regenerate on every batch, and its own shared key', async () => {
    vi.mocked(requestAiTranslation)
      .mockResolvedValueOnce(result(['Titre', 'Bonjour'], { providerId: 3 }))
      .mockResolvedValueOnce(result(['Titre', 'Salut'], { providerId: 3 }));
    const { result: hook } = renderHook(() => useArticleTranslation({ ...base, bodyHtml: '<p>Hello</p>' }));
    await act(async () => { hook.current.translate({ lang: 'de', providerId: 3 }); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).not.toHaveProperty('regenerate', true);
    await act(async () => { hook.current.translate({ lang: 'de', providerId: 3 }, { regenerate: true }); });
    await waitFor(() => expect(requestAiTranslation).toHaveBeenCalledTimes(2));
    expect(vi.mocked(requestAiTranslation).mock.calls[1][0]).toMatchObject({ targetLang: 'de', provider: 3, regenerate: true });
    await waitFor(() => expect(hook.current.html).toContain('Salut'));
    expect(hook.current.showing).toBe('translation');
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

  describe('a batch that ran out of time', () => {
    const httpError = (data: Record<string, unknown>) =>
      Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data } });
    const timedOut = () => httpError({ error: 'ai_failed', kind: 'technical', detail: 'deadline' });
    const proxyError = (status: number, data: string) => Object.assign(new Error(`http ${status}`), { isAxiosError: true, response: { status, data } });
    // Horloge factice : une coupure amont n'en est une qu'après une longue attente.
    let clock = 1_000_000;
    let nowSpy: ReturnType<typeof vi.spyOn> | null = null;
    beforeEach(() => { clock = 1_000_000; nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock); });
    afterEach(() => { nowSpy?.mockRestore(); });
    const proxyCut = () => async () => { clock += 61_000; throw proxyError(504, ''); };
    const sent = () => vi.mocked(requestAiTranslation).mock.calls.map(([body]) => body.segments);

    it('is replayed once, split in two, then the next batch goes: four requests, the body assembled', async () => {
      const firstHalf = deferred<AiTranslationResult>();
      const secondHalf = deferred<AiTranslationResult>();
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(timedOut())
        .mockReturnValueOnce(firstHalf.promise)
        .mockReturnValueOnce(secondHalf.promise)
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      // Les moitiés partent en série, et la notice garde le numéro du lot d'origine.
      expect(sent()).toEqual([['Hello world', words('one', 1000)], ['Hello world']]);
      expect(hook.current.state).toBe('loading');
      expect(hook.current.progress).toEqual({ done: 0, total: 2 });
      await act(async () => { firstHalf.resolve(result(['Bonjour le monde'])); });
      expect(sent()).toHaveLength(3);
      expect(sent()[2]).toEqual([words('one', 1000)]);
      expect(hook.current.progress).toEqual({ done: 0, total: 2 });
      await act(async () => { secondHalf.resolve(result([words('un', 1000)])); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(sent()).toEqual([
        ['Hello world', words('one', 1000)], ['Hello world'], [words('one', 1000)], [words('two', 1000)],
      ]);
      expect(hook.current.title).toBe('Bonjour le monde');
      expect(hook.current.html).toContain(words('un', 1000));
      expect(hook.current.html).toContain(words('deux', 1000));
      expect(hook.current.html).not.toContain(words('one', 1000));
    });

    it('a half that runs out of time again is an error: no further split, nothing replaced', async () => {
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(timedOut())
        .mockRejectedValueOnce(timedOut());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(sent()).toEqual([['Hello world', words('one', 1000)], ['Hello world']]);
      expect(hook.current.error).toBe('ai.errors.translateFailed');
      expect(hook.current.html).toBeNull();
      expect(hook.current.title).toBeNull();
      expect(hook.current.showing).toBe('source');
    });

    it('another failure is not split', async () => {
      vi.mocked(requestAiTranslation).mockRejectedValueOnce(httpError({ error: 'ai_failed', kind: 'technical' }));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    });

    it('a one-segment batch that runs out of time is an error, the batch before it is not resent', async () => {
      vi.mocked(requestAiTranslation)
        .mockResolvedValueOnce(result(['Bonjour le monde', words('un', 1000)]))
        .mockRejectedValueOnce(timedOut());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(sent()).toEqual([['Hello world', words('one', 1000)], [words('two', 1000)]]);
      expect(hook.current.error).toBe('ai.errors.translateFailed');
      expect(hook.current.html).toBeNull();
    });

    it('a return mid-replay reuses the batch in flight: no whole batch resent, the second run assembles the body', async () => {
      const firstHalf = deferred<AiTranslationResult>();
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(timedOut())
        .mockReturnValueOnce(firstHalf.promise)
        .mockResolvedValueOnce(result([words('un', 1000)]))
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
      await act(async () => { hook.current.translate(); });
      expect(sent()).toEqual([['Hello world', words('one', 1000)], ['Hello world']]);
      // Le lecteur part puis revient pendant la première moitié, et relance.
      rerender({ ...base, articleId: 'a2' });
      rerender(base);
      expect(hook.current.state).toBe('idle');
      await act(async () => { hook.current.translate(); });
      expect(requestAiTranslation).toHaveBeenCalledTimes(2);
      await act(async () => { firstHalf.resolve(result(['Bonjour le monde'])); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(sent()).toEqual([
        ['Hello world', words('one', 1000)], ['Hello world'], [words('one', 1000)], [words('two', 1000)],
      ]);
      expect(hook.current.title).toBe('Bonjour le monde');
      expect(hook.current.html).toContain(words('un', 1000));
      expect(hook.current.html).toContain(words('deux', 1000));
      expect(hook.current.html).not.toContain(words('one', 1000));
    });

    it('a first half already in the language stops at the first batch, without the second half', async () => {
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(timedOut())
        .mockResolvedValueOnce(result([], { same: true, lang: 'fr' }));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('same'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(2);
    });

    it('a second half already in the language keeps its segments, the first half is applied', async () => {
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(timedOut())
        .mockResolvedValueOnce(result(['Bonjour le monde']))
        .mockResolvedValueOnce(result([], { same: true, lang: 'fr' }))
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(4);
      expect(hook.current.title).toBe('Bonjour le monde');
      expect(hook.current.html).toContain(words('one', 1000));
      expect(hook.current.html).toContain(words('deux', 1000));
    });

    it('a batch cut by a reverse proxy (504, no body) is replayed in two halves too', async () => {
      vi.mocked(requestAiTranslation)
        .mockImplementationOnce(proxyCut())
        .mockResolvedValueOnce(result(['Bonjour le monde']))
        .mockResolvedValueOnce(result([words('un', 1000)]))
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(sent()).toEqual([
        ['Hello world', words('one', 1000)], ['Hello world'], [words('one', 1000)], [words('two', 1000)],
      ]);
      expect(hook.current.html).toContain(words('un', 1000));
      expect(hook.current.html).toContain(words('deux', 1000));
    });

    it('a half cut by the reverse proxy says so: nothing replaced, no further request', async () => {
      vi.mocked(requestAiTranslation)
        .mockImplementationOnce(proxyCut())
        .mockImplementationOnce(proxyCut());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(2);
      expect(hook.current.error).toBe('ai.errors.proxyTimeout');
      expect(hook.current.html).toBeNull();
      expect(hook.current.title).toBeNull();
    });

    it('a one-segment batch cut by the reverse proxy says so, the batch before it is not resent', async () => {
      vi.mocked(requestAiTranslation)
        .mockResolvedValueOnce(result(['Bonjour le monde', words('un', 1000)]))
        .mockImplementationOnce(proxyCut());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(sent()).toEqual([['Hello world', words('one', 1000)], [words('two', 1000)]]);
      expect(hook.current.error).toBe('ai.errors.proxyTimeout');
      expect(hook.current.html).toBeNull();
    });

    it('a network error after a long wait is taken for a cut: the batch is split', async () => {
      vi.mocked(requestAiTranslation)
        .mockImplementationOnce(async () => { clock += 61_000; throw Object.assign(new Error('Network Error'), { isAxiosError: true }); })
        .mockResolvedValueOnce(result(['Bonjour le monde']))
        .mockResolvedValueOnce(result([words('un', 1000)]))
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(4);
    });

    it('a fast 502 page (backend down) is not a proxy cut: neutral error, one request, no replay', async () => {
      vi.mocked(requestAiTranslation).mockImplementationOnce(async () => { clock += 200; throw proxyError(502, '<html>502 Bad Gateway</html>'); });
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
      expect(hook.current.error).toBe('ai.errors.translateFailed');
      expect(hook.current.html).toBeNull();
    });

    it('a quick network error is not taken for a cut: no split', async () => {
      vi.mocked(requestAiTranslation).mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
      expect(hook.current.error).toBe('ai.errors.translateFailed');
    });

    const malformed = () => httpError({ error: 'ai_failed', kind: 'technical', detail: 'segments' });

    it('a malformed answer is replayed once, split in two, then the next batch goes: four requests, the body assembled', async () => {
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(malformed())
        .mockResolvedValueOnce(result(['Bonjour le monde']))
        .mockResolvedValueOnce(result([words('un', 1000)]))
        .mockResolvedValueOnce(result([words('deux', 1000)]));
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(sent()).toEqual([
        ['Hello world', words('one', 1000)], ['Hello world'], [words('one', 1000)], [words('two', 1000)],
      ]);
      expect(hook.current.title).toBe('Bonjour le monde');
      expect(hook.current.html).toContain(words('un', 1000));
      expect(hook.current.html).toContain(words('deux', 1000));
      expect(hook.current.html).not.toContain(words('one', 1000));
    });

    it('a malformed half says so: nothing replaced, no further split', async () => {
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(malformed())
        .mockRejectedValueOnce(malformed());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(sent()).toEqual([['Hello world', words('one', 1000)], ['Hello world']]);
      expect(hook.current.error).toBe('ai.errors.segments');
      expect(hook.current.html).toBeNull();
      expect(hook.current.title).toBeNull();
      expect(hook.current.showing).toBe('source');
    });

    it('a malformed one-segment batch says so at once, the batch before it is not resent', async () => {
      vi.mocked(requestAiTranslation)
        .mockResolvedValueOnce(result(['Bonjour le monde', words('un', 1000)]))
        .mockRejectedValueOnce(malformed());
      const { result: hook } = renderHook(() => useArticleTranslation(base));
      await act(async () => { hook.current.translate(); });
      await waitFor(() => expect(hook.current.state).toBe('error'));
      expect(sent()).toEqual([['Hello world', words('one', 1000)], [words('two', 1000)]]);
      expect(hook.current.error).toBe('ai.errors.segments');
      expect(hook.current.html).toBeNull();
    });

    it('stops between the halves once the article changed', async () => {
      const firstHalf = deferred<AiTranslationResult>();
      vi.mocked(requestAiTranslation).mockRejectedValueOnce(timedOut()).mockReturnValueOnce(firstHalf.promise);
      const { result: hook, rerender } = renderHook((p: ArticleTranslationInput) => useArticleTranslation(p), { initialProps: base });
      await act(async () => { hook.current.translate(); });
      expect(requestAiTranslation).toHaveBeenCalledTimes(2);
      rerender({ ...base, articleId: 'a2' });
      await act(async () => { firstHalf.resolve(result(['Bonjour le monde'])); });
      expect(requestAiTranslation).toHaveBeenCalledTimes(2);
      expect(hook.current.state).toBe('idle');
    });
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

describe('useArticleTranslation: per-device memory of a shown translation', () => {
  const small = { ...base, bodyHtml: '<p>Hello</p>' };
  const notCached = () => Object.assign(new Error('http 404'), { isAxiosError: true, response: { status: 404, data: { error: 'not_cached' } } });
  const memory = () => JSON.parse(localStorage.getItem('frirss_aiShown:2') ?? '{}') as Record<string, { lang: string; providerId?: number; hash: string }>;

  async function showOnce() {
    vi.mocked(requestAiTranslation).mockResolvedValueOnce(result(['Titre', 'Bonjour'], { providerId: 7 }));
    const first = renderHook(() => useArticleTranslation(small));
    await act(async () => { first.result.current.translate(); });
    await waitFor(() => expect(first.result.current.state).toBe('done'));
    first.unmount();
    vi.mocked(requestAiTranslation).mockReset();
  }

  it('remembers the translation once it is shown', async () => {
    await showOnce();
    expect(memory().a1).toMatchObject({ lang: 'fr', providerId: 7 });
  });

  it('an article whose translation was shown is replayed from the cache on return', async () => {
    await showOnce();
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Titre', 'Bonjour'], { providerId: 7, fromCache: true }));
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).toMatchObject({
      cacheOnly: true, provider: 7, targetLang: 'fr', articleId: 'a1',
    });
    expect(vi.mocked(requestAiTranslation).mock.calls[0][0]).not.toHaveProperty('regenerate');
    expect(hook.current.showing).toBe('translation');
    expect(hook.current.html).toBe('<p>Bonjour</p>');
    expect(hook.current.title).toBe('Titre');
    expect(hook.current.error).toBeNull();
    expect(memory().a1).toMatchObject({ lang: 'fr', providerId: 7 });
  });

  it('shows the loading state while the replay runs', async () => {
    await showOnce();
    const d = deferred<AiTranslationResult>();
    vi.mocked(requestAiTranslation).mockReturnValue(d.promise);
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await waitFor(() => expect(hook.current.state).toBe('loading'));
    await act(async () => { d.resolve(result(['Titre', 'Bonjour'])); });
    expect(hook.current.state).toBe('done');
  });

  it('nothing is replayed without a remembered translation, or when the AI is disabled', async () => {
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    expect(hook.current.state).toBe('idle');
    expect(requestAiTranslation).not.toHaveBeenCalled();
    await showOnce();
    renderHook(() => useArticleTranslation({ ...small, enabled: false }));
    expect(requestAiTranslation).not.toHaveBeenCalled();
  });

  it('a body that changed since is not replayed', async () => {
    await showOnce();
    renderHook(() => useArticleTranslation({ ...small, bodyHtml: '<p>Hello, the full article.</p>' }));
    expect(requestAiTranslation).not.toHaveBeenCalled();
  });

  it('a 404 not_cached ends idle with no message, and the memory is forgotten', async () => {
    await showOnce();
    vi.mocked(requestAiTranslation).mockRejectedValue(notCached());
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await waitFor(() => expect(memory().a1).toBeUndefined());
    expect(hook.current.state).toBe('idle');
    expect(hook.current.error).toBeNull();
    expect(hook.current.showing).toBe('source');
    expect(hook.current.html).toBeNull();
  });

  it('any other failure of a replay is silent too (provider gone, server down)', async () => {
    await showOnce();
    vi.mocked(requestAiTranslation).mockRejectedValue(
      Object.assign(new Error('http 409'), { isAxiosError: true, response: { status: 409, data: { error: 'no_provider' } } }),
    );
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await waitFor(() => expect(memory().a1).toBeUndefined());
    expect(hook.current.state).toBe('idle');
    expect(hook.current.error).toBeNull();
  });

  it('a replay already in the language ends idle and forgets', async () => {
    await showOnce();
    vi.mocked(requestAiTranslation).mockResolvedValue(result([], { same: true, lang: 'fr' }));
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await waitFor(() => expect(memory().a1).toBeUndefined());
    expect(hook.current.state).toBe('idle');
  });

  it('"Source text" clears the memory', async () => {
    vi.mocked(requestAiTranslation).mockResolvedValue(result(['Titre', 'Bonjour']));
    const { result: hook } = renderHook(() => useArticleTranslation(small));
    await act(async () => { hook.current.translate(); });
    await waitFor(() => expect(hook.current.state).toBe('done'));
    expect(memory().a1).toBeDefined();
    act(() => { hook.current.showSource(); });
    expect(memory().a1).toBeUndefined();
    act(() => { hook.current.showTranslation(); });
    expect(memory().a1).toMatchObject({ lang: 'fr' });
  });

  it('a replay never splits a batch in two: a deadline 502 is one call, silent', async () => {
    const big = { ...small, bodyHtml: '<p>One</p><p>Two</p><p>Three</p>' };
    vi.mocked(requestAiTranslation).mockResolvedValueOnce(result(['T', 'a', 'b', 'c'], { providerId: 7 }));
    const first = renderHook(() => useArticleTranslation(big));
    await act(async () => { first.result.current.translate(); });
    await waitFor(() => expect(first.result.current.state).toBe('done'));
    first.unmount();
    vi.mocked(requestAiTranslation).mockReset();
    vi.mocked(requestAiTranslation).mockRejectedValue(
      Object.assign(new Error('http 502'), { isAxiosError: true, response: { status: 502, data: { error: 'ai_failed', detail: 'deadline' } } }),
    );
    const { result: hook } = renderHook(() => useArticleTranslation(big));
    await waitFor(() => expect(memory().a1).toBeUndefined());
    expect(requestAiTranslation).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe('idle');
    expect(hook.current.error).toBeNull();
  });

  describe('a translation that was split in two when paid is cached as two halves', () => {
    const big = { ...base, bodyHtml: '<p>One</p><p>Two</p><p>Three</p>' };
    const http = (status: number, data: unknown) => Object.assign(new Error(`http ${status}`), { isAxiosError: true, response: { status, data } });

    async function showBig() {
      vi.mocked(requestAiTranslation).mockResolvedValueOnce(result(['T', 'a', 'b', 'c'], { providerId: 7 }));
      const first = renderHook(() => useArticleTranslation(big));
      await act(async () => { first.result.current.translate(); });
      await waitFor(() => expect(first.result.current.state).toBe('done'));
      first.unmount();
      vi.mocked(requestAiTranslation).mockReset();
    }
    const sent = () => vi.mocked(requestAiTranslation).mock.calls.map(([r]) => r);

    it('a split translation is replayed from its two cached halves', async () => {
      await showBig();
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(http(404, { error: 'not_cached' }))
        .mockResolvedValueOnce(result(['Titre', 'A'], { providerId: 7, fromCache: true }))
        .mockResolvedValueOnce(result(['B', 'C'], { providerId: 7, fromCache: true }));
      const { result: hook } = renderHook(() => useArticleTranslation(big));
      await waitFor(() => expect(hook.current.state).toBe('done'));
      expect(sent()).toHaveLength(3);
      expect(sent().every((r) => r.cacheOnly === true && r.provider === 7)).toBe(true);
      expect(sent()[0].segments).toHaveLength(4);
      expect(sent()[1].segments).toEqual(sent()[0].segments.slice(0, 2));
      expect(sent()[2].segments).toEqual(sent()[0].segments.slice(2));
      expect(hook.current.showing).toBe('translation');
      expect(hook.current.title).toBe('Titre');
      expect(hook.current.html).toBe('<p>A</p><p>B</p><p>C</p>');
      expect(hook.current.error).toBeNull();
      expect(memory().a1).toMatchObject({ lang: 'fr', providerId: 7 });
    });

    it('a half not cached ends the replay silently: no further split, memory forgotten', async () => {
      await showBig();
      vi.mocked(requestAiTranslation)
        .mockRejectedValueOnce(http(404, { error: 'not_cached' }))
        .mockResolvedValueOnce(result(['Titre', 'A']))
        .mockRejectedValueOnce(http(404, { error: 'not_cached' }));
      const { result: hook } = renderHook(() => useArticleTranslation(big));
      await waitFor(() => expect(memory().a1).toBeUndefined());
      expect(requestAiTranslation).toHaveBeenCalledTimes(3);
      expect(hook.current.state).toBe('idle');
      expect(hook.current.error).toBeNull();
      expect(hook.current.html).toBeNull();
      expect(hook.current.showing).toBe('source');
    });

    it('a 409 on the whole batch does not split', async () => {
      await showBig();
      vi.mocked(requestAiTranslation).mockRejectedValue(http(409, { error: 'no_provider' }));
      const { result: hook } = renderHook(() => useArticleTranslation(big));
      await waitFor(() => expect(memory().a1).toBeUndefined());
      expect(requestAiTranslation).toHaveBeenCalledTimes(1);
      expect(hook.current.state).toBe('idle');
      expect(hook.current.error).toBeNull();
    });
  });
});
