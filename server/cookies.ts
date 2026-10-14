/**
 * Parseur de cookies minimal (évite une dépendance `cookie-parser`).
 *
 * ⚠️ Tolérant au décodage. Le serveur lit TOUS les cookies de l'hôte, pas
 * seulement les siens : derrière un reverse proxy, un SSO (Authelia) ou tout
 * autre service posé sur le même domaine en ajoute. Un seul d'entre eux porte
 * une séquence `%` invalide et `decodeURIComponent` lève `URIError: URI
 * malformed` — c'est ce qui faisait échouer tout le callback OIDC (issue #23).
 * Une valeur indécodable est gardée telle quelle : elle n'est jamais la nôtre,
 * et les nôtres (`oidc_verifier`, `oidc_nonce`) sont encodées par Express.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
