import type { Tag } from '../types';
import { isValidCategoryName } from './feedCategories';

/**
 * Noms d'étiquettes et de catégories : un seul espace de noms.
 *
 * Pour l'API Google Reader, une étiquette et une catégorie s'écrivent toutes
 * deux `user/-/label/<nom>`. FreshRSS les range pourtant dans deux tables, et
 * il répond « OK » à un renommage ou à une pose d'étiquette qu'il n'a pas
 * faits quand le nom est déjà pris : sans contrôle, le geste ne faisait rien,
 * en silence (et `rename-tag` cherche d'abord une CATÉGORIE de ce nom : une
 * étiquette homonyme renommait la catégorie). D'où ce contrôle avant l'envoi.
 *
 * La comparaison ignore la casse et les espaces autour : la base de FreshRSS
 * compare les noms sans casse.
 */

export type NameOwner = 'label' | 'category';

export interface NameOwners {
  /** Identifiants des étiquettes de l'utilisateur. */
  labels: string[];
  /** Identifiants des catégories, vides comprises. */
  categories: string[];
}

/** Le nom lisible d'un identifiant `user/-/label/<nom>`. */
export function nameOf(id: string): string {
  return id.split('/label/').pop() ?? id;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Qui porte déjà ce nom ? `selfId` est l'élément qu'on renomme : il ne se
 * bloque pas lui-même (changer la casse d'un nom reste permis).
 */
export function takenBy(name: string, owners: NameOwners, selfId?: string): NameOwner | null {
  const wanted = norm(name);
  if (!wanted) return null;
  const clash = (ids: string[]) => ids.some((id) => id !== selfId && norm(nameOf(id)) === wanted);
  if (clash(owners.categories)) return 'category';
  if (clash(owners.labels)) return 'label';
  return null;
}

/**
 * Les propriétaires de noms connus du store : les catégories portées par les
 * flux ET les dossiers que `tag/list` annonce, une catégorie vide n'étant
 * portée par aucun flux.
 */
export function nameOwners(state: { labels: Pick<Tag, 'id'>[]; categoryIds: string[]; folderIds: string[] }): NameOwners {
  return {
    labels: state.labels.map((l) => l.id),
    categories: [...new Set([...state.categoryIds, ...state.folderIds])],
  };
}

/**
 * Pourquoi un nom de catégorie est refusé, s'il l'est : la barre oblique (elle
 * se lirait comme une imbrication), ou un nom déjà pris. Vide : pas de motif à
 * afficher, le bouton est simplement grisé.
 */
export function categoryNameIssue(name: string, owners: NameOwners, selfId?: string): 'slash' | NameOwner | null {
  if (!name.trim()) return null;
  if (!isValidCategoryName(name)) return 'slash';
  return takenBy(name, owners, selfId);
}

/**
 * Les étiquettes de l'utilisateur dans la réponse de `tag/list` : ni état, ni
 * « À lire plus tard », ni catégorie. Une catégorie se reconnaît à son type
 * `folder` — y compris une catégorie VIDE, qu'aucun flux ne porte et que la
 * seule liste des flux laissait passer pour une étiquette — ou, pour un
 * serveur qui ne donne pas de type, à un flux qui la porte. Un nom porté à la
 * fois par un dossier et une étiquette reste écarté : pour l'API, c'est le
 * même flux d'articles.
 */
export function userLabels(tags: Tag[], categoryIds: string[], readLater: string): Tag[] {
  const folders = new Set(tags.filter((t) => t.type === 'folder').map((t) => t.id));
  const cats = new Set(categoryIds);
  return tags.filter(
    (t) => t.id && t.id.includes('/label/') && !t.id.includes('/state/')
      && t.type !== 'folder' && !folders.has(t.id) && !cats.has(t.id) && t.id !== readLater,
  );
}
