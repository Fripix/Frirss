/**
 * Clé i18n décrivant un échec de connexion.
 *
 * L'écran affirmait « identifiants incorrects » pour TOUTE panne : un 429, un
 * 500 ou une coupure réseau donnaient le même message qu'un mot de passe
 * erroné. Le message accusait une cause qu'il n'avait pas vérifiée, et envoyait
 * l'utilisateur retaper indéfiniment un mot de passe pourtant juste.
 *
 * Seul un 401 dit réellement « ces identifiants ne conviennent pas ».
 */
export function loginErrorKey(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return 'login.errorLogin';
  if (status === 429) return 'login.errorTooMany';
  return 'login.errorUnavailable';
}
