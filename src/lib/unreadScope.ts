/**
 * Portée du filtre « Non lus ».
 *
 * - `feed` : chaque flux, catégorie ou étiquette retient son propre choix
 *   (`byFeed`, la clé `''` désignant la vue d'accueil). Un flux sans choix
 *   part de `all`.
 * - `all`  : un seul état, `all`, pour toutes les vues ; `byFeed` est ignoré.
 *
 * Tant que le mode global n'a jamais servi, `all` vaut `false` et la règle
 * rend exactement l'ancienne expression `unreadOnlyByFeed[clé] ? … : …`.
 * Spec : docs/superpowers/specs/2026-09-10-unread-filter-scope-design.md
 */
export type UnreadScope = 'feed' | 'all';

export interface UnreadPrefs {
  scope: UnreadScope;
  all: boolean;
  byFeed: Record<string, boolean>;
}

/** Une portée inconnue (valeur synchronisée par une version future) vaut `feed`. */
export function normalizeUnreadScope(v: unknown): UnreadScope {
  return v === 'all' ? 'all' : 'feed';
}

/** Vrai si la vue de clé `key` s'ouvre filtrée sur les non-lus. */
export function unreadOnlyFor(key: string, prefs: UnreadPrefs): boolean {
  if (prefs.scope === 'all') return prefs.all;
  const own = prefs.byFeed[key];
  return own === undefined || own === null ? prefs.all : !!own;
}

/**
 * Changement de portée. Ne recharge rien : c'est à l'appelant de ne pas
 * toucher la vue affichée.
 * - vers `all`  : l'état global prend le choix de la vue affichée, donc rien
 *   ne bascule à l'écran ; la table est conservée.
 * - vers `feed` : le dernier état est conservé et la table est VIDÉE — les
 *   choix par flux antérieurs ne doivent pas ressurgir (décision du
 *   propriétaire, 2026-09-10).
 * Même portée : renvoie l'objet reçu, inchangé.
 */
export function switchUnreadScope(prefs: UnreadPrefs, to: UnreadScope, currentKey: string): UnreadPrefs {
  if (prefs.scope === to) return prefs;
  if (to === 'all') {
    return { scope: 'all', all: unreadOnlyFor(currentKey, prefs), byFeed: prefs.byFeed };
  }
  return { scope: 'feed', all: prefs.all, byFeed: {} };
}
