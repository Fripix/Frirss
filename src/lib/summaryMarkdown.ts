/**
 * Le résumé est du texte brut (consigne de `server/ai/prompts.ts`), mais un
 * petit modèle n'obéit pas toujours : sur un très long article, Ollama rendait
 * des `#` de titres, du `**gras**` et des puces markdown, affichés tels quels.
 * On nettoie à l'affichage le markdown **simple** seulement, sans rien
 * interpréter : titres → ligne ordinaire, gras → texte, puces `-` / `*` →
 * « • ». Le reste (un tiret de phrase, `#hashtag`, `5 * 3`, `-12 °C`) ne
 * bouge pas : chaque marque exige sa forme exacte (début de ligne et espace).
 * Chaque motif est linéaire : `[^*\n]` ne traverse ni une étoile ni une ligne.
 */
export function stripSummaryMarkdown(text: string): string {
  return text
    .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ');
}
