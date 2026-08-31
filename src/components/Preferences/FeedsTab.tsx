import ServerList from './servers/ServerList';
import CategoryList from './CategoryList';

/**
 * Section Flux — tout ce qui concerne les flux : les serveurs FreshRSS d'où
 * ils viennent, et les catégories qui les rangent. La logique des serveurs vit
 * dans `servers/`, celle des catégories dans `CategoryList` ; cette section
 * n'est que le point de montage.
 */
export default function FeedsTab() {
  return (
    <div className="space-y-6">
      <ServerList />
      <CategoryList />
    </div>
  );
}
