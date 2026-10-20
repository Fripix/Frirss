// server/ai/models.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listModels } from './providers.js';
import { AiError } from './errors.js';

vi.mock('dns', () => {
  const promises = { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) };
  return { default: { promises }, promises };
});

function stubSeq(...responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300, status: r.status, headers: new Headers(r.headers ?? {}),
      text: async () => JSON.stringify(r.body), json: async () => r.body,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

const claude = { type: 'anthropic' as const, baseUrl: 'https://api.anthropic.com' };
const oai = { type: 'openai' as const, baseUrl: 'https://api.openai.com' };

describe('listModels — anthropic', () => {
  it('GETs /v1/models with the key headers, keeps the API order (newest first)', async () => {
    const fetchMock = stubSeq({ status: 200, body: { data: [{ id: 'claude-opus-5-5', type: 'model' }, { id: 'claude-haiku-5-5', type: 'model' }], has_more: false } });
    expect(await listModels(claude, 'sk-ant')).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect(init.redirect).toBe('manual');
  });
  it('follows has_more with after_id', async () => {
    const fetchMock = stubSeq(
      { status: 200, body: { data: [{ id: 'a' }], has_more: true, last_id: 'a' } },
      { status: 200, body: { data: [{ id: 'b' }], has_more: false, last_id: 'b' } },
    );
    expect(await listModels(claude, 'k')).toEqual(['a', 'b']);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=a');
  });
  it('stops after ten pages even if the server keeps saying has_more', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ status: 200, body: { data: [{ id: `m${i}` }], has_more: true, last_id: `m${i}` } }));
    const fetchMock = stubSeq(...pages);
    expect((await listModels(claude, 'k')).length).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

describe('listModels — openai-compatible', () => {
  it('GETs /v1/models with a bearer, and no auth header without a key', async () => {
    const fetchMock = stubSeq({ status: 200, body: { data: [{ id: 'qwen2.5:7b' }] } });
    expect(await listModels({ type: 'openai', baseUrl: 'http://10.0.0.5:11434' }, null)).toEqual(['qwen2.5:7b']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5:11434/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    stubSeq({ status: 200, body: { data: [] } });
    await listModels(oai, 'sk-x');
    expect(((vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
  });
  it('drops the families that cannot write text', async () => {
    const ids = ['gpt-5-mini', 'text-embedding-3-large', 'whisper-1', 'tts-1-hd', 'dall-e-3', 'omni-moderation-latest',
      'gpt-4o-transcribe', 'gpt-image-1', 'gpt-realtime', 'sora-2', 'babbage-002', 'davinci-002', 'mistral-ocr-latest', 'nomic-embed-text:latest', 'mistral-small-latest'];
    stubSeq({ status: 200, body: { data: ids.map((id) => ({ id })) } });
    expect(await listModels(oai, 'k')).toEqual(['gpt-5-mini', 'mistral-small-latest']);
  });
  it('drops a model whose capabilities say it cannot chat (Mistral)', async () => {
    stubSeq({ status: 200, body: { data: [{ id: 'a', capabilities: { completion_chat: true } }, { id: 'b', capabilities: { completion_chat: false } }] } });
    expect(await listModels(oai, 'k')).toEqual(['a']);
  });
  it('sorts newest first by `created`, then by name, without duplicates', async () => {
    stubSeq({ status: 200, body: { data: [{ id: 'old', created: 1 }, { id: 'zeta' }, { id: 'new', created: 9 }, { id: 'alpha' }, { id: 'new', created: 9 }] } });
    expect(await listModels(oai, 'k')).toEqual(['new', 'old', 'alpha', 'zeta']);
  });
  it('ignores entries without a string id', async () => {
    stubSeq({ status: 200, body: { data: [{ id: 42 }, null, { name: 'x' }, { id: ' ok ' }] } });
    expect(await listModels(oai, 'k')).toEqual(['ok']);
  });
});

describe('listModels — failures', () => {
  it('maps 401 to auth and never leaks the key', async () => {
    stubSeq({ status: 401, body: { error: 'bad key sk-secret-123' } });
    const err = await listModels(oai, 'sk-secret-123').catch((e: Error) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ kind: 'auth' });
    expect((err as Error).message).not.toContain('sk-secret-123');
  });
  it('a response without a data array is technical', async () => {
    stubSeq({ status: 200, body: { models: [] } });
    await expect(listModels(oai, 'k')).rejects.toMatchObject({ kind: 'technical' });
  });
  it('a redirect is technical and is not followed', async () => {
    const fetchMock = stubSeq({ status: 302, body: {}, headers: { location: 'https://elsewhere.example.com/' } });
    await expect(listModels(oai, 'k')).rejects.toMatchObject({ kind: 'technical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a malformed base URL is technical, without calling fetch', async () => {
    const fetchMock = stubSeq({ status: 200, body: { data: [] } });
    await expect(listModels({ type: 'openai', baseUrl: 'not a url' }, 'k')).rejects.toMatchObject({ kind: 'technical' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a transport error is technical and redacted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect failed for sk-secret-123')));
    const err = await listModels(oai, 'sk-secret-123').catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'technical' });
    expect((err as Error).message).not.toContain('sk-secret-123');
  });
});
