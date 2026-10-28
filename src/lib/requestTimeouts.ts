// Délais des requêtes du navigateur.
//
// Règle : **le serveur doit toujours répondre avant que le client abandonne.**
// Un abandon client n'a pas de réponse ; `isUpstreamCut`
// (`src/lib/aiErrorKey.ts`) le lit comme une coupure amont et fait rejouer la
// traduction en lots coupés en deux. Un délai client plus court que le budget
// serveur fabriquerait donc précisément ce cas. Chaque valeur ci-dessous
// DÉPASSE le budget serveur qu'elle couvre, et `requestTimeouts.test.ts` relit
// ces budgets dans leurs fichiers pour rougir si l'un d'eux les rattrape.
//
// Des constantes et pas une variable d'environnement : ce sont des
// conséquences des bornes serveur, pas un réglage d'exploitation.
//
// L'extraction d'article garde son propre délai, plus court (20 s,
// `src/utils/extractContent.ts`), et son repli : elle n'est pas concernée.

/**
 * Appels courts : listes, compteurs, écritures lu / favori / étiquette,
 * préférences, favicons et images. Au-dessus de l'échéance totale du proxy
 * (`PROXY_TOTAL_TIMEOUT_MS`, 60 s, plus au plus 5 s de résolution DNS du
 * dernier saut — `server/routes/proxy.ts`), qui répond 504 à son terme.
 */
export const TIMEOUT_DEFAULT_MS = 75_000;

/**
 * IA : résumé, traduction, test d'un fournisseur et liste de ses modèles. Le
 * serveur se borne lui-même (résumé 50 s, traduction jusqu'à 110 s), et nginx
 * coupe à 120 s (`proxy_read_timeout`, `nginx.conf`) : au-dessus des deux.
 */
export const TIMEOUT_AI_MS = 150_000;

/** Sauvegarde : export, aperçu et restauration. Au-dessus de la coupure nginx (120 s). */
export const TIMEOUT_BACKUP_MS = 150_000;
