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

/**
 * Categories of a prefix: those already on the server (labels) merged with the
 * ones the user just created locally.
 *
 * The Google Reader model has no empty label — a label exists only once applied
 * to an article. Keeping the names in synced preferences lets a category exist
 * the moment it is created and be materialised on the server when the first
 * article lands in it, instead of forcing the user to file something first.
 */
export function savedCategories(labels: Tag[], prefix: string, localNames: string[] = []): SavedCategory[] {
  const head = `${BASE}${prefix}/`;
  const byName = new Map<string, SavedCategory>();
  for (const t of labels) {
    if (t.id.startsWith(head) && t.id.length > head.length) {
      const name = t.id.slice(head.length);
      byName.set(name, { id: t.id, name });
    }
  }
  for (const raw of localNames) {
    const name = raw.trim();
    if (name && !byName.has(name)) byName.set(name, { id: categoryLabelId(prefix, name), name });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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
