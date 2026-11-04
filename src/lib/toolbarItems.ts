/**
 * Barres personnalisables sur desktop : le registre des éléments masquables.
 *
 * Chaque élément est déclaré UNE fois ici : les Préférences s'en construisent,
 * les barres lisent sa visibilité par identifiant. Ajouter un bouton masquable
 * = une ligne ci-dessous, sa commande de palette, son libellé
 * `preferences.toolbars.items.<id>` dans les dix locales.
 *
 * Règle qui rend l'ensemble sûr : un élément n'est masquable que s'il a une
 * commande équivalente dans la palette (Ctrl/⌘ K). `toolbarCoverage.test.tsx`
 * le vérifie pour chaque entrée.
 *
 * Seulement sur le format desktop (`useToolbarShown`) : sur tablette et
 * téléphone, la palette n'existe pas, tout reste affiché.
 */

export type ToolbarZone = 'list' | 'reading';

/** Dans l'ordre d'affichage de chaque barre. */
export const TOOLBAR_ITEMS = [
  // Barre de la liste
  { id: 'search', zone: 'list' },
  { id: 'unreadFilter', zone: 'list' },
  { id: 'random', zone: 'list' },
  { id: 'starredFilter', zone: 'list' },
  { id: 'markAllRead', zone: 'list' },
  { id: 'optSource', zone: 'list' },
  { id: 'optFavicons', zone: 'list' },
  { id: 'optDateSeparators', zone: 'list' },
  { id: 'optServerBar', zone: 'list' },
  { id: 'density', zone: 'list' },
  { id: 'layout', zone: 'list' },
  // Barre du volet de lecture
  { id: 'back', zone: 'reading' },
  { id: 'read', zone: 'reading' },
  { id: 'star', zone: 'reading' },
  { id: 'readLater', zone: 'reading' },
  { id: 'labels', zone: 'reading' },
  { id: 'fullContent', zone: 'reading' },
  { id: 'summarize', zone: 'reading' },
  { id: 'translate', zone: 'reading' },
  { id: 'original', zone: 'reading' },
  { id: 'share', zone: 'reading' },
  { id: 'focus', zone: 'reading' },
  { id: 'fontSize', zone: 'reading' },
] as const satisfies readonly { id: string; zone: ToolbarZone }[];

export type ToolbarItemId = (typeof TOOLBAR_ITEMS)[number]['id'];

/**
 * Les barres entières. Hors du registre des boutons : la barre de la liste
 * est couverte par ses boutons, celle des raccourcis est purement informative.
 */
export type ToolbarBarId = 'listBar' | 'shortcutBar';
export type ToolbarToggleId = ToolbarItemId | ToolbarBarId;
export type ToolbarVisibility = Record<ToolbarToggleId, boolean>;

const TOGGLE_IDS: readonly ToolbarToggleId[] = [...TOOLBAR_ITEMS.map((i) => i.id), 'listBar', 'shortcutBar'];

export const DEFAULT_TOOLBAR_VISIBILITY: ToolbarVisibility = Object.fromEntries(
  TOGGLE_IDS.map((id) => [id, true]),
) as ToolbarVisibility;

/**
 * Ramène une valeur du stockage ou de la synchronisation à un réglage complet.
 *
 * ⚠️ Même piège que `normalizeRowActions` : un appareil resté sur une version
 * antérieure synchronise un objet sans les éléments ajoutés depuis. Une clé
 * absente ou non booléenne vaut VISIBLE — jamais un bouton qui disparaît sans
 * que personne l'ait décoché.
 */
export function normalizeToolbarVisibility(value: unknown): ToolbarVisibility {
  const src = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  const out = { ...DEFAULT_TOOLBAR_VISIBILITY };
  for (const id of TOGGLE_IDS) {
    if (typeof src[id] === 'boolean') out[id] = src[id] as boolean;
  }
  return out;
}

/** « Tout réafficher » d'une zone ; la liste remet aussi sa barre entière. */
export function resetToolbarZone(v: ToolbarVisibility, zone: ToolbarZone | 'shortcuts'): ToolbarVisibility {
  const out = { ...v };
  if (zone === 'shortcuts') {
    out.shortcutBar = true;
    return out;
  }
  for (const item of TOOLBAR_ITEMS) if (item.zone === zone) out[item.id] = true;
  if (zone === 'list') out.listBar = true;
  return out;
}

/**
 * Pour chaque groupe d'une barre (visible ou non), faut-il un séparateur
 * avant lui ? Oui seulement s'il est visible ET qu'un groupe visible le
 * précède : jamais en tête, jamais en queue, jamais deux de suite.
 */
export function separatorsBefore(groupsVisible: boolean[]): boolean[] {
  let seen = false;
  return groupsVisible.map((visible) => {
    const sep = visible && seen;
    if (visible) seen = true;
    return sep;
  });
}
