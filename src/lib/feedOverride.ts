import type { ArticleOrder } from './effectiveOrder';
import type { FeedSetting } from '../stores/uiStore';

type ServerId = string | number | null | undefined;

/**
 * Ce qui appartient à un serveur se range sous cette clé, vue vide pour l'accueil :
 * FreshRSS numérote les flux par serveur, `feed/12` n'est pas le même flux d'un
 * serveur à l'autre.
 */
export function serverViewKey(serverId: ServerId, viewId: string): string {
  return `${serverId ?? ''}|${viewId}`;
}

/** Depuis le début : un nom d'étiquette peut contenir `|`, un numéro de serveur non. */
export function isServerKey(key: string): boolean {
  return /^\d+\|/.test(key);
}

/**
 * L'ordre et la disposition d'un flux sur ce serveur. Une entrée sans serveur vient de
 * la version publiée : elle reste lue jusqu'à son adoption (`adoptFeedOverrides`).
 * Passer par `effectiveOrder` et `effectiveLayout` pour décider d'une vue.
 */
export function feedOverride(
  settings: Record<string, FeedSetting>,
  serverId: ServerId,
  feedId: string,
): { order?: ArticleOrder; layout?: string } {
  const own = serverId === null || serverId === undefined ? undefined : settings[serverViewKey(serverId, feedId)];
  const published = settings[feedId];
  return { order: own?.order || published?.order, layout: own?.layout || published?.layout };
}
