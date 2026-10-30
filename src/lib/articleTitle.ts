import type { Article } from '../types';

/**
 * Le titre d'un article tel qu'il s'affiche ou part ailleurs (ligne, carte,
 * volet, partage, aperçu du balayage, infobulles).
 *
 * Un article sans titre garde `title: ''` dans le store : le libellé
 * « Sans titre » se pose ICI, au rendu, dans la langue du moment. Calculé à la
 * normalisation, il restait figé dans le cache mémoire et la liste hors ligne
 * après un changement de langue, et la recherche l'indexait comme un mot de
 * l'article. `t` est celui du composant (`useTranslation`) ou d'i18next.
 */
export function articleTitle(article: Pick<Article, 'title'>, t: (key: string) => string): string {
  const title = article.title ?? '';
  return title.trim() ? title : t('articleList.untitled');
}
