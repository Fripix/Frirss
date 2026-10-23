/**
 * Réponse d'erreur de `POST /api/ai/summary` → clé `ai.errors.*`.
 *
 * Sert aussi à `POST /api/ai/translate` : `invalid_lang` (langue hors liste) et
 * `ai_failed` + `detail: 'segments'` (lot rendu inexploitable) ont leur clé.
 * `detail: 'deadline'` (le temps a manqué) garde le message neutre de
 * l'opération : le client a déjà rejoué le lot coupé en deux (`isAiDeadline`),
 * comme pour `segments` (`isAiMalformed`).
 * Une traduction coupée par un reverse proxy en amont (`isUpstreamCut`) a son
 * message, `ai.errors.proxyTimeout`, qui dit quoi régler.
 *
 * Ne devine jamais une cause : chaque branche correspond à un code que le
 * serveur envoie vraiment. Deux 429 ne se confondent pas — le plafond
 * quotidien porte `error: 'ai_daily_cap'`, le seau du proxy n'en porte pas.
 * Une clé refusée ne se corrige que là où elle a été saisie : l'admin la
 * vérifie lui-même, un utilisateur prévient l'admin
 * — sauf si la clé refusée est la sienne (`ownKey`) : il la corrige lui-même.
 *
 * Les messages qui nomment l'opération ont leur variante de traduction
 * (`op: 'translate'`) : le repli neutre (« La traduction a échoué »), le refus
 * du fournisseur et le texte trop long. Le plafond quotidien est un compteur
 * commun aux résumés et aux traductions : son message ne nomme ni l'un ni
 * l'autre.
 */
export interface AiErrorOptions {
  op?: 'summary' | 'translate';
  /** Durée de la requête qui a échoué : une erreur réseau après une longue attente est une coupure amont (`isUpstreamCut`). */
  elapsedMs?: number;
  /** Une requête HTTP partie sans réponse (erreur axios sans `response`) — pas un échec local, qui n'a pas de statut non plus. */
  noResponse?: boolean;
}

export function aiErrorKey(status: number | undefined, data: { error?: string; kind?: string; ownKey?: boolean; detail?: string } | undefined, isAdmin: boolean, options: AiErrorOptions = {}): string {
  const error = data?.error;
  const translate = options.op === 'translate';
  if (error === 'ai_daily_cap') return 'ai.errors.cap';
  if (status === 429) return 'ai.errors.rateLimited';
  if (error === 'invalid_body') return translate ? 'ai.errors.translateTooLong' : 'ai.errors.tooLong';
  if (error === 'article_too_short') return 'ai.errors.tooShort';
  if (error === 'ai_refused') return translate ? 'ai.errors.translateRefused' : 'ai.errors.refused';
  if (error === 'no_provider') return 'ai.errors.noProvider';
  if (error === 'invalid_lang') return 'ai.errors.invalidLang';
  if (error === 'ai_failed' && data?.detail === 'segments') return 'ai.errors.segments';
  if (isAiDeadline(status, data)) return translate ? 'ai.errors.translateFailed' : 'ai.errors.technical';
  // Aucune réponse du tout : la connexion a été coupée (réseau perdu, téléphone
  // en arrière-plan, ou un intermédiaire qui ferme sans répondre). Par quoi, on
  // ne le voit pas : le message le constate sans accuser un proxy.
  if (translate && options.noResponse === true) return 'ai.errors.connectionLost';
  if (translate && isUpstreamCut(status, data, options.elapsedMs ?? 0)) return 'ai.errors.proxyTimeout';
  if (data?.kind === 'auth') return isAdmin || data.ownKey === true ? 'ai.errors.auth' : 'ai.errors.authUser';
  if (data?.kind === 'quota') return 'ai.errors.quota';
  return translate ? 'ai.errors.translateFailed' : 'ai.errors.technical';
}

