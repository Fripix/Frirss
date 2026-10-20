import type { AiSummaryResult, AiTranslationResult } from '../../api/backend';

/**
 * Demandes d'IA en cours, au niveau du MODULE et non du composant.
 *
 * Changer d'article n'annule que l'affichage d'une réponse, pas l'appel au
 * fournisseur, qui est facturé et compté dans le plafond. L'état du volet est
 * remis à zéro à chaque article : revenir sur A pendant que sa demande court
 * en relançait une seconde, payée deux fois. On rend ici la demande en cours
 * pour la même clé, retirée dès qu'elle se règle — réussite ou échec : rien
 * n'est mis en cache côté client.
 *
 * Deux tables : les résumés (compte, article, fournisseur forcé) et les
 * traductions du résumé (compte, article, texte du résumé, langue, fournisseur
 * forcé — le texte en fait partie : « Résumer avec Y » change ce qu'il y a à
 * traduire).
 */
function pendingTable<T>() {
  const pending = new Map<string, Promise<T>>();
  const share = (key: string, start: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const p = start();
    pending.set(key, p);
    const clear = () => { if (pending.get(key) === p) pending.delete(key); };
    p.then(clear, clear);
    return p;
  };
  return { share, clear: () => pending.clear() };
}

const summaries = pendingTable<AiSummaryResult>();
const translations = pendingTable<AiTranslationResult>();

export const sharedSummaryRequest = summaries.share;
export const sharedTranslationRequest = translations.share;

/** Tests : chaque cas part de tables vides. */
export function __resetPendingSummariesForTests(): void {
  summaries.clear();
  translations.clear();
}
