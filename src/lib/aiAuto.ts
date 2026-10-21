import type { Subscription } from '../types';
import type { FeedSetting } from '../stores/uiStore';

export interface AiAutoPrefs {
  feedSettings: Record<string, FeedSetting>;
  aiCategoryAutoSummary: Record<string, true>;
  aiCategoryAutoTranslate: Record<string, true>;
  aiAutoSummary: boolean;
}

/**
 * Faut-il résumer / traduire automatiquement les articles de ce flux ?
 *
 * Priorité : le réglage propre du flux (vrai OU faux explicite — éteindre un
 * flux sous une catégorie allumée doit tenir) > les catégories (allumé dès
 * qu'UNE catégorie du flux l'est) > pour le résumé seulement, le réglage
 * global ; la traduction, sans réglage, est éteinte.
 *
 * Les noms de catégorie, choisis par l'utilisateur, sont cherchés par clé
 * propre : une catégorie nommée `constructor` ne doit pas retrouver
 * `Object.prototype`. Un flux inconnu n'a pas de catégorie.
 */
export function autoFor(
  kind: 'summary' | 'translate',
  sourceId: string | undefined,
  subscriptions: Subscription[],
  prefs: AiAutoPrefs,
): boolean {
  const own = sourceId ? prefs.feedSettings[sourceId] : undefined;
  const value = kind === 'summary' ? own?.aiAutoSummary : own?.aiAutoTranslate;
  if (typeof value === 'boolean') return value;

  const categories = kind === 'summary' ? prefs.aiCategoryAutoSummary : prefs.aiCategoryAutoTranslate;
  const sub = sourceId ? subscriptions.find((s) => s.id === sourceId) : undefined;
  for (const cat of sub?.categories ?? []) {
    const name = cat.label;
    if (name && Object.hasOwn(categories, name) && categories[name] === true) return true;
  }
  return kind === 'summary' ? prefs.aiAutoSummary : false;
}

/**
 * Le panneau « Résumé IA » est-il montré en permanence pour ce flux ? Faux : il
 * n'apparaît qu'avec une demande ou un résumé (voir `ReadingPane`).
 *
 * Priorité : le réglage propre du flux (vrai OU faux explicite) > les
 * catégories > le réglage global. Les catégories se départagent à l'inverse
 * d'un simple « première trouvée » : vrai dès qu'UNE est explicitement vraie
 * (comme `autoFor`), sinon faux dès qu'une est explicitement fausse — un
 * panneau demandé quelque part n'est pas masqué par une autre catégorie.
 * Mêmes précautions que `autoFor` sur les noms de catégorie.
 */
export function panelFor(
  sourceId: string | undefined,
  subscriptions: Subscription[],
  prefs: AiAutoPrefs & { aiCategoryPanel: Record<string, boolean>; aiPanelAlways: boolean },
): boolean {
  const own = sourceId ? prefs.feedSettings[sourceId]?.aiPanel : undefined;
  if (typeof own === 'boolean') return own;

  const sub = sourceId ? subscriptions.find((s) => s.id === sourceId) : undefined;
  let anyOff = false;
  for (const cat of sub?.categories ?? []) {
    const name = cat.label;
    if (!name || !Object.hasOwn(prefs.aiCategoryPanel, name)) continue;
    const v = prefs.aiCategoryPanel[name];
    if (v === true) return true;
    if (v === false) anyOff = true;
  }
  return anyOff ? false : prefs.aiPanelAlways;
}