/**
 * Le serveur a abandonné la demande faute de temps (502 `ai_failed` +
 * `detail: 'deadline'`). Seulement ce code-là : un 504 d'un reverse proxy en
 * amont n'a pas de corps du serveur, et rien n'y est deviné.
 */
export function isAiDeadline(status: number | undefined, data: { error?: string; kind?: string; detail?: string } | undefined): boolean {
  return status === 502 && data?.error === 'ai_failed' && data.detail === 'deadline';
}

/**
 * Le fournisseur a rendu une traduction inexploitable, deux fois (502
 * `ai_failed` + `detail: 'segments'`) ; le serveur ne passe pas au fournisseur
 * suivant, le client rejoue le lot coupé en deux. Seulement ce code-là.
 */
export function isAiMalformed(status: number | undefined, data: { error?: string; kind?: string; detail?: string } | undefined): boolean {
  return status === 502 && data?.error === 'ai_failed' && data.detail === 'segments';
}

/** Une requête attendue au moins ce temps puis perdue sans réponse : coupée en route. */
export const UPSTREAM_CUT_MIN_MS = 30_000;

/**
 * Un reverse proxy devant FriRSS (nginx, Nginx Proxy Manager : 60 s par
 * défaut) a coupé la requête, **après au moins 30 s d'attente** : 502 / 504
 * dont le corps n'est pas celui du serveur FriRSS (`{ error: 'ai_failed', … }`),
 * ou aucune réponse. Rapide, ce n'est pas une coupure faute de temps : un
 * 502 de nginx quand le backend est arrêté suit le chemin d'erreur normal.
 */
export function isUpstreamCut(status: number | undefined, data: unknown, elapsedMs: number): boolean {
  if (elapsedMs < UPSTREAM_CUT_MIN_MS) return false;
  if (status === 502 || status === 504) {
    const ours = typeof data === 'object' && data !== null && (data as { error?: unknown }).error === 'ai_failed';
    return !ours;
  }
  return status === undefined;
}

/**
 * `providerId` : le fournisseur qui a échoué ou refusé, quand le serveur le
 * nomme (`provider: { id, name }` dans les 502 `ai_failed` et 422
 * `ai_refused`, jamais dans les autres) — de quoi proposer « Réessayer avec
 * le suivant » (`nextProvider`).
 */
export interface AiErrorMessage { key: string; params?: Record<string, string | number>; providerId?: number }

/**
 * Comme `aiErrorKey`, avec ce qu'il faut pour le plafond quotidien : le 429
 * porte `cap` et `resetAt` (prochain minuit local du SERVEUR, en ISO), et la
 * spec §9 veut « 50 sur 50 aujourd'hui ». L'heure est rendue dans la langue de
 * l'interface et le fuseau du navigateur — c'est l'instant de la remise à
 * zéro, vu d'ici. Un champ absent ou illisible : le message simple, rien
 * d'inventé. Atteindre le plafond, c'est en avoir consommé `cap`.
 */
export function aiErrorMessage(
  status: number | undefined,
  data: { error?: string; kind?: string; ownKey?: boolean; detail?: string; cap?: unknown; resetAt?: unknown; provider?: { id?: unknown; name?: unknown } } | undefined,
  isAdmin: boolean,
  language: string,
  options: AiErrorOptions = {},
): AiErrorMessage {
  const key = aiErrorKey(status, data, isAdmin, options);
  const id = data?.provider?.id;
  const providerId = typeof id === 'number' && Number.isInteger(id) ? id : undefined;
  const withProvider = (m: AiErrorMessage): AiErrorMessage => (providerId === undefined ? m : { ...m, providerId });
  if (key !== 'ai.errors.cap') return withProvider({ key });
  const cap = data?.cap;
  const reset = typeof data?.resetAt === 'string' ? new Date(data.resetAt) : null;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap <= 0 || !reset || Number.isNaN(reset.getTime())) return { key };
  let time: string;
  try { time = new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(reset); } catch { return { key }; }
  return { key: 'ai.errors.capDetail', params: { used: cap, cap, time } };
}
