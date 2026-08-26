import ServerList from './servers/ServerList';

/**
 * Section Flux — la gestion des serveurs FreshRSS et, par serveur, son jeton
 * maître de rafraîchissement. La logique vit dans `servers/` ; cette section
 * n'est plus que le point de montage.
 */
export default function FeedsTab() {
  return <ServerList />;
}
