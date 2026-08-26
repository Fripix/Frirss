import type { ServerConnection } from '../types';

/**
 * Un serveur tel qu'il s'affiche. `synthetic` marque la connexion FreshRSS
 * active qui n'a pas d'enregistrement en base (première connexion, comptes
 * anciens) : elle se voit mais ne se gère pas.
 */
export type DisplayServer = Omit<ServerConnection, 'id'> & {
  id: string | number;
  synthetic?: boolean;
};

/** Hôte abrégé d'une URL de serveur, sans `www.`. Tolérant aux URL malformées. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Liste affichable. Quand la connexion active n'est adossée à aucun
 * enregistrement, une entrée synthétique la représente en tête : le serveur
 * courant doit toujours être visible, même s'il n'est pas gérable.
 */
export function displayServers(
  servers: ServerConnection[],
  activeServerId: string | number | null,
  serverUrl: string,
): DisplayServer[] {
  const list: DisplayServer[] = [...servers];
  const hasActiveRecord = servers.some((s) => String(s.id) === String(activeServerId));
  if (serverUrl && !hasActiveRecord) {
    list.unshift({
      id: activeServerId ?? '__current__',
      name: hostnameOf(serverUrl),
      url: serverUrl,
      freshrss_user: '',
      synthetic: true,
    });
  }
  return list;
}

/**
 * Serveur sur lequel basculer après une suppression, ou `null` s'il n'y a pas
 * lieu de basculer. Ne bascule que si le serveur supprimé était l'actif, et
 * jamais vers un serveur sans jeton — il ne saurait pas répondre.
 */
export function nextServerAfterDelete(
  remaining: ServerConnection[],
  deletedId: string | number,
  activeServerId: string | number | null,
): ServerConnection | null {
  if (String(deletedId) !== String(activeServerId)) return null;
  const next = remaining.find((s) => s.is_default) ?? remaining[0];
  return next?.has_token ? next : null;
}

/** Le dernier serveur ne se supprime pas : le compte resterait sans connexion. */
export function canDeleteServer(servers: ServerConnection[]): boolean {
  return servers.length > 1;
}
