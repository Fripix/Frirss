import { safeHref } from './safeHref';

/**
 * Ouvre une URL dans un nouvel onglet, sans laisser de prise à la page ouverte.
 *
 * ⚠️ `window.open` n'implique **pas** `noopener`, contrairement à
 * `<a target="_blank">` pour lequel les navigateurs le font depuis des années.
 * Sans le troisième argument, la page ouverte garde `window.opener` vers FriRSS
 * et peut le rediriger — c'est le *reverse tabnabbing*, exactement ce dont le
 * crochet DOMPurify de `sanitizeHtml.ts` protège déjà les liens du contenu.
 * Les deux ouvertures par script du projet, elles, ne l'avaient pas.
 *
 * Une URL vide n'ouvre rien : certains articles n'en portent pas, et ouvrir
 * `about:blank` serait pire que ne rien faire. Une URL qui n'est pas en
 * `http(s)` (`safeHref`) n'ouvre rien non plus : un `javascript:` ou un
 * `data:` venu d'un flux s'exécuterait dans l'onglet ouvert. Le refus est
 * silencieux, comme pour une URL vide ; le retour (`false`) le dit à
 * l'appelant qui voudrait en tenir compte.
 */
export function openExternal(url: string | null | undefined): boolean {
  const href = safeHref(url);
  if (!href) return false;
  window.open(href, '_blank', 'noopener');
  return true;
}
