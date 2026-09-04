import i18n from '../i18n';
import type { Article } from '../types';

export interface DateGroup {
  label: string | null;
  articles: Article[];
  /**
   * Clé de rendu de la bande, INDÉPENDANTE de sa position.
   *
   * ⚠️ Elle valait `${label}-${index}` côté rendu. Vider une bande — marquer
   * lu le dernier article d'« Aujourd'hui » — décalait l'index de toutes les
   * suivantes, donc leur clé : React démontait puis remontait leurs sous-arbres
   * entiers, et les lignes remontées, portant encore `data-stagger`, rejouaient
   * leur animation d'entrée sur des nœuds neufs. Jusqu'à dix lignes
   * clignotaient d'un coup, sans avoir jamais quitté l'écran.
   *
   * Le libellé suffit tant qu'il ne se répète pas — mais une liste dont un jour
   * revient plus bas rouvre bien une bande de même libellé (cas testé). Le
   * doublon est alors levé par l'identifiant de son premier article, unique par
   * construction.
   */
  key: string;
}

export function groupByDate(articles: Article[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let currentLabel: string | null = null;
  let currentItems: Article[] = [];
  const seen = new Set<string>();

  const push = (label: string | null, items: Article[]): void => {
    const base = label ?? '';
    const key = seen.has(base) ? `${base}#${items[0].id}` : base;
    seen.add(base);
    groups.push({ label, articles: items, key });
  };

  for (const article of articles) {
    const label = getDateLabel(article.published);
    if (label !== currentLabel) {
      if (currentItems.length > 0) {
        push(currentLabel, currentItems);
      }
      currentLabel = label;
      currentItems = [article];
    } else {
      currentItems.push(article);
    }
  }

  if (currentItems.length > 0) {
    push(currentLabel, currentItems);
  }

  return groups;
}

/**
 * Libellé d'un bandeau de date.
 *
 * **Toujours une date, en plus du mot.** « MERCREDI » seul ne dit pas de quel
 * mercredi il s'agit — et c'est précisément ce qu'on cherche à savoir quand on
 * fait défiler une liste sans fin. Même chose pour « Aujourd'hui » et « Hier »,
 * qui deviennent faux dès qu'on laisse l'onglet ouvert une nuit.
 */
function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const articleDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const stamp = formatDate(date, now);

  if (articleDate.getTime() === today.getTime()) {
    return `${i18n.t('dates.today').toUpperCase()} · ${stamp}`;
  }
  if (articleDate.getTime() === yesterday.getTime()) {
    return `${i18n.t('dates.yesterday').toUpperCase()} · ${stamp}`;
  }

  const diffDays = Math.floor((today.getTime() - articleDate.getTime()) / 86400000);
  if (diffDays < 7) return `${formatDay(date)} · ${stamp}`;

  return stamp;
}

/**
 * Locale de formatage des dates — la langue de l'interface, telle quelle.
 *
 * ⚠️ Trois endroits testaient auparavant `lng === 'fr' ? 'fr-FR' : 'en-US'`,
 * et la liste s'était arrêtée aux deux premières langues du projet. Un lecteur
 * allemand, espagnol, italien, néerlandais, polonais, portugais ou ukrainien —
 * **sept locales sur neuf** — voyait donc ses dates à l'américaine dans une
 * interface par ailleurs traduite.
 *
 * L'étiquette i18next (`fr`, `de`, `uk`…) est une balise BCP 47 valide :
 * `toLocaleDateString` sait la résoudre seule, sans table de correspondance à
 * tenir à jour à chaque langue ajoutée.
 */
export function dateLocale(): string {
  return i18n.language || 'fr';
}

/**
 * Date complète d'un article, telle que le volet de lecture l'affiche.
 *
 * Existe pour que le **fantôme de balayage** et le rendu réel ne puissent pas
 * diverger : ils affichaient la même date via deux littéraux distincts, dont
 * l'un était figé sur `fr-FR`. Hors interface française, la date changeait donc
 * à l'instant où le fantôme cédait la place au rendu.
 */
export function formatArticleDate(published: number): string {
  return new Date(published).toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Jour et mois ; l'année seulement si ce n'est pas l'année courante. */
function formatDate(date: Date, now: Date): string {
  return date
    .toLocaleDateString(dateLocale(), {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
    .toUpperCase();
}

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDay(date: Date): string {
  const key = dayKeys[date.getDay()];
  return i18n.t(`dates.${key}`).toUpperCase();
}
