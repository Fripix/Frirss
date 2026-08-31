import { useAuthStore } from '../stores/authStore';
import { useFeedStore } from '../stores/feedStore';
import { canSwitchTo, type DisplayServer } from './serverList';

/**
 * Bascule vers un serveur FreshRSS.
 *
 * Extrait de `ServerSwitcher`, où il vivait seul. C'est le même piège que
 * celui déjà consigné pour la gestion des serveurs : ce composant ne se monte
 * que si la barre du haut est visible, et masquer la barre est un réglage —
 * tout ce qui n'existe que là devient inatteignable pour qui l'a masquée. La
 * palette de commandes s'en sert désormais aussi.
 *
 * Renvoie `false` quand il n'y avait rien à faire, pour que l'appelant puisse
 * ne rien annoncer plutôt que d'annoncer une bascule qui n'a pas eu lieu.
 */
export function switchToServer(server: DisplayServer): boolean {
  const { activeServerId, switchServer } = useAuthStore.getState();
  if (!canSwitchTo(server, activeServerId)) return false;
  switchServer(server as { id: string | number; url: string });
  useFeedStore.getState().setHasRefreshToken(!!server.has_refresh_token);
  return true;
}
