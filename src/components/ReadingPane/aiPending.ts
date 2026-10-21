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
 *
 * Une régénération (« Régénérer », « Retraduire ») a sa propre clé : elle ne
 * se rattache jamais à une demande ordinaire en cours, dont le serveur pourrait
 * servir le cache qu'on veut justement remplacer. Deux régénérations
 * identiques en vol, elles, se partagent. Les clés se construisent ici
 * (`summaryRequestKey`, `summaryTranslationKey`, `articleBatchKey`).
 *
 * Une demande en plusieurs temps (lot de traduction rejoué en deux moitiés)
 * demande à `wanted()` avant chaque appel suivant : vrai tant qu'un des
 * appelants rattachés est encore courant (`isCurrent`, absent = toujours).
 * Un lecteur parti n'en fait plus payer la suite ; revenu, il se rattache et
 * la suite part pour lui.
 */
function pendingTable<T>() {
  const pending = new Map<string, { promise: Promise<T>; checks: Array<() => boolean> }>();
  const always = () => true;
  const share = (key: string, start: (wanted: () => boolean) => Promise<T>, isCurrent: () => boolean = always): Promise<T> => {
    const existing = pending.get(key);
    if (existing) {
      existing.checks.push(isCurrent);
      return existing.promise;
    }
    const checks = [isCurrent];
    const p = start(() => checks.some((check) => check()));
    pending.set(key, { promise: p, checks });
    const clear = () => { if (pending.get(key)?.promise === p) pending.delete(key); };
    p.then(clear, clear);
    return p;
  };
  return { share, clear: () => pending.clear() };
}

type Id = number | string | undefined;
const regen = (regenerate?: boolean) => (regenerate ? 'regen:' : '');

/** Résumé : compte, article, fournisseur forcé. */
export function summaryRequestKey(k: { user: Id; articleId: string; providerId?: number; regenerate?: boolean }): string {
  return `${regen(k.regenerate)}${k.user ?? ''}:${k.articleId}:${k.providerId ?? ''}`;
}
/** Traduction du résumé : compte, article, langue, fournisseur forcé, texte du résumé. */
export function summaryTranslationKey(k: { user: Id; articleId: string; lang: string; providerId?: number; text: string; regenerate?: boolean }): string {
  return `${regen(k.regenerate)}${k.user ?? ''}:${k.articleId}:${k.lang}:${k.providerId ?? ''}:${k.text}`;
}
/** Lot de traduction de l'article : compte, article, langue, fournisseur forcé, hash du corps, rang du lot. */
export function articleBatchKey(k: { user: Id; articleId: string; lang: string; providerId?: number; hash: string; batch: number; regenerate?: boolean }): string {
  return `${regen(k.regenerate)}article:${k.user ?? ''}:${k.articleId}:${k.lang}:${k.providerId ?? ''}:${k.hash}:${k.batch}`;
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
