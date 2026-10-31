import { entryIdUsec } from './entryId';
import type { Filter } from '../types';

/**
 * L'affichage aléatoire : un tirage parmi les identifiants d'une vue. L'API de
 * FreshRSS ne propose pas ce tri (`r` ne connaît que les deux sens par date), et
 * trier localement ne mélangerait que les pages déjà reçues.
 * Spec : docs/superpowers/specs/2026-10-31-random-order-design.md
 */

/** Plafond du relevé : au-delà, le coût en appels ne se justifie plus. */
export const RANDOM_MAX_IDS = 10_000;
export const RANDOM_DEFAULT_COUNT = 20;
export const RANDOM_MAX_COUNT = 500;

export type RandomWindowUnit = 'hours' | 'days';

const MS_PER_HOUR = 3_600_000;

/**
 * Tous et Non lus seulement : les favoris d'un flux sont filtrés côté client,
 * leurs identifiants ne s'obtiennent pas.
 */
export function canRandomView(filter: Filter): boolean {
  return filter === 'all' || filter === 'unread';
}

/** Seuls un nombre et son écriture en sont un : `Number(true)` vaut 1, `Number([5])` vaut 5. */
const asNumber = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v !== '') ? Number(v) : NaN);

/** Un nombre d'articles lisible, sinon le défaut : la valeur vient aussi d'un autre appareil. */
export function normalizeRandomCount(v: unknown): number {
  const n = asNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= RANDOM_MAX_COUNT ? n : RANDOM_DEFAULT_COUNT;
}

/** Une ancienneté entière et positive ; 0 veut dire tous les articles. */
export function normalizeRandomAmount(v: unknown): number {
  const n = asNumber(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export function normalizeRandomUnit(v: unknown): RandomWindowUnit {
  return v === 'days' ? 'days' : 'hours';
}

/**
 * La clé d'un choix : serveur et vue (`''` pour l'accueil). `feed/12` ne désigne pas
 * le même flux d'un serveur à l'autre, et un serveur appartient à un seul compte.
 */
export function randomViewKey(serverId: string | number | null | undefined, viewId: string): string {
  return `${serverId ?? ''}|${viewId}`;
}

/** Les choix lisibles d'une valeur qui vient aussi d'un autre appareil. */
export function normalizeRandomViews(v: unknown): Record<string, true> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] === true).map((k) => [k, true as const]));
}

/**
 * Le seuil à comparer aux identifiants d'entrée, qui portent l'instant d'arrivée
 * dans FreshRSS, en microsecondes. Pas `ot` : FreshRSS le lit comme « publié après
 * OU modifié après », et un vieux billet corrigé s'y glisserait.
 */
export function randomCutoffUsec(amount: number, unit: RandomWindowUnit, nowMs: number): bigint | null {
  if (amount <= 0) return null;
  const hours = unit === 'days' ? amount * 24 : amount;
  return BigInt(Math.max(0, nowMs - hours * MS_PER_HOUR)) * 1000n;
}

/** `count` identifiants au hasard : un mélange de Fisher-Yates, arrêté au nombre voulu. */
export function drawIds(ids: readonly string[], count: number, rng: () => number = Math.random): string[] {
  const pool = [...ids];
  const taken = Math.min(count, pool.length);
  for (let i = pool.length - 1; i >= pool.length - taken; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(pool.length - taken);
}

/**
 * FreshRSS rend les contenus triés par identifiant : l'ordre du tirage se refait
 * ici. Les deux côtés passent par `entryIdUsec`, le relevé étant en décimal et les
 * articles en `tag:…/hex`. Un identifiant sans article (purgé entre-temps) disparaît.
 */
export function inDrawOrder<T extends { id: string }>(items: readonly T[], drawn: readonly string[]): T[] {
  const byEntry = new Map(items.map((item) => [entryIdUsec(item.id) ?? item.id, item]));
  return drawn.flatMap((id) => {
    const item = byEntry.get(entryIdUsec(id) ?? id);
    return item ? [item] : [];
  });
}
