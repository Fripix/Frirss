/**
 * Rend absolues, contre l'URL de l'article, les URLs d'un document fraîchement
 * analysé — AVANT de le donner à Readability.
 *
 * Pourquoi pas `<base>` : le document sort d'un `DOMParser`, donc il hérite de
 * la CSP de la page, et `base-uri 'self'` (voir `nginx.conf`) REFUSE le `<base>`
 * qu'on y injectait. Readability résolvait alors les URLs relatives contre
 * l'origine de FriRSS : sur un avis du CERT-FR, l'icône partait chercher
 * `https://frirss…/static/images/json_icon.svg` — 404 — et les liens internes
 * de l'article ramenaient dans l'application. Le navigateur ne signalait rien
 * d'autre qu'une ligne de console, et jsdom n'applique pas de CSP, donc les
 * tests restaient verts (constaté le 2026-09-26 sur l'instance de dev).
 *
 * Ce chemin ne sert que de REPLI, quand `/api/extract` n'a pas pu répondre :
 * côté serveur, sans CSP, le `<base>` fonctionne (`server/extract.ts`).
 */

/** Attributs porteurs d'URL que Readability conserve dans le contenu extrait. */
const URL_ATTRS: Array<[selector: string, attr: string]> = [
  ['a[href]', 'href'],
  ['[src]', 'src'],
  ['[poster]', 'poster'],
];

/** Ce qui n'a pas de base : déjà absolu, ancre interne, ou donnée en ligne. */
function needsBase(value: string): boolean {
  const v = value.trim();
  if (!v || v.startsWith('#')) return false;
  // Un schéma quelconque (http:, mailto:, data:, tel:…) : l'URL se suffit.
  return !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

function resolve(value: string, base: string): string {
  if (!needsBase(value)) return value;
  try {
    return new URL(value.trim(), base).href;
  } catch {
    // Une URL illisible reste telle quelle : une image perdue ne vaut pas
    // d'interrompre l'extraction de tout l'article.
    return value;
  }
}

/** `url 480w, url2 2x` — chaque candidat porte son URL puis son descripteur. */
function resolveSrcset(value: string, base: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      return [resolve(url, base), ...descriptor].join(' ');
    })
    .filter((c): c is string => c !== null)
    .join(', ');
}

export function absolutizeUrls(doc: Document, pageUrl: string): void {
  // La page distante peut porter son propre `<base>` : c'est lui qui fait foi
  // pour ses URLs relatives, comme dans un vrai navigateur.
  const declared = doc.querySelector('base[href]')?.getAttribute('href');
  const base = declared ? resolve(declared, pageUrl) : pageUrl;

  for (const [selector, attr] of URL_ATTRS) {
    for (const el of doc.querySelectorAll(selector)) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, resolve(value, base));
    }
  }
  for (const el of doc.querySelectorAll('[srcset]')) {
    const value = el.getAttribute('srcset');
    if (value) el.setAttribute('srcset', resolveSrcset(value, base));
  }
}
