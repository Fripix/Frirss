/**
 * L'URL d'un article, seulement si elle peut servir de `href` sans risque :
 * schéma `http:` ou `https:`, rien d'autre.
 *
 * L'URL vient du flux, donc de n'importe qui : un `javascript:` posé en
 * `href` s'exécuterait au clic molette ou au ⌘-clic, que le titre laisse au
 * navigateur (`TitleLink.tsx`). L'analyse passe par `URL`, pas par une
 * expression régulière : c'est le même analyseur que celui du navigateur, qui
 * retire tabulations et retours à la ligne du schéma (`java\tscript:` est un
 * `javascript:`). Une URL relative n'a pas de base ici et n'est pas un
 * article ouvrable : `undefined`.
 */
export function safeHref(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
