import type { Article } from '../types';
import { openExternal } from './openExternal';

/**
 * Ouvre l'article à sa source, puis le marque lu SOUS CONDITION — jamais une
 * bascule.
 *
 * Appeler `toggleRead` sur un article déjà lu le repasserait à non lu,
 * l'inverse de l'intention : « ouvrir » ne doit jamais désarquer un article.
 * C'est la décision pure dont dépend toute l'icône « ouvrir à la source » ;
 * elle vivait avant dupliquée à l'identique aux deux points d'appel de
 * `ArticleList.tsx` (ligne normale/compacte et vue grille).
 */
export function openArticleAtSource(
  article: Article,
  toggleRead: (article: Article) => void,
): void {
  openExternal(article.url);
  if (!article.read) toggleRead(article);
}
