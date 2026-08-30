/**
 * Recherches récentes, par serveur.
 *
 * La recherche ne se déclenchait qu'à la soumission et n'avait aucune mémoire,
 * alors que l'usage réel est répétitif — on cherche le même sujet plusieurs
 * fois par semaine.
 *
 * **Par serveur**, comme la vue courante (`lastView.ts`) : les flux diffèrent
 * d'un serveur à l'autre, donc une requête qui avait un sens sur l'un est du
 * bruit sur le suivant.
 *
 * Local à l'appareil, jamais synchronisé : l'historique de recherche est la
 * sorte de trace qu'on ne s'attend pas à voir apparaître sur un autre écran.
 */

export const MAX_SEARCH_HISTORY = 5;

/** `activeServerId` vaut `string | number | null` selon d'où il vient : les
 *  deux formes doivent viser le même seau, d'où l'interpolation. */
export type ServerId = string | number | null | undefined;

function storageKey(serverId: ServerId): string {
  return `frirss_searchHistory_${serverId ?? 'none'}`;
}

/** Normalise pour la comparaison : deux façons d'écrire la même requête n'en
 *  font qu'une dans la liste. */
function normalize(query: string): string {
  return query.trim().toLowerCase();
}

/** Cœur pur : la liste mise à jour, la plus récente en tête. */
export function addToHistory(
  list: string[],
  query: string,
  max = MAX_SEARCH_HISTORY
): string[] {
  const value = query.trim();
  if (!value) return list;
  const key = normalize(value);
  return [value, ...list.filter((q) => normalize(q) !== key)].slice(0, max);
}

export function loadSearchHistory(serverId: ServerId): string[] {
  try {
    const raw = localStorage.getItem(storageKey(serverId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Une valeur stockée qui n'est pas une liste de chaînes est rejetée en
    // bloc : mieux vaut un historique vide qu'un `undefined` rendu dans une
    // liste de suggestions.
    if (!Array.isArray(parsed) || !parsed.every((q) => typeof q === 'string')) return [];
    return parsed;
  } catch {
    return [];
  }
}

function save(serverId: ServerId, list: string[]): void {
  try {
    localStorage.setItem(storageKey(serverId), JSON.stringify(list));
  } catch {
    /* quota plein ou stockage refusé : une suggestion perdue n'est pas une panne */
  }
}

export function rememberSearch(serverId: ServerId, query: string): void {
  save(serverId, addToHistory(loadSearchHistory(serverId), query));
}

export function forgetSearch(serverId: ServerId, query: string): void {
  const key = normalize(query);
  save(serverId, loadSearchHistory(serverId).filter((q) => normalize(q) !== key));
}
