// server/ai/providers.ts
import { fetchUpstream } from '../routes/proxy.js';
import { AiError, classifyStatus } from './errors.js';
import type { AiProvider } from './store.js';

export interface AiCall { system: string; user: string; maxTokens?: number }
export interface AiResult { text: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }

const TIMEOUT_MS = 60_000;      // un modèle local sur un long article dépasse les 30 s du proxy
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Un appel = un POST JSON, par `fetchUpstream` (garde anti-SSRF à chaque
 * saut) avec l'hôte du fournisseur de confiance : l'URL est fixée par
 * l'admin, pas par un client. `followRedirects: false` : un 3xx est une
 * erreur technique, jamais un secret envoyé ailleurs. Deux adaptateurs, et
 * pas un troisième (spec §3) — tout « compatible OpenAI » passe par `openai`.
 */
export async function callProvider(provider: AiProvider, key: string | null, call: AiCall): Promise<AiResult> {
  const started = Date.now();
  let host: string;
  try {
    // assertTargetSafe compare sans les crochets d'un littéral IPv6.
    host = new URL(provider.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    throw new AiError('technical', `${provider.name}: invalid base URL`);
  }
  const { url, headers, body } = provider.type === 'anthropic'
    ? anthropicRequest(provider, key, call)
    : openaiRequest(provider, key, call);

  let resp: Response;
  try {
    resp = await fetchUpstream(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      timeoutMs: TIMEOUT_MS, followRedirects: false, trustedHosts: [host],
    });
  } catch (err) {
    throw new AiError('technical', redact(String((err as Error)?.message ?? err), key));
  }
  if (!resp.ok) {
    // Masquer AVANT de couper : une coupe au milieu de la clé en laisserait un morceau que `split` ne reconnaît plus.
    const detail = redact(await resp.text().catch(() => ''), key).slice(0, 300);
    throw new AiError(classifyStatus(resp.status), `${provider.name}: HTTP ${resp.status} ${detail}`, resp.status);
  }
  let json: unknown;
  try { json = await resp.json(); } catch { throw new AiError('technical', `${provider.name}: non-JSON response`); }
  const parsed = provider.type === 'anthropic' ? parseAnthropic(json) : parseOpenai(json);
  if (parsed.refused) throw new AiError('refused', `${provider.name} declined the content`);
  if (!parsed.text.trim()) throw new AiError('technical', `${provider.name}: empty answer`);
  return { text: parsed.text, model: parsed.model || provider.model, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, durationMs: Date.now() - started };
}

function redact(text: string, key: string | null): string {
  return key ? text.split(key).join('***') : text;
}

interface Req { url: string; headers: Record<string, string>; body: unknown }
function anthropicRequest(p: AiProvider, key: string | null, c: AiCall): Req {
  return {
    url: `${p.baseUrl}/v1/messages`,
    headers: { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' },
    body: { model: p.model, max_tokens: c.maxTokens ?? DEFAULT_MAX_TOKENS, system: c.system, messages: [{ role: 'user', content: c.user }] },
  };
}
/**
 * Pas de `max_tokens` : les modèles de raisonnement d'OpenAI le refusent (ils
 * veulent `max_completion_tokens`) et Ollama l'ignore. Le plafond par défaut du
 * fournisseur suffit pour un résumé ; `c.maxTokens` ne sert qu'à Anthropic, qui l'exige.
 */
function openaiRequest(p: AiProvider, key: string | null, c: AiCall): Req {
  return {
    url: `${p.baseUrl}/v1/chat/completions`,
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: { model: p.model, messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }] },
  };
}

interface Parsed { text: string; model: string; inputTokens: number; outputTokens: number; refused: boolean }
function parseAnthropic(j: unknown): Parsed {
  const o = j as { model?: string; content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (o.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  return { text, model: o.model ?? '', inputTokens: o.usage?.input_tokens ?? 0, outputTokens: o.usage?.output_tokens ?? 0, refused: o.stop_reason === 'refusal' };
}
function parseOpenai(j: unknown): Parsed {
  const o = j as { model?: string; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const choice = o.choices?.[0];
  return { text: choice?.message?.content ?? '', model: o.model ?? '', inputTokens: o.usage?.prompt_tokens ?? 0, outputTokens: o.usage?.completion_tokens ?? 0, refused: choice?.finish_reason === 'content_filter' };
}
