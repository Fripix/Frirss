/**
 * Réponse d'erreur de `POST /api/ai/summary` → clé `ai.errors.*`.
 *
 * Ne devine jamais une cause : chaque branche correspond à un code que le
 * serveur envoie vraiment. Deux 429 ne se confondent pas — le plafond
 * quotidien porte `error: 'ai_daily_cap'`, le seau du proxy n'en porte pas.
 * Une clé refusée ne se corrige que là où elle a été saisie : l'admin la
 * vérifie lui-même, un utilisateur prévient l'admin.
 */
export function aiErrorKey(status: number | undefined, data: { error?: string; kind?: string } | undefined, isAdmin: boolean): string {
  const error = data?.error;
  if (error === 'ai_daily_cap') return 'ai.errors.cap';
  if (status === 429) return 'ai.errors.rateLimited';
  if (error === 'invalid_body') return 'ai.errors.tooLong';
  if (error === 'article_too_short') return 'ai.errors.tooShort';
  if (error === 'ai_refused') return 'ai.errors.refused';
  if (error === 'no_provider') return 'ai.errors.noProvider';
  if (data?.kind === 'auth') return isAdmin ? 'ai.errors.auth' : 'ai.errors.authUser';
  if (data?.kind === 'quota') return 'ai.errors.quota';
  return 'ai.errors.technical';
}
