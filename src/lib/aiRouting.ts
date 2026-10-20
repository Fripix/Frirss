import type { Subscription } from '../types';
import { normalizeAiProviderId, type FeedSetting } from '../stores/uiStore';

export interface AiRoutingPrefs {
  feedSettings: Record<string, FeedSetting>;
  aiCategoryProviders: Record<string, number>;
  aiPreferredProvider: number | null;
  aiTranslationProvider: number | null;
  aiFallback: boolean;
}

export interface AiRouting {
  feedProvider?: number;
  categoryProvider?: number;
  translationProvider?: number;
  preferredProvider?: number;
  fallback: boolean;
}

/**
 * Les choix de routage de l'utilisateur, tels que le serveur les attend dans la
 * requête de résumé : un champ par étage, présent seulement s'il est réglé.
 *
 * Les réglages arrivent de la synchro sans passer par le store : chaque
 * identifiant est revalidé ici (`"3"` ou `-1` n'envoient rien), et les noms de
 * catégorie, choisis par l'utilisateur, sont cherchés par clé propre — une
 * catégorie nommée `constructor` ne doit pas retrouver `Object.prototype`.
 * Un flux inconnu n'envoie ni étage flux ni étage catégorie.
 *
 * L'étage « fournisseur des traductions » ne part que pour une traduction
 * (`op: 'translate'`) : un résumé ne le porte jamais.
 */
export function aiRouting(
  sourceId: string | undefined,
  subscriptions: Subscription[],
  prefs: AiRoutingPrefs,
  options: { op?: 'summary' | 'translate' } = {},
): AiRouting {
  const out: AiRouting = { fallback: prefs.aiFallback };
  const sub = sourceId ? subscriptions.find((s) => s.id === sourceId) : undefined;
  if (sub) {
    const feedProvider = normalizeAiProviderId(prefs.feedSettings[sub.id]?.aiProvider);
    if (feedProvider !== null) out.feedProvider = feedProvider;
    for (const cat of sub.categories ?? []) {
      const name = cat.label;
      if (!name || !Object.hasOwn(prefs.aiCategoryProviders, name)) continue;
      const id = normalizeAiProviderId(prefs.aiCategoryProviders[name]);
      if (id !== null) { out.categoryProvider = id; break; }
    }
  }
  if (options.op === 'translate') {
    const translation = normalizeAiProviderId(prefs.aiTranslationProvider);
    if (translation !== null) out.translationProvider = translation;
  }
  const preferred = normalizeAiProviderId(prefs.aiPreferredProvider);
  if (preferred !== null) out.preferredProvider = preferred;
  return out;
}
