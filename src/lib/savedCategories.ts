import type { Tag } from '../types';

// A category is a prefixed sub-label: the data model already supports it
// (groupLabels renders Parent/Child), so nothing new is introduced.
// Stable, language-independent label namespaces. These are distinct from the
// built-in starred state and the read-later state stream.
export const READ_LATER_PREFIX = 'read-later';
export const STARRED_PREFIX = 'Favorites';
// Keep displaying existing categories created by older FriRSS versions, which
// used French prefixes. Existing server labels keep their original IDs; newly
// created categories use the stable English prefixes above.
export const LEGACY_READ_LATER_PREFIX = 'À lire plus tard';
export const LEGACY_STARRED_PREFIX = 'Favoris';

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
  const legacy = prefix === READ_LATER_PREFIX ? [LEGACY_READ_LATER_PREFIX]
    : prefix === STARRED_PREFIX ? [LEGACY_STARRED_PREFIX] : [];
  const heads = [`${BASE}${prefix}/`, ...legacy.map((p) => `${BASE}${p}/`)];
  const byName = new Map<string, SavedCategory>();
  for (const t of labels) {
    const head = heads.find((h) => t.id.startsWith(h) && t.id.length > h.length);
    if (head) {
      const name = t.id.slice(head.length);
      // Prefer the canonical label if both old and new versions exist.
      const existing = byName.get(name);
      if (!existing || t.id.startsWith(`${BASE}${prefix}/`)) byName.set(name, { id: t.id, name });
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
  return [READ_LATER_PREFIX, STARRED_PREFIX, LEGACY_READ_LATER_PREFIX, LEGACY_STARRED_PREFIX].some(
    (p) => labelId.startsWith(`${BASE}${p}/`) && labelId.length > `${BASE}${p}/`.length,
  );
}
