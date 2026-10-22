import type { Subscription } from '../types';
import type { FeedSetting } from '../stores/uiStore';

export interface AiAutoPrefs {
  feedSettings: Record<string, FeedSetting>;
  aiCategoryAutoSummary: Record<string, boolean>;
  aiCategoryAutoTranslate: Record<string, boolean>;
  aiAutoSummary: boolean;
  /** « Traduire le résumé » : absents chez un appelant plus ancien, ils valent éteint. */
  aiCategoryAutoSummaryTranslate?: Record<string, boolean>;
  aiAutoSummaryTranslate?: boolean;
}

/**
 * Les catégories d'un flux départagées comme le fait `panelFor` : vrai dès
 * qu'UNE est explicitement vraie, sinon faux dès qu'une est explicitement
 * fausse, sinon `null` (aucune ne dit rien : au réglage global de décider).
 */
function fromCategories(sub: Subscription | undefined, values: Record<string, boolean>): boolean | null {
  let anyOff = false;
  for (const cat of sub?.categories ?? []) {
    const name = cat.label;
    if (!name || !Object.hasOwn(values, name)) continue;
    const v = values[name];
    if (v === true) return true;
    if (v === false) anyOff = true;
  }
  return anyOff ? false : null;
}

/**
 * Faut-il résumer / traduire / traduire le résumé automatiquement pour ce flux ?
 *
 * Même règle que `panelFor`, pour que les trois colonnes de « Par flux et
 * catégorie » héritent de la même façon : le réglage propre du flux (vrai OU
 * faux explicite — éteindre un flux sous une catégorie allumée doit tenir) >
 * les catégories (vrai dès qu'UNE est explicitement vraie, sinon faux dès
 * qu'une est explicitement fausse — une catégorie éteinte sous un résumé
 * global allumé tient) > le réglage global : `aiAutoSummary` pour le résumé,
 * `aiAutoSummaryTranslate` pour la traduction du résumé ; la traduction de
 * l'article n'en a pas, elle est éteinte.
 *
 * Les noms de catégorie, choisis par l'utilisateur, sont cherchés par clé
 * propre : une catégorie nommée `constructor` ne doit pas retrouver
 * `Object.prototype`. Un flux inconnu n'a pas de catégorie.
 */
export function autoFor(
  kind: 'summary' | 'translate' | 'summaryTranslate',
  sourceId: string | undefined,
  subscriptions: Subscription[],
  prefs: AiAutoPrefs,
): boolean {
  const own = sourceId ? prefs.feedSettings[sourceId] : undefined;
  const value = kind === 'summary' ? own?.aiAutoSummary : kind === 'translate' ? own?.aiAutoTranslate : own?.aiAutoSummaryTranslate;
  if (typeof value === 'boolean') return value;

  const sub = sourceId ? subscriptions.find((s) => s.id === sourceId) : undefined;
  const values = kind === 'summary' ? prefs.aiCategoryAutoSummary
    : kind === 'translate' ? prefs.aiCategoryAutoTranslate
    : prefs.aiCategoryAutoSummaryTranslate ?? {};
  const category = fromCategories(sub, values);
  if (category !== null) return category;
  return kind === 'summary' ? prefs.aiAutoSummary : kind === 'summaryTranslate' ? prefs.aiAutoSummaryTranslate === true : false;
}

/**
 * Le panneau « Résumé IA » est-il montré en permanence pour ce flux ? Faux : il
 * n'apparaît qu'avec une demande ou un résumé (voir `ReadingPane`).
 *
 * Priorité : le réglage propre du flux (vrai OU faux explicite) > les
 * catégories > le réglage global. Les catégories se départagent à l'inverse
 * d'un simple « première trouvée » : vrai dès qu'UNE est explicitement vraie
 * (`fromCategories`, partagé avec `autoFor`), sinon faux dès qu'une est explicitement fausse — un
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
  return fromCategories(sub, prefs.aiCategoryPanel) ?? prefs.aiPanelAlways;
}
