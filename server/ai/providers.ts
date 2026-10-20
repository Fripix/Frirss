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
  const host = hostOf(provider.baseUrl, provider.name);
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
    const detail = redact(errorDetail(await resp.text().catch(() => '')), key).slice(0, 300);
    throw new AiError(classifyStatus(resp.status), `${provider.name}: HTTP ${resp.status} ${detail}`, resp.status);
  }
  let json: unknown;
  try { json = await resp.json(); } catch { throw new AiError('technical', `${provider.name}: non-JSON response`); }
  const parsed = provider.type === 'anthropic' ? parseAnthropic(json) : parseOpenai(json);
  if (parsed.refused) throw new AiError('refused', `${provider.name} declined the content`);
  if (!parsed.text.trim()) throw new AiError('technical', `${provider.name}: empty answer`);
  return { text: parsed.text, model: parsed.model || provider.model, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, durationMs: Date.now() - started };
}

/** Ce qu'il faut pour interroger un fournisseur avant qu'il soit enregistré. */
export interface ModelTarget { type: AiProvider['type']; baseUrl: string }

const LIST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 10;
/**
 * Familles qui ne savent pas écrire de texte. OpenAI ne dit nulle part quels
 * modèles répondent à `/chat/completions` : on écarte ce qui est connu pour ne
 * pas le faire. Une famille nouvelle peut passer, « Tester » l'attrape alors.
 */
const NOT_TEXT = /embed|whisper|tts|dall-e|moderation|transcribe|image|realtime|sora|babbage|davinci|ocr/i;
/**
 * Chez OpenAI seulement : modèles qui écrivent du texte mais ne répondent pas à
 * `/v1/chat/completions` (codex et « pro » : API Responses ; instruct : ancienne
 * API Completions). Limité à cet hôte : OpenRouter sert `gemini-2.5-pro` en chat.
 */
const OPENAI_NOT_CHAT = /codex|-pro(-|$)|instruct/i;

/**
 * Les noms de modèles qu'une clé permet d'utiliser (`GET /v1/models`), pour
 * remplir le champ « Modèle » sans deviner. Même garde que `callProvider` :
 * hôte de confiance, pas de redirection suivie, clé masquée dans les erreurs.
 * Anthropic garde son ordre (le plus récent d'abord) ; les autres sont triés
 * par `created` décroissant, puis par nom.
 */
export async function listModels(target: ModelTarget, key: string | null): Promise<string[]> {
  const host = hostOf(target.baseUrl, 'models');
  const base = target.baseUrl.replace(/\/+$/, '');
  if (target.type === 'anthropic') {
    const ids: string[] = [];
    let after = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${base}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
      const j = await getJson(url, { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' }, host, key) as { data?: unknown; has_more?: boolean; last_id?: string };
      ids.push(...entries(j).map((e) => e.id));
      if (!j.has_more || !j.last_id) break;
      after = j.last_id;
    }
    return [...new Set(ids)];
  }
  const j = await getJson(`${base}/v1/models`, key ? { Authorization: `Bearer ${key}` } : {}, host, key);
  const seen = new Set<string>();
  return entries(j)
    .filter((e) => !NOT_TEXT.test(e.id) && e.chat !== false && !(host === 'api.openai.com' && OPENAI_NOT_CHAT.test(e.id)))
    .sort((a, b) => (b.created - a.created) || a.id.localeCompare(b.id))
    .map((e) => e.id)
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

interface ModelEntry { id: string; created: number; chat?: boolean }
function entries(j: unknown): ModelEntry[] {
  const data = (j as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new AiError('technical', 'models: unexpected response');
  const out: ModelEntry[] = [];
  for (const raw of data) {
    const o = raw as { id?: unknown; created?: unknown; capabilities?: { completion_chat?: unknown } } | null;
    const id = typeof o?.id === 'string' ? o.id.trim() : '';
    if (!id) continue;
    const chat = o?.capabilities?.completion_chat;
    out.push({ id, created: typeof o?.created === 'number' ? o.created : 0, chat: typeof chat === 'boolean' ? chat : undefined });
  }
  return out;
}

async function getJson(url: string, headers: Record<string, string>, host: string, key: string | null): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetchUpstream(url, { method: 'GET', headers, timeoutMs: LIST_TIMEOUT_MS, followRedirects: false, trustedHosts: [host] });
  } catch (err) {
    throw new AiError('technical', redact(String((err as Error)?.message ?? err), key));
  }
  if (!resp.ok) {
    const detail = redact(errorDetail(await resp.text().catch(() => '')), key).slice(0, 300);
    throw new AiError(classifyStatus(resp.status), `models: HTTP ${resp.status} ${detail}`, resp.status);
  }
  try { return await resp.json(); } catch { throw new AiError('technical', 'models: non-JSON response'); }
}

/** L'hôte à tenir pour sûr ; `assertTargetSafe` compare sans les crochets d'un littéral IPv6. */
function hostOf(baseUrl: string, label: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    throw new AiError('technical', `${label}: invalid base URL`);
  }
}

/**
 * Le message lisible d'une erreur de fournisseur, sorti de son enveloppe JSON :
 * `error.message` (OpenAI, Anthropic), `error` en chaîne (Ollama), `message`
 * (Mistral). Sinon le corps brut. Le masquage de la clé vient après, la coupe à la fin.
 */
function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    const e = j?.error;
    const msg = typeof e === 'string' ? e
      : typeof (e as { message?: unknown } | null)?.message === 'string' ? (e as { message: string }).message
        : typeof j?.message === 'string' ? j.message : '';
    if (msg.trim()) return msg.trim();
  } catch { /* corps non JSON : brut */ }
  return body;
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
