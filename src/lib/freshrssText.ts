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
 */
const TITLE = /[＆＜＞]/g;
const NAME = /[＆＜＞／]/g;
const ASCII: Record<string, string> = { '＆': '&', '＜': '<', '＞': '>', '／': '/' };

export function fromFreshrssTitle(text: string | undefined): string {
  return text ? text.replace(TITLE, (c) => ASCII[c]) : '';
}

export function fromFreshrssName(text: string | undefined): string {
  return text ? text.replace(NAME, (c) => ASCII[c]) : '';
}
