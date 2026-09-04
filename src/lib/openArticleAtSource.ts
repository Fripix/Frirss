import type { Article } from '../types';
import { openExternal } from './openExternal';

/**
 * Ouvre l'article à sa source, puis le SÉLECTIONNE.
 *
 * L'icône marquait auparavant l'article lu sous condition. Elle le sélectionne
 * désormais : une fois revenu de l'onglet ouvert, l'article est celui sur
 * lequel portent le volet de lecture, les raccourcis et les actions — on
 * enchaîne sans avoir à le retrouver dans la liste.
 *
 * Deux conséquences, et ce sont elles qui font l'intérêt du changement :
 *
 * 1. **Le garde « jamais une bascule » n'a plus lieu d'être.** Il existait
 *    parce que `toggleRead` sur un article déjà lu le repassait non lu.
 *    `selectArticle` (`src/stores/feedStore.ts`) n'est pas une bascule : sur un
 *    article déjà lu il se contente de le sélectionner, sinon il le marque lu
 *    de façon optimiste — c'est le chemin de lecture normal, celui qui sait
 *    survivre hors ligne (file d'attente + rejeu).
 * 2. **La ligne ne quitte plus la liste sous « Non lus ».** Le retrait est
 *    décidé par `shouldLeaveList()` (`src/lib/removeOnRead.ts`), que seul
 *    `toggleRead` consulte ; et son critère `selected` protège de toute façon
 *    l'article sélectionné. Passer par `selectArticle` ne le consulte même
 *    pas : la ligne reste en place, là où le clic la faisait disparaître.
 *
 * ⚠️ Sans URL, rien ne se passe — ni ouverture, ni sélection. `openExternal('')`
 * ne fait déjà rien, mais la suite, elle, partait quand même : l'article
 * changeait d'état sans que personne ne l'ait ouvert. Aucun bouton ne mène là
 * aujourd'hui (`rowActionSlots()` rend l'emplacement vide), mais ce module est
 * censé porter la décision ENTIÈRE : un second appelant qui ne consulterait
 * pas les emplacements — un raccourci clavier, par exemple — tomberait dessus.
 *
 * La sélection est passée en argument et appelée explicitement, jamais laissée
 * au clic qui remonterait jusqu'à la ligne : la carte de la vue grille arrête
 * la propagation sur son conteneur, le comportement différerait donc d'un mode
 * d'affichage à l'autre.
 */
export function openArticleAtSource(
  article: Article,
  selectArticle: (article: Article) => void,
): void {
  if (!article.url?.trim()) return;
  openExternal(article.url);
  selectArticle(article);
}
