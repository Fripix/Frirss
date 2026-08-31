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
/**
 * Peut-on basculer vers ce serveur ?
 *
 * Deux refus : celui qui est déjà actif, et une entrée **synthétique** — la
 * connexion FreshRSS active qui n'a pas d'enregistrement en base. Elle se voit
 * mais ne se gère pas, et « basculer » vers elle n'aurait aucun sens.
 *
 * Les identifiants sont comparés en TEXTE : ils arrivent tantôt en nombre
 * (base) tantôt en chaîne (`localStorage`), et une comparaison stricte
 * laisserait basculer vers le serveur déjà actif.
 */
export function canSwitchTo(
  server: DisplayServer,
  activeServerId: string | number | null
): boolean {
  if (server.synthetic) return false;
  return String(server.id) !== String(activeServerId);
}

export function canDeleteServer(servers: ServerConnection[]): boolean {
  return servers.length > 1;
}

/**
 * Faut-il rendre la liste, ou attendre ?
 *
 * Le piège : `displayServers()` fabrique une ligne synthétique à partir de
 * `serverUrl` quand la liste est vide. Rendue avant le premier chargement,
 * elle est indiscernable d'un compte hérité — une panne réseau affirmerait
 * alors tranquillement que l'utilisateur n'a qu'un serveur ingérable.
 *
 * Mais attendre un chargement quand des serveurs sont DÉJÀ en mémoire fait
 * patienter devant une donnée qu'on possède : le magasin est rempli au
 * démarrage par `App.tsx`, et par `ServerSwitcher` quand la barre est visible.
 * On affiche donc tout de suite ce qu'on a, et on revalide derrière.
 */
export function shouldShowServerList(serverCount: number, loaded: boolean): boolean {
  return serverCount > 0 || loaded;
}
