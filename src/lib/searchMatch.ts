import type { Article } from '../types';

/**
 * Règles de correspondance de la recherche côté client.
 *
 * L'API greader de FreshRSS n'a pas de paramètre de recherche (vérifié de la
 * 1.20.2 à la 1.27.0 : `streamContents` ne lit que `xt`, `it`, `n`, `r`, `ot`,
 * `nt`, `c`, `s`, `output`). Le filtrage vit donc ici.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */

/** Minuscules et diacritiques dépliés : « Élection » et « election » se rejoignent. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Repli sans DOM : les entités de base et les numériques, rien de plus. */
const BASIC_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/**
 * Un point de code tel que le lit le navigateur : hors plage, demi-paire de
 * substitution ou zéro donnent U+FFFD. `String.fromCodePoint` LEVAIT hors
 * plage, et l'erreur faisait échouer tout le balayage.
 */
function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
  return String.fromCodePoint(n);
}

function decodeWithoutDom(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole: string, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return safeCodePoint(Number(dec));
    if (hex !== undefined) return safeCodePoint(parseInt(hex, 16));
    return BASIC_ENTITIES[(name as string).toLowerCase()] ?? whole;
  });
}

let decoder: HTMLTextAreaElement | null = null;

/**
 * Décode TOUTES les entités HTML — les 2 231 nommées, les numériques, les
 * formes sans point-virgule — avec le décodeur du navigateur lui-même.
 *
 * Un `<textarea>` hors document : son contenu est lu en RCDATA, donc
 * `innerHTML` n'y crée jamais d'élément — aucun script, aucune image, que du
 * texte, entités décodées selon la spécification (hors plage → U+FFFD).
 *
 * Choisi sur mesure (Chrome, 10 000 articles de 2,7 Ko, texte cherchable
 * complet) : ~400 ms, contre ~260 ms pour une table d'entités embarquée et
 * ~900 ms pour `DOMParser`. La table gagne 150 ms sur un balayage qui en passe
 * ~10 000 sur le réseau, mais il faudrait embarquer et tenir à jour 2 231
 * noms ; `DOMParser` construit un document entier par article.
 *
 * Sans DOM (Node), repli sur les entités de base : jamais d'exception.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  if (typeof document === 'undefined') return decodeWithoutDom(text);
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = text;
  const out = decoder.value;
  decoder.textContent = ''; // ne pas garder en mémoire le dernier article
  return out;
}

/**
 * `<script>` et `<style>` avec leur contenu, refermés ou non (un `<script>`
 * jamais refermé avale la suite, comme dans le navigateur). `[^<>]*` et non
 * `[^>]*` : un `<script` sans `>` s'arrête au `<` suivant, ce qui garde
 * l'expression linéaire sur un balisage pathologique.
 */
const RAW_TEXT = /<(script|style)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/**
 * Texte lisible d'un fragment HTML.
 *
 * Les balises deviennent des espaces plutôt que rien : sans ça
 * `<b>moteur</b><i>recherche</i>` donnerait « moteurrecherche » et un mot
 * cherché à cheval sur deux balises matcherait par accident. Le contenu des
 * `<script>`/`<style>` n'est pas du texte : il part avec sa balise. Les
 * entités sont décodées APRÈS le retrait des balises, sinon `&lt;b&gt;`
 * redeviendrait une balise à retirer.
 */
export function stripHtml(html: string): string {
  const text = html.replace(RAW_TEXT, ' ').replace(/<[^<>]*>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** Les mots de la requête, normalisés, sans doublon ni vide. */
export function parseQuery(query: string): string[] {
  return [...new Set(normalizeForSearch(query).split(/\s+/).filter(Boolean))];
}

/**
 * Le texte cherchable d'un article, calculé UNE SEULE FOIS au balayage — jamais
 * à chaque frappe : refiltrer 10 000 articles doit rester instantané.
 */
export function articleHaystack(article: Article): string {
  const body = article.content || article.summary || '';
  return normalizeForSearch(`${stripHtml(article.title)} ${stripHtml(body)}`);
}

/** Tous les mots présents. Sans terme, rien ne correspond. */
export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  return terms.every((term) => haystack.includes(term));
}
