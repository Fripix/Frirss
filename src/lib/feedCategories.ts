import type { Subscription } from '../types';

/**
 * Regroupement des flux par catégorie, pour le panneau de gestion.
 *
 * Les catégories ne sont pas des objets de premier ordre : FreshRSS ne les
 * expose que **portées par les flux** (`subscription.categories`). Il n'existe
 * donc pas de liste à charger, seulement une liste à déduire — et une
 * catégorie sans aucun flux n'existe tout simplement pas, ce qui est la même
 * limite que pour les catégories d'articles sauvegardés.
 */

export interface CategoryGroup {
  id: string;
  label: string;
  feeds: Subscription[];
}

export interface GroupedFeeds {
  categories: CategoryGroup[];
  /** Flux qui n'appartiennent à aucune catégorie. Ils existent. */
  uncategorised: Subscription[];
}

/** Nom lisible d'un identifiant de flux catégorie (`user/-/label/Tech`). */
export function categoryNameOf(id: string): string {
  const at = id.lastIndexOf('/label/');
  return at === -1 ? id : id.slice(at + '/label/'.length);
}

/** Comparaison sans casse ni accents, pour un tri qui se lit naturellement. */
function sortKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function groupFeedsByCategory(subscriptions: Subscription[]): GroupedFeeds {
  const byId = new Map<string, CategoryGroup>();
  const uncategorised: Subscription[] = [];

  for (const sub of subscriptions) {
    // Une entrée sans identifiant ou sans libellé n'est pas exploitable : la
    // renommer ou la supprimer viserait dans le vide.
    const cats: Array<{ id: string; label: string }> = [];
    for (const cat of sub.categories ?? []) {
      if (cat?.id && cat.label) cats.push({ id: cat.id, label: cat.label });
    }
    if (!cats.length) {
      uncategorised.push(sub);
      continue;
    }
    // Le modèle Google Reader autorise plusieurs catégories par flux ; FreshRSS
    // n'en donne qu'une. Le flux est listé sous chacune : masquer la seconde
    // appartenance ferait passer un déplacement pour un échec.
    for (const cat of cats) {
      const existing = byId.get(cat.id);
      if (existing) {
        existing.feeds.push(sub);
      } else {
        byId.set(cat.id, { id: cat.id, label: cat.label, feeds: [sub] });
      }
    }
  }

  const categories = [...byId.values()].sort((a, b) =>
    sortKey(a.label).localeCompare(sortKey(b.label))
  );
  return { categories, uncategorised };
}

/**
 * Un nom de catégorie utilisable.
 *
 * La barre oblique est refusée : l'identifiant est `user/-/label/<nom>`, et une
 * barre à l'intérieur se lirait comme une imbrication — elle fabriquerait une
 * catégorie que personne n'a demandée.
 */
export function isValidCategoryName(name: string): boolean {
  const value = name.trim();
  return value.length > 0 && !value.includes('/');
}
