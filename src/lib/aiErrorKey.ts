/**
 * Réponse d'erreur de `POST /api/ai/summary` → clé `ai.errors.*`.
 *
 * Sert aussi à `POST /api/ai/translate` : `invalid_lang` (langue hors liste) et
 * `ai_failed` + `detail: 'segments'` (lot rendu inexploitable) ont leur clé.
 *
 * Ne devine jamais une cause : chaque branche correspond à un code que le
 * serveur envoie vraiment. Deux 429 ne se confondent pas — le plafond
 * quotidien porte `error: 'ai_daily_cap'`, le seau du proxy n'en porte pas.
 * Une clé refusée ne se corrige que là où elle a été saisie : l'admin la
 * vérifie lui-même, un utilisateur prévient l'admin
 * — sauf si la clé refusée est la sienne (`ownKey`) : il la corrige lui-même.
 *
 * Le repli neutre dit ce qui a échoué : « Le résumé a échoué » pour un résumé,
 * « La traduction a échoué » pour une traduction (`op: 'translate'`).
 */
export interface AiErrorOptions { op?: 'summary' | 'translate' }

export function aiErrorKey(status: number | undefined, data: { error?: string; kind?: string; ownKey?: boolean; detail?: string } | undefined, isAdmin: boolean, options: AiErrorOptions = {}): string {
  const error = data?.error;
  if (error === 'ai_daily_cap') return 'ai.errors.cap';
  if (status === 429) return 'ai.errors.rateLimited';
  if (error === 'invalid_body') return 'ai.errors.tooLong';
  if (error === 'article_too_short') return 'ai.errors.tooShort';
  if (error === 'ai_refused') return 'ai.errors.refused';
  if (error === 'no_provider') return 'ai.errors.noProvider';
  if (error === 'invalid_lang') return 'ai.errors.invalidLang';
  if (error === 'ai_failed' && data?.detail === 'segments') return 'ai.errors.segments';
  if (data?.kind === 'auth') return isAdmin || data.ownKey === true ? 'ai.errors.auth' : 'ai.errors.authUser';
  if (data?.kind === 'quota') return 'ai.errors.quota';
  return options.op === 'translate' ? 'ai.errors.translateFailed' : 'ai.errors.technical';
}

export interface AiErrorMessage { key: string; params?: Record<string, string | number> }

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
  data: { error?: string; kind?: string; ownKey?: boolean; detail?: string; cap?: unknown; resetAt?: unknown } | undefined,
  isAdmin: boolean,
  language: string,
  options: AiErrorOptions = {},
): AiErrorMessage {
  const key = aiErrorKey(status, data, isAdmin, options);
  if (key !== 'ai.errors.cap') return { key };
  const cap = data?.cap;
  const reset = typeof data?.resetAt === 'string' ? new Date(data.resetAt) : null;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap <= 0 || !reset || Number.isNaN(reset.getTime())) return { key };
  let time: string;
  try { time = new Intl.DateTimeFormat(language, { timeStyle: 'short' }).format(reset); } catch { return { key }; }
  return { key: 'ai.errors.capDetail', params: { used: cap, cap, time } };
}
