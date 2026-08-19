import type { Tag } from '../types';

// A category is a prefixed sub-label: the data model already supports it
// (groupLabels renders Parent/Child), so nothing new is introduced.
// The prefixes are literal and French, matching READ_LATER_LABEL which the app
// already hard-codes regardless of the interface language.
export const READ_LATER_PREFIX = 'À lire plus tard';
export const STARRED_PREFIX = 'Favoris';

export interface SavedCategory {
  id: string;
  name: string;
}

const BASE = 'user/-/label/';

/** Categories filed under a prefix, named without it, sorted. */
export function savedCategories(labels: Tag[], prefix: string): SavedCategory[] {
  const head = `${BASE}${prefix}/`;
  return labels
    .filter((t) => t.id.startsWith(head) && t.id.length > head.length)
    .map((t) => ({ id: t.id, name: t.id.slice(head.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Label id for a category. Slashes are stripped: one level only. */
export function categoryLabelId(prefix: string, name: string): string {
  return `${BASE}${prefix}/${name.trim().replace(/\//g, ' ')}`;
}

/** Is this label one of the saved-article categories (hidden from ÉTIQUETTES)? */
export function isSavedCategory(labelId: string): boolean {
  return [READ_LATER_PREFIX, STARRED_PREFIX].some(
    (p) => labelId.startsWith(`${BASE}${p}/`) && labelId.length > `${BASE}${p}/`.length,
  );
}
