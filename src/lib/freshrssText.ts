import { decodeEntities } from './searchMatch';

/**
 * FreshRSS remplace certains caractères de ses réponses par leurs formes
 * pleine chasse (`escapeToUnicodeAlternative`) : `& < >` dans les titres
 * d'articles, et davantage dans les noms de flux, dont `/` (« r／selfhosted »).
 * Affichés tels quels, ils se voyaient, partaient tels quels dans un titre
 * copié ou partagé, et une recherche sur « & » ne les trouvait pas.
 *
 * Rendus en ASCII à la lecture, pour l'affichage. Seulement ceux-là : `？` et
 * `；` pleine chasse, que FreshRSS produit aussi dans les noms, sont des
 * signes ordinaires du chinois et du japonais. Et jamais sur un nom
 * d'étiquette ou de catégorie : il sert d'identifiant à l'API
 * (`user/-/label/<nom>`), et doit lui revenir tel que FreshRSS l'a écrit.
 *
 * Un flux qui échappe son titre deux fois arrive ainsi en `＆#127916;` : FreshRSS
 * retire une couche et remplace le `&` restant. L'entité se décode d'un seul
 * passage, donc une couche, et seulement entière : le décodeur du navigateur
 * prend aussi `&copy` sans point-virgule, et « R＆D＆copy » n'en est pas une. Le
 * résultat reste du texte, comme tout titre. Dans les noms, FreshRSS remplace
 * aussi `;`, d'où le `；` final.
 */
const ENTITY = '#\\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31}';
const TITLE = new RegExp(`＆(${ENTITY});|[＆＜＞]`, 'g');
const NAME = new RegExp(`＆(${ENTITY})[;；]|[＆＜＞／]`, 'g');
const ASCII: Record<string, string> = { '＆': '&', '＜': '<', '＞': '>', '／': '/' };

const restore = (match: string, entity?: string) =>
  (entity ? decodeEntities(`&${entity};`) : ASCII[match]);

export function fromFreshrssTitle(text: string | undefined): string {
  return text ? text.replace(TITLE, restore) : '';
}

export function fromFreshrssName(text: string | undefined): string {
  return text ? text.replace(NAME, restore) : '';
}
