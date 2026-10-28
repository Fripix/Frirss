/**
 * L'URL d'un article, seulement si elle peut servir de `href` sans risque :
 * schéma `http:` ou `https:`, rien d'autre.
 *
 * L'URL vient du flux, donc de n'importe qui : un `javascript:` ou un `data:`
 * posé en `href` ou passé à `window.open` s'exécuterait. **Toute** URL venue
 * d'un flux passe donc par ici avant de devenir un lien ou un onglet : titre
 * (`TitleLink.tsx`), icône « ouvrir à la source » (`ArticleActions.tsx` et
 * `rowActions.ts`), entrée du menu (`articleMenu.ts`), « Original », titre et
 * feuille du bas du volet (`ReadingPane.tsx`), et `openExternal()` — par où
 * passent l'icône, la touche `o` et « ouvrir le site » d'un flux. React 19
 * neutralise déjà un `href` en `javascript:`, pas un `data:`, et rien ne
 * protège `window.open` : la garde est ici, pas dans le moteur de rendu. L'analyse passe par `URL`, pas par une
 * expression régulière : c'est le même analyseur que celui du navigateur, qui
 * retire tabulations et retours à la ligne du schéma (`java\tscript:` est un
 * `javascript:`). Une URL relative n'a pas de base ici et n'est pas un
 * article ouvrable : `undefined`.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
