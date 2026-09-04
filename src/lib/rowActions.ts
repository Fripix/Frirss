/** Les quatre actions d'une ligne d'article, dans leur ordre d'affichage. */
export type RowActionKind = 'star' | 'readLater' | 'openSource' | 'markRead';

/**
 * L'ordre, unique pour les trois modes d'affichage.
 *
 * ⚠️ Le ✓ reste en DERNIER, et ce n'est pas cosmétique : la spec de l'issue #10
 * note qu'en compact, le ✓ de la ligne suivante tombe exactement là où était le
 * précédent, ce qui permet d'enchaîner les clics sans bouger la souris. Insérer
 * avant lui préserve cette propriété ; le déplacer la casse.
 *
 * Avant cette liste, la ligne compacte inversait l'étoile et « à lire plus
 * tard » par rapport aux deux autres modes. Personne n'avait choisi cette
 * divergence.
 */
export const ROW_ACTION_ORDER: readonly RowActionKind[] = [
  'star', 'readLater', 'openSource', 'markRead',
] as const;

/** Quelles icônes l'utilisateur veut voir. Toutes, par défaut. */
export interface RowActionSettings {
  star: boolean;
  readLater: boolean;
  openSource: boolean;
  markRead: boolean;
}

export const DEFAULT_ROW_ACTIONS: RowActionSettings = {
  star: true, readLater: true, openSource: true, markRead: true,
};

export interface RowSlot {
  kind: RowActionKind;
  /**
   * `false` = emplacement RÉSERVÉ, vide : l'action n'existe pas pour CET
   * article. Il occupe quand même sa place, sans quoi les icônes suivantes
   * se décaleraient sur cette ligne-là.
   */
  available: boolean;
}

/**
 * Les emplacements d'une ligne, dans l'ordre.
 *
 * Deux absences, deux traitements opposés :
 *  - **article sans URL** → emplacement réservé (la cause varie par ligne) ;
 *  - **icône masquée par réglage** → emplacement retiré (la cause vaut pour
 *    toute la liste, donc rien ne se décale).
 *
 * Quand les deux se présentent, le réglage l'emporte : masquée partout, il n'y
 * a plus de variation à absorber.
 */
export function rowActionSlots(
  article: { url?: string | null },
  settings: RowActionSettings,
): RowSlot[] {
  return ROW_ACTION_ORDER
    .filter((kind) => settings[kind])
    .map((kind) => ({
      kind,
      available: kind === 'openSource' ? !!article.url?.trim() : true,
    }));
}

/**
 * Ramène une valeur venue du stockage ou de la synchronisation à un réglage
 * complet.
 *
 * ⚠️ Indispensable : un appareil resté sur une version antérieure renvoie un
 * objet auquel il manque les clés ajoutées depuis. Sans complétion,
 * `settings[kind]` vaudrait `undefined` — donc faux — et l'icône disparaîtrait
 * sans que personne l'ait demandé.
 */
export function normalizeRowActions(value: unknown): RowActionSettings {
  const src = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  const out = { ...DEFAULT_ROW_ACTIONS };
  for (const kind of ROW_ACTION_ORDER) {
    if (typeof src[kind] === 'boolean') out[kind] = src[kind] as boolean;
  }
  return out;
}
