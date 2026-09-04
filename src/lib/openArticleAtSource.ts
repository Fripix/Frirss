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
 *
 * ⚠️ Sans URL, rien ne se passe — ni ouverture, ni marquage. `openExternal('')`
 * ne fait déjà rien, mais le marquage, lui, partait quand même : l'article
 * devenait lu sans que personne ne l'ait ouvert. Aucun bouton ne mène là
 * aujourd'hui (`rowActionSlots()` rend l'emplacement vide), mais ce module est
 * censé porter la décision ENTIÈRE : un second appelant qui ne consulterait
 * pas les emplacements — un raccourci clavier, par exemple — tomberait dessus.
 */
export function openArticleAtSource(
  article: Article,
  toggleRead: (article: Article) => void,
): void {
  if (!article.url?.trim()) return;
  openExternal(article.url);
  if (!article.read) toggleRead(article);
}
