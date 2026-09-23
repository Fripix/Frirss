/**
 * De quoi est mort un balayage de recherche ?
 *
 * Le plafond du proxy (`FRIRSS_PROXY_RATE_LIMIT`, 600/min par utilisateur)
 * mérite son propre message : « réessayez dans une minute » est actionnable,
 * « erreur réseau » ne l'est pas. Tout le reste est du réseau — une erreur ne
 * doit jamais deviner sa cause.
 */
export type ScanErrorKind = 'rate-limit' | 'network';

export function scanErrorKind(err: unknown): ScanErrorKind {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 429 ? 'rate-limit' : 'network';
}
