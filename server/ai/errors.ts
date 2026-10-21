export type AiErrorKind = 'auth' | 'quota' | 'technical' | 'refused';

/** Une erreur d'appel à un fournisseur, classée pour que le repli sache quoi faire. */
export class AiError extends Error {
  /** Vrai si l'appel fautif partait avec la clé personnelle de l'utilisateur ; posé par `runWithFallback`. */
  ownKey?: boolean;
  /**
   * Vrai si l'appel a été abandonné faute de temps (délai de l'appel ou
   * échéance de la demande), posé par `callProvider` ; la route en tire
   * `detail: 'deadline'`, et le client rejoue alors le lot coupé en deux.
   * Marqué ici plutôt que lu dans le message : le texte peut changer.
   */
  timedOut?: boolean;
  /**
   * Vrai si l'échec ne doit PAS passer au candidat suivant : `runWithFallback`
   * le lève aussitôt. Posé seulement sur une réponse de traduction
   * inexploitable (« segments ») : un Ollama local au contexte trop court
   * tronque sa sortie, et le repli enverrait le lot à un fournisseur payant
   * sans que personne l'ait choisi. Le client rejoue plutôt le lot coupé en deux.
   */
  noFallback?: boolean;
  /**
   * Le fournisseur dont l'appel a échoué (le DERNIER essayé quand le repli en a
   * parcouru plusieurs), posé par `runWithFallback` avant chaque `throw`. Le nom
   * est celui que l'admin a donné : ni URL, ni clé. Absent quand aucun candidat
   * n'a été appelé (`no_provider`, `ai_daily_cap`, `not_cached`, échéance
   * dépensée avant tout appel). La route le met dans les corps 502 et 422.
   */
  provider?: { id: number; name: string };
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
