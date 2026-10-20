import type { AiSummaryResult } from '../../api/backend';

/**
 * Demandes de résumé en cours, au niveau du MODULE et non du composant.
 *
 * Changer d'article n'annule que l'affichage d'une réponse, pas l'appel au
 * fournisseur, qui est facturé et compté dans le plafond. L'état du volet est
 * remis à zéro à chaque article : revenir sur A pendant que sa demande court
 * en relançait une seconde, payée deux fois. On rend ici la demande en cours
 * pour la même clé (compte, article, fournisseur forcé), retirée dès qu'elle
 * se règle — réussite ou échec : rien n'est mis en cache côté client.
 */
const pending = new Map<string, Promise<AiSummaryResult>>();

export function sharedSummaryRequest(key: string, start: () => Promise<AiSummaryResult>): Promise<AiSummaryResult> {
  const existing = pending.get(key);
  if (existing) return existing;
  const p = start();
  pending.set(key, p);
  const clear = () => { if (pending.get(key) === p) pending.delete(key); };
  p.then(clear, clear);
  return p;
}

/** Tests : chaque cas part d'une table vide. */
export function __resetPendingSummariesForTests(): void {
  pending.clear();
}
