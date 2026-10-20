export type AiErrorKind = 'auth' | 'quota' | 'technical' | 'refused';

/** Une erreur d'appel à un fournisseur, classée pour que le repli sache quoi faire. */
export class AiError extends Error {
  /** Vrai si l'appel fautif partait avec la clé personnelle de l'utilisateur ; posé par `runWithFallback`. */
  ownKey?: boolean;
  constructor(public readonly kind: AiErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = 'AiError';
  }
}

/** 401/403 → clé ; 402/429 → quota ; tout le reste (3xx compris : on ne suit pas) → technique. */
export function classifyStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 429) return 'quota';
  return 'technical';
}
