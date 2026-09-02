// Faut-il prévenir l'utilisateur qu'une écriture d'article a échoué, et de
// quoi ?
//
// Depuis que le ✓ retire la ligne AVANT la réponse de FreshRSS, un échec
// ressemble trait pour trait à une réussite : la ligne s'en va, le compteur
// baisse, et l'utilisateur ne découvre qu'au rechargement que rien n'a été
// écrit. Deux chemins se taisaient :
//
//  1. **Refus du serveur** (4xx) : le rollback remet la ligne et le compteur,
//     mais sans un mot — une ligne qui réapparaît toute seule est
//     incompréhensible.
//  2. **Mise en file d'attente** : la ligne reste délibérément retirée, l'état
//     optimiste étant celui qui sera rejoué. C'est le bon comportement hors
//     ligne. Mais `isNetworkFailure` range aussi les 5xx et les requêtes sans
//     réponse dans cette catégorie : navigateur EN LIGNE, écriture perdue,
//     ligne partie, aucun message.
//
// Le hors-ligne véritable reste silencieux : le bandeau global l'annonce déjà,
// et un toast par clic transformerait une session de lecture sans réseau en
// pluie de notifications.
//
// ⚠️ Cette fonction ne DÉCIDE de rien sur la file d'attente. `isNetworkFailure`
// garde son contrat ; on ajoute une notification, on ne reclasse pas les
// erreurs.

export type WriteFailureNotice = 'refused' | 'queued' | null;

/**
 * @param networkFailure Verdict d'`isNetworkFailure` : l'action part-elle en
 *   file d'attente (`true`) ou est-elle annulée (`false`) ?
 * @param online `navigator.onLine` au moment de l'échec.
 */
export function writeFailureNotice(opts: {
  networkFailure: boolean;
  online: boolean;
}): WriteFailureNotice {
  // Le serveur a répondu : il y avait donc bien un réseau, quoi qu'en dise
  // `navigator.onLine`. Un refus se dit toujours.
  if (!opts.networkFailure) return 'refused';
  return opts.online ? 'queued' : null;
}
