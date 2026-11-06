import type { Subscription } from '../types';
import { categoryNameIssue, nameOf, type NameOwners } from './labelNames';

/**
 * Contrôles de « Ajouter un flux », avant tout appel au serveur.
 *
 * La boîte n'appliquait aucune des règles de Préférences au nom d'une
 * nouvelle catégorie : « / » passait (et fabriquait une imbrication), le nom
 * d'une étiquette finissait en « Erreur d'ajout du flux », et « tech » créait
 * une catégorie à côté de « Tech » (R3T1-3). Un abonnement en double ne se
 * disait, lui aussi, que par l'erreur générique.
 */

export interface NewCategoryChoice {
  /** Motif du refus, à afficher sous le champ ; `null` si le nom est accepté (ou vide). */
  issue: 'slash' | 'label' | null;
  /** Catégorie visée : existante (même nom à la casse près) ou nouvelle ; `null` si refusé ou vide. */
  id: string | null;
  /** Son nom exact, tel que FreshRSS le connaît. */
  label: string;
}

/**
 * Où va le flux quand l'utilisateur tape le nom d'une « nouvelle » catégorie.
 * Mêmes règles que le déplacement d'un flux dans Préférences : barre oblique
 * et nom d'étiquette refusés ; le nom d'une catégorie existante, même vide,
 * même autrement capitalisé, n'est pas un refus — le flux y va, sous son nom
 * exact.
 */
export function newCategoryChoice(name: string, owners: NameOwners): NewCategoryChoice {
  const wanted = name.trim();
  if (!wanted) return { issue: null, id: null, label: '' };
  const issue = categoryNameIssue(wanted, owners);
  if (issue === 'slash' || issue === 'label') return { issue, id: null, label: '' };
  // Le nom exact d'abord : avec « Tech » et « tech » côte à côte, « tech »
  // tapé va dans « tech », pas dans la première trouvée à la casse près.
  const existing = owners.categories.find((id) => nameOf(id).trim() === wanted)
    ?? owners.categories.find((id) => nameOf(id).trim().toLowerCase() === wanted.toLowerCase());
  if (existing) return { issue: null, id: existing, label: nameOf(existing) };
  return { issue: null, id: `user/-/label/${wanted}`, label: wanted };
}

/**
 * Forme comparable d'une adresse de flux : hôte en minuscules (il l'est pour
 * le réseau), port par défaut, fragment et barre finale retirés, `http` et
 * `https` confondus — un même flux sous les deux schémas n'est jamais voulu
 * deux fois. Le chemin et la requête gardent leur casse : ils peuvent
 * désigner deux flux différents.
 */
function feedKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const port = url.port && url.port !== '80' && url.port !== '443' ? `:${url.port}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.hostname.toLowerCase()}${port}${path}${url.search}`;
}

/** L'abonnement qui porte déjà cette adresse de flux, s'il y en a un. */
export function subscribedFeed(feedUrl: string, subscriptions: Subscription[]): Subscription | undefined {
  const key = feedKey(feedUrl);
  if (!key) return undefined;
  return subscriptions.find((s) => !!s.url && feedKey(s.url) === key);
}
