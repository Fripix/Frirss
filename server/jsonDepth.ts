/**
 * Profondeur d'imbrication d'un JSON, mesurée sur le texte avant toute
 * analyse.
 *
 * Node 26 sérialise une imbrication extrême que Node 24 refusait aussitôt
 * (`RangeError` de pile) : une réponse de 8 Mo imbriquée sur 4 millions de
 * niveaux bloquait le serveur 4,1 s à la réécriture pour le cache, contre 4 ms
 * sous Node 24 (mesuré le 2026-11-24). Le serveur ne bloquait plus pour
 * personne que par chance. Un parcours linéaire du texte, qui s'arrête dès la
 * limite franchie, rend ce refus indépendant du moteur, et épargne en prime
 * l'analyse elle-même (~0,5 s pour la même réponse).
 *
 * Une vraie réponse FreshRSS, des préférences ou une sauvegarde dépassent à
 * peine une dizaine de niveaux.
 */
export const MAX_JSON_DEPTH = 64;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACE = 0x7d;
const CLOSE_BRACKET = 0x5d;

/**
 * Le JSON dépasse-t-il `limit` niveaux d'objets ou de tableaux ? Ne valide
 * rien d'autre : un texte mal formé passe ici et échoue à l'analyse, comme
 * avant. Lit un `Buffer` octet par octet — en UTF-8, `"`, `\`, `[`, `]`, `{`
 * et `}` ne font jamais partie d'un caractère multi-octets.
 */
export function jsonTooDeep(input: string | Uint8Array, limit = MAX_JSON_DEPTH): boolean {
  const isText = typeof input === 'string';
  const length = input.length;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < length; i++) {
    const c = isText ? (input as string).charCodeAt(i) : (input as Uint8Array)[i];
    if (inString) {
      if (c === BACKSLASH) i++; // le caractère échappé ne compte pas
      else if (c === QUOTE) inString = false;
    } else if (c === QUOTE) {
      inString = true;
    } else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      if (++depth > limit) return true;
    } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
      depth--;
    }
  }
  return false;
}
