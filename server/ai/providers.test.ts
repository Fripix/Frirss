// server/ai/providers.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import type { AiProvider } from './store.js';

vi.mock('dns', () => {
  const promises = { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) };
  return { default: { promises }, promises };
});

const anthropic: AiProvider = { id: 1, name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', hasAdminKey: true, shared: true, position: 0 };
const openai: AiProvider = { id: 2, name: 'Ollama', type: 'openai', baseUrl: 'https://ollama.example.com', model: 'llama3', hasAdminKey: false, shared: false, position: 1 };
const call = { system: 'sys', user: 'texte' };

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    text: async () => JSON.stringify(body), json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('anthropic adapter', () => {
  it('posts to /v1/messages with the key header and reads the text block', async () => {
    const fetchMock = stub(200, { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'lang: fr\n\nRésumé' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
    const r = await callProvider(anthropic, 'sk-ant', call);
    expect(r.text).toBe('lang: fr\n\nRésumé');
    expect(r.inputTokens).toBe(10);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'texte' }]);
    expect(init.redirect).toBe('manual');
  });
  it('classifies a refusal as refused, never as technical', async () => {
    stub(200, { content: [], stop_reason: 'refusal', usage: {} });
    await expect(callProvider(anthropic, 'k', call)).rejects.toMatchObject({ kind: 'refused' });
  });
});

describe('openai adapter', () => {
  it('posts to /v1/chat/completions with a bearer, no header without a key', async () => {
    const fetchMock = stub(200, { model: 'llama3', choices: [{ message: { content: 'lang: en\n\nSummary' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    const r = await callProvider(openai, null, call);
    expect(r.text).toBe('lang: en\n\nSummary');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ollama.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    // Les modèles de raisonnement d'OpenAI refusent `max_tokens`.
    expect(body).not.toHaveProperty('max_tokens');
    const capped = stub(200, { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] });
    await callProvider(openai, null, { ...call, maxTokens: 16 });
    expect(JSON.parse((capped.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty('max_tokens');
  });
  it('maps 401 to auth and 429 to quota', async () => {
    stub(401, { error: 'bad key' });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'auth', status: 401 });
    stub(429, { error: 'slow down' });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'quota' });
  });
  it('treats a redirect as technical and never follows it', async () => {
    const fetchMock = stub(301, {}, { location: 'https://elsewhere.example.com/' });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'technical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('content_filter is refused', async () => {
    stub(200, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] });
    await expect(callProvider(openai, 'k', call)).rejects.toMatchObject({ kind: 'refused' });
  });
  it('never leaks the key in an error message', async () => {
    stub(401, { error: 'invalid key sk-secret-123' });
    const err = await callProvider(openai, 'sk-secret-123', call).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as Error).message).not.toContain('sk-secret-123');
  });
  it('redacts the key before cutting the body, so no fragment survives at the cut', async () => {
    const key = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    // La clé chevauche la coupe à 300 : 20 caractères avant, le reste après.
    const body = 'x'.repeat(280) + key + 'y'.repeat(600 - 280 - key.length);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => body, json: async () => ({}) }));
    const err = await callProvider(openai, key, call).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AiError);
    const msg = (err as Error).message;
    for (let i = 0; i + 8 <= key.length; i++) expect(msg).not.toContain(key.slice(i, i + 8));
  });
  it('redacts the key from a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect failed for sk-secret-123')));
    const err = await callProvider(openai, 'sk-secret-123', call).catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'technical' });
    expect((err as Error).message).not.toContain('sk-secret-123');
  });
});

describe('base URL handling', () => {
  const okBody = { model: 'm', choices: [{ message: { content: 'lang: en\n\nS' }, finish_reason: 'stop' }], usage: {} };
  it('classifies a malformed base URL as technical without calling fetch', async () => {
    const fetchMock = stub(200, okBody);
    await expect(callProvider({ ...openai, baseUrl: 'not a url' }, 'k', call)).rejects.toMatchObject({ kind: 'technical' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('trusts an IPv6 literal host', async () => {
    stub(200, okBody);
    const r = await callProvider({ ...openai, baseUrl: 'http://[::1]:11434' }, null, call);
    expect(r.text).toBe('lang: en\n\nS');
  });
  it('accepts a private LAN IP literal thanks to trustedHosts', async () => {
    const fetchMock = stub(200, okBody);
    await callProvider({ ...openai, baseUrl: 'http://10.0.0.5:11434' }, null, call);
    expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.0.5:11434/v1/chat/completions');
  });
});
